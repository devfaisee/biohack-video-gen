const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegStatic);
const crypto = require('crypto');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Check for required directories
const tmpDir = path.join(__dirname, 'tmp');
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || "dummy_key_to_prevent_crash_on_boot",
    baseURL: "https://openrouter.ai/api/v1"
});

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

// Server Sent Events for Live Logs
const logStreamSubscribers = new Set();
let currentLogs = [];

function addLog(msg) {
    console.log(msg);
    currentLogs.push(msg);
    if (currentLogs.length > 200) currentLogs.shift();
    for(const res of logStreamSubscribers) {
        res.write(`data: ${JSON.stringify({log: msg})}\n\n`);
    }
}

app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send existing logs immediately so a refresh doesn't wipe out context
    for(const log of currentLogs) {
        res.write(`data: ${JSON.stringify({log})}\n\n`);
    }
    
    logStreamSubscribers.add(res);
    req.on('close', () => logStreamSubscribers.delete(res));
});

// Robust Retry Logic with Exponential Backoff
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, operationName, maxRetries = 6, baseDelayMs = 4000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) {
                addLog(`[FATAL] ${operationName} failed after ${maxRetries} attempts.`);
                throw err;
            }
            // Exponential backoff: 4s, 6s, 9s, 13.5s, 20s...
            const currentDelay = Math.round(baseDelayMs * Math.pow(1.5, i));
            addLog(`[WARN] ${operationName} failed: ${err.message}. Retrying in ${Math.round(currentDelay/1000)}s... (Attempt ${i+1}/${maxRetries})`);
            await sleep(currentDelay);
        }
    }
}

app.post('/api/generate', (req, res) => {
    const { durationMinutes = 1 } = req.body;
    addLog(`Starting generation for ${durationMinutes} minutes...`);
    
    // Start background job to prevent Railway 100s timeout
    generateVideoJob(durationMinutes).catch(err => {
        addLog(JSON.stringify({ event: "error", message: err.message }));
    });
    
    res.json({ message: "Generation started in the background" });
});

