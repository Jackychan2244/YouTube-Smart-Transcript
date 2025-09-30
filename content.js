var g_transcriptData = [];
var keywordData = [];
var currentLine = -1;
let currentKeywordIdx = -1;
let animFrameId = null;
var activeTab = 'transcript';
let keywordsAreLoading = false;
let keywordsProcessed = false;
let observer = null;
let heartbeatTimer = null;

const DEEPAI_HACK_URL = "https://api.deepai.org/hacking_is_a_serious_crime";
const deepAiKey = "tryit-45613178969-7a1e9069d97386f14f496c969a224d58";


function formatTime(t) {
    const secs = Math.floor(t / 1000);
    const mins = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `[${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
}

async function callAI(messages) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({
                type: 'callAI',
                messages,
                aiConfig: {
                    url: DEEPAI_HACK_URL,
                    apiKey: deepAiKey
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.data);
                } else {
                    reject(new Error(response ? response.error : "Unknown error from background script."));
                }
            });
        } catch (e) {
            reject(new Error(`Failed to send message: ${e.message}`));
        }
    });
}

function startHeartbeat() {
    if(heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        // console.log("ping bg...");
        chrome.runtime.sendMessage({ type: 'ping' }, (res) => {
            if (chrome.runtime.lastError) {
                console.warn("Heartbeat failed, bg script might be dead.", chrome.runtime.lastError.message);
                if(heartbeatTimer) clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        });
    }, 15000); // 15 seconds
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}


async function analyzeKeywords() {
    if (keywordsAreLoading || keywordsProcessed) return;

    console.log("Starting keyword analysis...");
    keywordsAreLoading = true;
    startHeartbeat();
    const keywordContainer = document.getElementById('keywords-content');

    keywordData = [];
    const processedWords = new Set();

    try {
        const fullText = g_transcriptData.map(line => line.text).join(' ');
        if (fullText.length < 50) {
            throw new Error("Transcript too short.");
        }

        const CHUNK_SIZE = 2500;
        const chunks = [];
        for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
            chunks.push(fullText.substring(i, i + CHUNK_SIZE));
        }

        for (let i = 0; i < chunks.length; i++) {
            if (keywordContainer) keywordContainer.innerHTML = `<div>Analyzing text chunk ${i + 1} of ${chunks.length}...</div>`;
            renderKeywords(); // Make sure the old keywords are still visible under the status

            const prompt_for_words = `You are analyzing text for English learners at B2 level. Find 5-10 difficult/advanced words or phrases (2-3 words) from this text that a B2 learner would struggle with. Return ONLY the words/phrases separated by commas, nothing else. No explanations, no sentences, just: word1, phrase one, word2\n\nText: ${chunks[i]}`;

            const wordsResult = await callAI([{ role: "user", content: prompt_for_words }]);
            const foundWords = wordsResult.split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(w => w.length > 2 && w);
            const newWords = foundWords.filter(word => !processedWords.has(word));

            if (newWords.length === 0) continue;
            
            let synonymMap = {};
            try {
                const synonymsResult = await callAI([{ role: "user", content: `For the following list, provide a simpler synonym for each. Return a single valid JSON object where the key is the original word/phrase and the value is the simpler synonym. List: ${newWords.join(', ')}` }]);
                const jsonMatch = synonymsResult.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    console.error(`Synonym prompt returned no JSON block. Got: "${synonymsResult}"`);
                    continue;
                }
                synonymMap = JSON.parse(jsonMatch[0]);

            } catch (jsonError) {
                // AI gave us bad JSON, what a surprise. Just log it and skip this chunk.
                console.warn("Could not parse JSON from AI, skipping this chunk.", jsonError);
                continue; 
            }

            for (const original of newWords) {
                if (synonymMap[original] && !processedWords.has(original)) {
                    const line = g_transcriptData.find(l => l.text.toLowerCase().includes(original));
                    if (line) {
                        keywordData.push({ startTime: line.startTime, original: original, synonym: synonymMap[original] });
                        processedWords.add(original);
                    }
                }
            }
            renderKeywords(); // update ui
        }
        keywordsProcessed = true;

    } catch (error) {
        console.error("Keyword processing failed:", error);
        if (keywordContainer) keywordContainer.innerHTML = `<div>Error: ${error.message}</div>`;
    } finally {
        keywordsAreLoading = false;
        stopHeartbeat();
        if (keywordData.length === 0 && keywordContainer && !keywordsProcessed) {
             keywordContainer.innerHTML = '<div>No complex keywords found.</div>';
        }
        // Final render to clean up the "analyzing..." message
        if (keywordContainer) {
            const statusDiv = keywordContainer.querySelector('div:first-child');
            if (statusDiv && statusDiv.innerText.startsWith('Analyzing')) {
                 renderKeywords();
            }
        }
    }
}


function renderKeywords() {
    const el = document.getElementById('keywords-content');
    if (!el) return;

    const statusDiv = el.querySelector('div:first-child');
    const statusHTML = statusDiv && statusDiv.innerText.startsWith('Analyzing') ? statusDiv.outerHTML : '';
    
    // Clear everything BUT the status message and the already-found keywords
    el.innerHTML = statusHTML;

    keywordData.sort((a, b) => a.startTime - b.startTime);

    keywordData.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'keyword_line';
        div.dataset.index = index;
        div.dataset.starttime = item.startTime;
        div.innerHTML = `${formatTime(item.startTime)} <span class="keyword-original">${item.original}</span> → <span class="keyword-synonym">${item.synonym}</span>`;
        el.appendChild(div);
    });
}


function renderTranscript() {
    const el = document.getElementById('transcript-content');
    if (!el) return;
    el.innerHTML = '';
    g_transcriptData.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'transcript_line';
        div.dataset.index = index;
        div.innerText = `${formatTime(item.startTime)} ${item.text}`;
        el.appendChild(div);
    });
}


function updateHighlight() {
    const video = document.querySelector('video');
    if (!video) return null;
    const cTime = video.currentTime * 1000;

    if (activeTab === 'transcript') {
        const lines = document.querySelectorAll('.transcript_line');
        if (lines.length === 0 || g_transcriptData.length === 0) return null;
        let newIdx = g_transcriptData.findIndex((line, i) => {
            const nextLine = g_transcriptData[i + 1];
            return cTime >= line.startTime && (!nextLine || cTime < nextLine.startTime);
        });
        if (newIdx !== -1 && newIdx !== currentLine) {
            if (currentLine !== -1 && lines[currentLine]) lines[currentLine].classList.remove('highlight');
            if (lines[newIdx]) lines[newIdx].classList.add('highlight');
            currentLine = newIdx;
            return { element: lines[newIdx] };
        }
    } else if (activeTab === 'keywords') {
        const lines = document.querySelectorAll('.keyword_line');
        if (lines.length === 0 || keywordData.length === 0) return null;
        
        let newIdx = -1;
        for (let i = keywordData.length - 1; i >= 0; i--) {
            if (cTime >= keywordData[i].startTime) {
                newIdx = i;
                break;
            }
        }

        if (newIdx !== -1 && newIdx !== currentKeywordIdx) {
            if (currentKeywordIdx !== -1 && lines[currentKeywordIdx]) lines[currentKeywordIdx].classList.remove('highlight');
            if (lines[newIdx]) lines[newIdx].classList.add('highlight');
            currentKeywordIdx = newIdx;
            return { element: lines[newIdx] };
        }
    }
    return null;
}

const animationLoop = () => {
    const updateInfo = updateHighlight();
    if (updateInfo && updateInfo.element) {
        const container = document.getElementById('bar-content');
        const bar = document.getElementById('yt-smart-bar');
        if (container && bar && !bar.classList.contains('collapsed')) {
            const targetScroll = updateInfo.element.offsetTop - (container.clientHeight / 2) + (updateInfo.element.clientHeight / 2);
            container.scrollTop = targetScroll;
        }
    }
    animFrameId = requestAnimationFrame(animationLoop);
};

const startLoop = () => { if (animFrameId) cancelAnimationFrame(animFrameId); animFrameId = requestAnimationFrame(animationLoop); };
const stopLoop = () => { if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }};

function setupVideoSync() {
    const video = document.querySelector('video');
    if (!video || video.dataset.sync) return;
    video.dataset.sync = 'true';
    video.addEventListener('play', startLoop);
    video.addEventListener('pause', stopLoop);
    video.addEventListener('ended', stopLoop);
    video.addEventListener('seeked', updateHighlight);
    if (!video.paused) startLoop();
}

function injectUI() {
    if (document.getElementById('yt-smart-bar')) return;
    const target = document.querySelector('#secondary-inner');
    if (!target) { setTimeout(injectUI, 500); return; }

    const bar = document.createElement('div');
    bar.id = 'yt-smart-bar';
    bar.innerHTML = `
        <div id="yt-bar-header">
            <div class="bar_tabs">
                <span class="bar_tab_item active" id="transcript-tab">Transcript</span>
                <span class="bar_tab_item" id="keywords-tab">Keywords</span>
            </div>
            <span class="collapse_btn">▲</span>
        </div>
        <div id="bar-content">
            <div class="content-pane active" id="transcript-content">Loading transcript...</div>
            <div class="content-pane" id="keywords-content">Click Keywords tab to analyze...</div>
        </div>
    `;
    target.prepend(bar);

    bar.querySelector('#transcript-tab').addEventListener('click', () => {
        activeTab = 'transcript';
        bar.querySelector('#transcript-tab').classList.add('active');
        bar.querySelector('#keywords-tab').classList.remove('active');
        bar.querySelector('#transcript-content').classList.add('active');
        bar.querySelector('#keywords-content').classList.remove('active');
    });
    bar.querySelector('#keywords-tab').addEventListener('click', () => {
        activeTab = 'keywords';
        bar.querySelector('#keywords-tab').classList.add('active');
        bar.querySelector('#transcript-tab').classList.remove('active');
        bar.querySelector('#keywords-content').classList.add('active');
        bar.querySelector('#transcript-content').classList.remove('active');
        if (g_transcriptData.length > 0) analyzeKeywords();
        else bar.querySelector('#keywords-content').innerHTML = '<div>Load transcript first.</div>';
    });
    bar.querySelector('.collapse_btn').addEventListener('click', (e) => {
        bar.classList.toggle('collapsed');
        e.target.textContent = bar.classList.contains('collapsed') ? '▼' : '▲';
    });
    bar.querySelector('#bar-content').addEventListener('click', (event) => {
        const lineEl = event.target.closest('.transcript_line, .keyword_line');
        if (!lineEl) return;
        let startTime;
        if (lineEl.classList.contains('transcript_line')) {
            startTime = g_transcriptData[parseInt(lineEl.dataset.index, 10)]?.startTime;
        } else {
            startTime = parseInt(lineEl.dataset.starttime, 10);
        }
        if (startTime !== undefined) {
            const vid = document.querySelector('video');
            if (vid) { vid.currentTime = startTime / 1000; vid.play(); }
        }
    });
}

function resetState() {
    console.log("New YT page, resetting...");
    stopLoop();
    stopHeartbeat();
    if (observer) observer.disconnect();

    g_transcriptData = [];
    keywordData = [];
    currentLine = -1;
    currentKeywordIdx = -1;
    keywordsProcessed = false;
    keywordsAreLoading = false;

    const bar = document.getElementById('yt-smart-bar');
    if (bar) {
        bar.querySelector('#transcript-content').innerHTML = 'Loading transcript...';
        bar.querySelector('#keywords-content').innerHTML = 'Click Keywords tab to analyze...';
    } else {
        injectUI();
    }
}

async function findTranscript() {
    if (g_transcriptData.length > 0) return true;
    console.log("Trying to find transcript...");

    const cc_button = document.querySelector('.ytp-subtitles-button');
    if (!cc_button) return false;

    const is_on = cc_button.getAttribute('aria-pressed') === 'true';
    if (is_on) {
        return true; // it should load automatically
    }

    // click it on and off to trigger the API call for timedtext
    cc_button.click();
    await new Promise(r => setTimeout(r, 100));
    cc_button.click();
    return true;
}

function initialize() {
    injectUI();
    setupVideoSync();

    let foundIt = false;

    observer = new PerformanceObserver((list) => {
        if (foundIt) return;
        const entry = list.getEntries().find(e => e.name.includes("youtube.com/api/timedtext"));
        if (entry) {
            foundIt = true;
            console.log("Intercepted transcript API call:", entry.name);
            observer.disconnect();
            fetch(entry.name)
                .then(res => res.text())
                .then(text => {
                    const data = JSON.parse(text);
                    if (data.events) {
                        g_transcriptData = data.events.filter(ev => ev.segs).map(ev => ({ startTime: ev.tStartMs, text: ev.segs.map(s => s.utf8).join('').trim() })).filter(line => line.text);
                        renderTranscript();
                        setupVideoSync();
                    }
                }).catch(e => {
                    console.error("Failed to parse transcript:", e);
                    const el = document.getElementById('transcript-content');
                    if(el) el.innerText = "Error parsing transcript data.";
                });
        }
    });
    observer.observe({ type: 'resource', buffered: true });

    setTimeout(() => {
        if (!foundIt) {
            console.log("Observer didn't find it, trying manual trigger.");
            findTranscript();
        }
    }, 3500);
}


document.addEventListener('yt-navigate-finish', () => {
    // YT is a single page app, need to re-init on navigation
    setTimeout(() => {
        resetState();
        initialize();
    }, 500);
});

// first run
initialize();