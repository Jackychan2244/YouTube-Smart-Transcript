const runtime = typeof browser !== 'undefined' ? browser : chrome;
const usesNativePromises = typeof browser !== 'undefined';

let wrapper = null;
let dropdown = null;
let audioChoice = null;
let videoChoice = null;
let outsideClickHandlerAttached = false;

let cachedInfo = null;
let lastVideoId = null;
let observerStarted = false;

function sanitizeFileName(title) {
  if (!title || typeof title !== 'string') {
    return 'youtube-video';
  }
  const safe = title.replace(/[\\/:*?"<>|]+/g, '').trim();
  return safe || 'youtube-video';
}

function ensureUi() {
  const infoSection = document.querySelector('#info-contents');
  if (!infoSection) {
    return false;
  }

  if (wrapper && infoSection.contains(wrapper)) {
    return true;
  }

  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.removeChild(wrapper);
  }

  wrapper = document.createElement('div');
  wrapper.style.display = 'inline-flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.alignItems = 'flex-start';
  wrapper.style.position = 'relative';
  wrapper.style.marginTop = '12px';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Download';
  button.style.background = '#ff0000';
  button.style.color = '#ffffff';
  button.style.fontWeight = '600';
  button.style.fontSize = '14px';
  button.style.border = 'none';
  button.style.borderRadius = '18px';
  button.style.padding = '10px 20px';
  button.style.cursor = 'pointer';
  button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
  button.style.transition = 'background-color 0.2s ease';

  button.addEventListener('mouseenter', () => {
    button.style.background = '#cc0000';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = '#ff0000';
  });
  button.addEventListener('click', event => {
    event.stopPropagation();
    toggleMenu();
  });

  dropdown = document.createElement('div');
  dropdown.style.display = 'none';
  dropdown.style.position = 'absolute';
  dropdown.style.top = '48px';
  dropdown.style.left = '0';
  dropdown.style.background = '#202020';
  dropdown.style.borderRadius = '8px';
  dropdown.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.35)';
  dropdown.style.padding = '8px 0';
  dropdown.style.minWidth = '180px';
  dropdown.style.zIndex = '9999';

  audioChoice = createMenuButton('Download audio', () => handleDownload('audio'));
  videoChoice = createMenuButton('Download 360p video', () => handleDownload('video'));

  dropdown.appendChild(audioChoice);
  dropdown.appendChild(videoChoice);

  wrapper.appendChild(button);
  wrapper.appendChild(dropdown);
  infoSection.appendChild(wrapper);

  if (!outsideClickHandlerAttached) {
    document.addEventListener('click', event => {
      if (!dropdown || !wrapper) {
        return;
      }
      if (wrapper.contains(event.target)) {
        return;
      }
      hideMenu();
    });
    outsideClickHandlerAttached = true;
  }

  return true;
}

function createMenuButton(label, handler) {
  const option = document.createElement('button');
  option.type = 'button';
  option.textContent = label;
  option.style.background = 'transparent';
  option.style.border = 'none';
  option.style.color = '#ffffff';
  option.style.textAlign = 'left';
  option.style.width = '100%';
  option.style.padding = '10px 16px';
  option.style.fontSize = '13px';
  option.style.cursor = 'pointer';

  option.addEventListener('mouseenter', () => {
    option.style.background = 'rgba(255, 255, 255, 0.1)';
  });
  option.addEventListener('mouseleave', () => {
    option.style.background = 'transparent';
  });
  option.addEventListener('click', () => {
    hideMenu();
    handler();
  });

  return option;
}

function toggleMenu() {
  if (!dropdown) {
    return;
  }

  if (dropdown.style.display === 'none') {
    updateMenuState();
    dropdown.style.display = 'flex';
    dropdown.style.flexDirection = 'column';
  } else {
    dropdown.style.display = 'none';
  }
}

function hideMenu() {
  if (dropdown) {
    dropdown.style.display = 'none';
  }
}

function updateMenuState() {
  if (!cachedInfo) {
    setOptionState(audioChoice, false, 'Audio not found');
    setOptionState(videoChoice, false, '360p video not found');
    return;
  }

  const audioReady = Boolean(cachedInfo.audio && extractDownloadUrl(cachedInfo.audio));
  const videoReady = Boolean(cachedInfo.video && extractDownloadUrl(cachedInfo.video));

  setOptionState(audioChoice, audioReady, audioReady ? 'Download audio' : 'Audio not found');
  setOptionState(videoChoice, videoReady, videoReady ? 'Download 360p video' : '360p video not found');
}