async function generateVideoJob(durationMinutes) {
    try {
        const wordCount = durationMinutes * 130;
        const systemPrompt = `You are an elite YouTube scriptwriter and retention expert specializing in the Psychology, Neuroscience, and Biohacking niche. 
Your goal is to write a highly viral, retention-optimized script for a horizontal YouTube video.
The script should be approximately ${wordCount} words total.
CRITICAL RULES FOR FAST-PACED RETENTION:
1. The first 5 seconds MUST be an aggressive, curiosity-inducing hook.
2. Visuals must change RAPIDLY. Provide a new visual prompt for EVERY SINGLE SENTENCE or every 3-5 seconds of speaking. Do NOT group multiple sentences into one segment.
3. The tone should be punchy, mysterious, and highly engaging.
4. ABSOLUTE SAFETY & COMPLIANCE: Gemini TTS has a hyper-sensitive safety filter and will instantly ban the generation if it detects ANY sensitive language. You MUST NOT use words like "hacking", "manipulating", "lying", "drug", "addiction", "kill", "harm", or "trick". Use perfectly safe, uplifting, and strictly scientific terminology (e.g., "optimizing", "understanding", "neuroplasticity"). Make it sound educational and safe for children.

We are using Gemini 3.1 Flash TTS for the voiceover. You MUST utilize its expressive capabilities!
- Use inline tags inside the "narration" like [sigh], [laughing], [whispering], [shouting], [extremely fast], [short pause], [medium pause] to make it sound incredibly human and dynamic.
- Provide a "voicePrompt" for each segment describing the exact style, tone, pace, and emotion for that specific sentence.

Output pure JSON with the following structure:
{
  "title": "A highly clickable, viral YouTube title",
  "description": "YouTube video description optimized for SEO",
  "tags": ["neuroscience", "optimization", "viral"],
  "segments": [
    {
      "narration": "[extremely fast] Did you know that... [short pause] [whispering] your memory can be optimized?",
      "voicePrompt": "DIRECTOR'S NOTES: Intense, extremely fast-paced, dropping into a mysterious whisper at the end.",
      "imagePrompt": "A highly detailed visual prompt for an AI image generator (flux-schnell). Instruct the AI to intelligently choose a highly professional, dynamic, and consistent cinematic documentary style (do not force 'neon' or any specific aesthetic unless highly relevant to the topic). Describe the scene, lighting, and composition. Must be perfectly relevant to the sentence."
    }
  ]
}
Ensure the JSON is strictly valid and contains no markdown formatting around it.`;

        addLog("Generating script via Grok 4.5 (OpenRouter)...");
        const chatCompletion = await withRetry(async () => {
            return await openai.chat.completions.create({
                model: "x-ai/grok-4.5", 
                messages: [{ role: "user", content: systemPrompt }]
            });
        }, "Script Generation (Grok)");

        let jsonStr = chatCompletion.choices[0].message.content;
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json\n/, '').replace(/\n```$/, '');
        }

        const scriptData = JSON.parse(jsonStr);
        addLog(`Script generated successfully. Total segments: ${scriptData.segments.length}`);

        const videoId = crypto.randomUUID();
        const projectDir = path.join(tmpDir, videoId);
        fs.mkdirSync(projectDir);

        const clips = [];
        
        // Expose a global abort controller for the current job
        const abortController = new AbortController();
        global.currentJob = { id: videoId, abort: () => abortController.abort() };

        addLog(`Starting parallel generation of ${scriptData.segments.length} segments...`);

        // Generate all segments concurrently (limit concurrency to 4 to avoid rate limits)
        const generateSegment = async (i) => {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const segment = scriptData.segments[i];
            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Starting parallel asset generation...`);

            const imgPath = path.join(projectDir, `img_${i}.webp`);
            const audioPath = path.join(projectDir, `audio_${i}.wav`);

            // Run Image and Audio concurrently
            await Promise.all([
                // IMAGE TASK
                (async () => {
                    addLog(`[Segment ${i + 1}] Requesting image from Flux-Schnell...`);
                    const imageUrl = await withRetry(async () => {
                        const imgRes = await replicate.run(
                            "black-forest-labs/flux-schnell",
                            {
                                input: {
                                    prompt: segment.imagePrompt + ", 16:9, cinematic, highly detailed, 4k resolution, youtube thumbnail style",
                                    aspect_ratio: "16:9",
                                    output_format: "webp",
                                    num_outputs: 1
                                }
                            }
                        );
                        return imgRes[0];
                    }, `Image Gen ${i+1}`);
                    const imgBuffer = await withRetry(() => axios.get(imageUrl, { responseType: 'arraybuffer' }), `Download Image ${i+1}`);
                    fs.writeFileSync(imgPath, imgBuffer.data);
                    addLog(`[Segment ${i + 1}] Image downloaded.`);
                })(),

                // AUDIO TASK
                (async () => {
                    addLog(`[Segment ${i + 1}] Requesting voiceover from Gemini 3.1 Flash TTS...`);
                    const audioUrl = await withRetry(async () => {
                        try {
                            return await replicate.run(
                                "google/gemini-3.1-flash-tts",
                                {
                                    input: {
                                        text: segment.narration,
                                        voice: "Charon", 
                                        prompt: segment.voicePrompt,
                                        language_code: "en-US"
                                    }
                                }
                            );
                        } catch (ttsError) {
                            if (ttsError.message.includes("sensitive") || ttsError.message.includes("E005")) {
                                addLog(`[WARN] Retrying Segment ${i+1} audio with a sanitized, prompt-less fallback...`);
                                return await replicate.run(
                                    "google/gemini-3.1-flash-tts",
                                    {
                                        input: {
                                            text: segment.narration.replace(/\[.*?\]/g, '').trim(),
                                            voice: "Charon",
                                            language_code: "en-US"
                                        }
                                    }
                                );
                            }
                            throw ttsError;
                        }
                    }, `Audio Gen ${i+1}`);
                    const audioBuffer = await withRetry(() => axios.get(audioUrl, { responseType: 'arraybuffer' }), `Download Audio ${i+1}`);
                    fs.writeFileSync(audioPath, audioBuffer.data);
                    addLog(`[Segment ${i + 1}] Voiceover downloaded.`);
                })()
            ]);

            clips[i] = { img: imgPath, audio: audioPath };
        };

        // Process API generation in chunks of 3 to avoid extreme rate limits
        const CHUNK_SIZE = 3;
        for (let i = 0; i < scriptData.segments.length; i += CHUNK_SIZE) {
            const chunk = [];
            for (let j = i; j < i + CHUNK_SIZE && j < scriptData.segments.length; j++) {
                chunk.push(generateSegment(j));
            }
            await Promise.all(chunk);
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        addLog("Assets generated. Stitching clips in parallel (Chunked) for maximum speed...");
        const clipPaths = new Array(clips.length);
        
        // Run FFmpeg processes in parallel chunks (safe for 8GB RAM)
        const FFMPEG_CHUNK_SIZE = 4; 
        for (let i = 0; i < clips.length; i += FFMPEG_CHUNK_SIZE) {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            
            const chunk = [];
            for (let j = i; j < i + FFMPEG_CHUNK_SIZE && j < clips.length; j++) {
                const clip = clips[j];
                const clipPath = path.join(projectDir, `clip_${j}.mp4`);
                clipPaths[j] = clipPath;
                
                chunk.push(new Promise((resolve, reject) => {
                    ffmpeg()
                        .input(clip.img)
                        .loop()
                        .input(clip.audio)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .outputOptions([
                            '-shortest',
                            '-pix_fmt yuv420p',
                            '-vf scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
                            '-preset veryfast', // Drastically speeds up encoding
                            '-threads 2' // Balances CPU load across parallel processes
                        ])
                        .save(clipPath)
                        .on('end', resolve)
                        .on('error', reject);
                }));
            }
            
            addLog(`Encoding clips ${i + 1} to ${Math.min(i + FFMPEG_CHUNK_SIZE, clips.length)} of ${clips.length}...`);
            await Promise.all(chunk);
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        addLog("Concatenating clips into final video...");
        const listPath = path.join(projectDir, 'list.txt');
        const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(listPath, listContent);

        const finalVideoPath = path.join(outputDir, `${videoId}.mp4`);
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions('-c copy')
                .save(finalVideoPath)
                .on('end', resolve)
                .on('error', reject);
        });

        const finalUrl = `/output/${videoId}.mp4`;
        
        // Save metadata for the Library
        const metadata = {
            id: videoId,
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: finalUrl,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(outputDir, `${videoId}.json`), JSON.stringify(metadata, null, 2));

        addLog(`Video generated successfully: ${finalUrl}`);
        
        // Broadcast success to frontend
        addLog(JSON.stringify({
            event: "complete",
            ...metadata
        }));

    } catch (err) {
        addLog(JSON.stringify({ event: "error", message: err.message, id: global.currentJob?.id || "unknown" }));
        
        // Save failed run to history so the user can see what happened
        const errorId = global.currentJob?.id || crypto.randomUUID();
        const errorMetadata = {
            id: errorId,
            title: "Failed Generation",
            description: "This video generation failed due to an error: " + err.message,
            status: "error",
            error: err.message,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(outputDir, `${errorId}_error.json`), JSON.stringify(errorMetadata, null, 2));

    } finally {
        global.currentJob = null;
    }
}

app.post('/api/cancel', (req, res) => {
    if (global.currentJob) {
        global.currentJob.abort();
        global.currentJob = null;
        res.json({ message: "Generation Cancelled successfully." });
    } else {
        res.json({ message: "No active generation to cancel." });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ isRunning: !!global.currentJob, currentJobId: global.currentJob?.id || null });
});

// Endpoint to fetch all previously generated videos
app.get('/api/videos', (req, res) => {
    try {
        const files = fs.readdirSync(outputDir);
        const videos = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = JSON.parse(fs.readFileSync(path.join(outputDir, file), 'utf8'));
                videos.push(data);
            }
        }
        // Sort by newest first
        videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(videos);
    } catch (err) {
        console.error("Error reading video library:", err);
        res.status(500).json({ error: "Failed to read videos" });
    }
});

app.use('/output', express.static(outputDir));

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
