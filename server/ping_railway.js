const axios = require('axios');
const fs = require('fs');
const https = require('https');

const SERVER_URL = "https://biohack-video-gen-server-production.up.railway.app";

async function runLiveTest() {
    console.log("Starting 1-minute video generation on Railway server...");
    
    return new Promise(async (resolve, reject) => {
        // Start listening to logs first
        const logReq = https.get(`${SERVER_URL}/api/logs`, (res) => {
            res.on('data', (chunk) => {
                const dataStr = chunk.toString();
                const lines = dataStr.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const log = line.replace('data: ', '').trim();
                        if (log) {
                            try {
                                const parsed = JSON.parse(log);
                                if (parsed.event === "complete") {
                                    console.log(`[LIVE SUCCESS] Final Video: ${parsed.videoUrl}`);
                                    logReq.abort();
                                    resolve();
                                } else if (parsed.event === "error") {
                                    console.log(`[LIVE ERROR] Generation failed: ${parsed.message}`);
                                    logReq.abort();
                                    reject(new Error(parsed.message));
                                } else {
                                    console.log(`[LIVE] ${parsed.message || JSON.stringify(parsed)}`);
                                }
                            } catch (e) {
                                console.log(`[LIVE] ${log}`);
                            }
                        }
                    }
                }
            });
        });

        try {
            await axios.post(`${SERVER_URL}/api/generate`, { minutes: 1 }, { timeout: 30000 });
            console.log("-> POST successful. Waiting for background generation...");
        } catch (err) {
            console.error("FAIL! Could not start generation:", err.message);
            logReq.abort();
            reject(err);
        }
    });
}

runLiveTest().then(() => console.log("Test finished")).catch(e => console.error(e));