function setOptionState(option, enabled, label) {
  if (!option) {
    return;
  }
  option.textContent = label;
  option.disabled = !enabled;
  option.style.opacity = enabled ? '1' : '0.5';
  option.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function getPlayerResponse() {
  const playerElement = document.querySelector('ytd-player');
  if (playerElement && typeof playerElement.getPlayerResponse === 'function') {
    const response = playerElement.getPlayerResponse();
    if (response && response.streamingData) {
      return response;
    }
  }

  if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
    return window.ytInitialPlayerResponse;
  }

  if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.player_response) {
    try {
      const parsed = JSON.parse(window.ytplayer.config.args.player_response);
      if (parsed && parsed.streamingData) {
        return parsed;
      }
    } catch (error) {
      // ignore invalid JSON
    }
  }

  return null;
}

function chooseFormats(response) {
  if (!response || !response.streamingData || !response.videoDetails) {
    cachedInfo = null;
    return;
  }

  const { videoDetails, streamingData } = response;
  const title = videoDetails.title || 'YouTube video';
  const formats = Array.isArray(streamingData.formats) ? streamingData.formats : [];
  const adaptive = Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : [];

  const audioFormats = adaptive.filter(item => typeof item.mimeType === 'string' && item.mimeType.includes('audio/'));
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const bestAudio = audioFormats.length > 0 ? audioFormats[0] : null;

  let video360 = formats.find(item => item.qualityLabel === '360p');
  if (!video360) {
    video360 = adaptive.find(item => item.qualityLabel === '360p' && typeof item.mimeType === 'string' && item.mimeType.includes('video/')) || null;
  }

  cachedInfo = {
    title,
    audio: bestAudio,
    video: video360
  };
}

function extractDownloadUrl(format) {
  if (!format) {
    return null;
  }

  if (format.url) {
    return format.url;
  }

  const cipherText = format.signatureCipher || format.cipher;
  if (!cipherText) {
    return null;
  }

  const params = new URLSearchParams(cipherText);
  const baseUrl = params.get('url');
  const signature = params.get('sig') || params.get('signature');
  const sp = params.get('sp') || 'signature';

  if (baseUrl && signature) {
    return `${baseUrl}&${sp}=${signature}`;
  }

  if (baseUrl && !params.get('s')) {
    return baseUrl;
  }

  return null;
}

function determineExtension(format, kind) {
  if (!format || !format.mimeType) {
    return kind === 'audio' ? 'mp3' : 'mp4';
  }

  const mime = format.mimeType.toLowerCase();
  if (mime.includes('webm')) {
    return 'webm';
  }
  if (mime.includes('mp4')) {
    return kind === 'audio' ? 'm4a' : 'mp4';
  }
  if (mime.includes('ogg')) {
    return 'ogg';
  }
  if (mime.includes('mpeg')) {
    return 'mp3';
  }

  return kind === 'audio' ? 'mp3' : 'mp4';
}

function handleDownload(kind) {
  if (!cachedInfo) {
    alert('Video information is not ready yet.');
    return;
  }

  const target = kind === 'audio' ? cachedInfo.audio : cachedInfo.video;
  if (!target) {
    alert(kind === 'audio' ? 'Audio stream not available.' : '360p video stream not available.');
    return;
  }

  const url = extractDownloadUrl(target);
  if (!url) {
    alert('Download URL is not available for this stream.');
    return;
  }

  const extension = determineExtension(target, kind);
  const filename = `${sanitizeFileName(cachedInfo.title)}-${kind}.${extension}`;

  sendMessage({ action: 'download', url, filename })
    .then(response => {
      if (response && response.success === false) {
        alert(`Download failed: ${response.error}`);
      }
    })
    .catch(error => {
      const message = error && error.message ? error.message : String(error);
      alert(`Download failed: ${message}`);
    });
}

function sendMessage(message) {
  if (usesNativePromises) {
    return runtime.runtime.sendMessage(message);
  }

  return new Promise((resolve, reject) => {
    runtime.runtime.sendMessage(message, response => {
      if (runtime.runtime.lastError) {
        reject(new Error(runtime.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function refresh() {
  if (!ensureUi()) {
    cachedInfo = null;
    updateMenuState();
    return;
  }

  const response = getPlayerResponse();
  if (!response || !response.videoDetails) {
    cachedInfo = null;
    updateMenuState();
    return;
  }

  const videoId = response.videoDetails.videoId || null;
  if (videoId && videoId === lastVideoId && cachedInfo) {
    updateMenuState();
    return;
  }

  lastVideoId = videoId;
  chooseFormats(response);
  updateMenuState();
}

function startObserver() {
  if (observerStarted) {
    return;
  }
  const watchFlexy = document.querySelector('ytd-watch-flexy');
  if (!watchFlexy) {
    return;
  }

  const observer = new MutationObserver(() => {
    refresh();
  });
  observer.observe(watchFlexy, { childList: true, subtree: true });
  observerStarted = true;
}

function init() {
  refresh();
  startObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.addEventListener('yt-navigate-finish', () => {
  setTimeout(refresh, 600);
});

setInterval(refresh, 3000);
