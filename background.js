const api = typeof browser !== 'undefined' ? browser : chrome;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'download') {
    return false;
  }

  const { url, filename } = message;
  if (!url) {
    sendResponse({ success: false, error: 'Missing download URL.' });
    return false;
  }

  const details = {
    url,
    filename,
    saveAs: true
  };

  let callbackFired = false;

  try {
    const maybePromise = api.downloads.download(details, downloadId => {
      callbackFired = true;
      if (api.runtime.lastError) {
        sendResponse({ success: false, error: api.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });

    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise
        .then(downloadId => {
          if (!callbackFired) {
            sendResponse({ success: true, downloadId });
          }
        })
        .catch(error => {
          if (!callbackFired) {
            const message = error && error.message ? error.message : String(error);
            sendResponse({ success: false, error: message });
          }
        });
      return true;
    }

    if (!callbackFired) {
      return true;
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    sendResponse({ success: false, error: message });
  }

  return true;
});
