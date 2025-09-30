// background.js

const multipart_body_template = '------WebKitFormBoundaryVoldemort\r\n' +
    'Content-Disposition: form-data; name="chat_style"\r\n\r\n' +
    'chat\r\n' +
    '------WebKitFormBoundaryVoldemort\r\n' +
    'Content-Disposition: form-data; name="chatHistory"\r\n\r\n' +
    '{history_json}\r\n' +
    '------WebKitFormBoundaryVoldemort\r\n' +
    'Content-Disposition: form-data; name="model"\r\n\r\n' +
    'standard\r\n' +
    '------WebKitFormBoundaryVoldemort\r\n' +
    'Content-Disposition: form-data; name="hacker_is_stinky"\r\n\r\n' +
    'very_stinky\r\n' +
    '------WebKitFormBoundaryVoldemort--\r\n';

function makeDeepAiPayload(prompt) {
    const chatHistory = [{ role: "user", content: prompt }];
    const historyJson = JSON.stringify(chatHistory);
    return multipart_body_template.replace("{history_json}", historyJson);
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.type === 'ping') {
        // console.log("ping from content script");
        sendResponse({ success: true, data: "pong" });
        return;
    }

    if (msg.type === 'callAI') {
        const { messages, aiConfig } = msg;

        const final_prompt = messages[0].content;
        const reqBody = makeDeepAiPayload(final_prompt);

        fetch(aiConfig.url, {
            method: 'POST',
            headers: {
                'Host': 'api.deepai.org',
                'Accept': '*/*',
                'api-key': aiConfig.apiKey,
                'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryVoldemort',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
                'Origin': 'https://deepai.org',
                'Connection': 'keep-alive',
                'Cookie': 'csrftoken=WIQ0uG573dO94lrZ3vuvDBYI3x18zcrf; user_sees_ads=false',
            },
            body: reqBody,
        })
        .then(res => {
            if (!res.ok) {
                return res.text().then(text => {
                    throw new Error(`API returned ${res.status}: ${text}`);
                });
            }
            return res.text();
        })
        .then(rawText => {
            sendResponse({ success: true, data: rawText.trim() });
        })
        .catch(err => {
            console.error("FETCH FAILED in background.js:", err);
            sendResponse({ success: false, error: err.message });
        });

        return true; // keep channel open for async response
    }
});

console.log("BG script running.");