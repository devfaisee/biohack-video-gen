const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
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
    logStreamSubscribers.add(res);
    req.on('close', () => logStreamSubscribers.delete(res));
});

// Robust Retry Logic
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, operationName, maxRetries = 3, delayMs = 3000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) {
                addLog(`[FATAL] ${operationName} failed after ${maxRetries} attempts.`);
                throw err;
            }
            addLog(`[WARN] ${operationName} failed: ${err.message}. Retrying in ${delayMs/1000}s... (Attempt ${i+1}/${maxRetries})`);
            await sleep(delayMs);
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
      "imagePrompt": "A highly detailed visual prompt for an AI image generator (flux-schnell). Describe the scene, lighting, style (Dark Cinematic Tech, neon, sleek). Must be perfectly relevant to the sentence."
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

        // Generate Assets with Retry Logic
        for (let i = 0; i < scriptData.segments.length; i++) {
            const segment = scriptData.segments[i];
            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Generating assets...`);

            // 1. Generate Image
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

            const imgPath = path.join(projectDir, `img_${i}.webp`);
            const imgBuffer = await withRetry(() => axios.get(imageUrl, { responseType: 'arraybuffer' }), `Download Image ${i+1}`);
            fs.writeFileSync(imgPath, imgBuffer.data);
            addLog(`[Segment ${i + 1}] Image downloaded.`);

            // 2. Generate Audio
            addLog(`[Segment ${i + 1}] Requesting voiceover from Gemini 3.1 Flash TTS...`);
            addLog(`[Segment ${i + 1}] Narration text: "${segment.narration}"`);
            addLog(`[Segment ${i + 1}] Voice prompt: "${segment.voicePrompt}"`);
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
                    addLog(`[WARN] Gemini TTS threw an error on Segment ${i+1}: ${ttsError.message}`);
                    if (ttsError.message.includes("sensitive") || ttsError.message.includes("E005")) {
                        addLog(`[WARN] Retrying Segment ${i+1} audio with a sanitized, prompt-less fallback...`);
                        return await replicate.run(
                            "google/gemini-3.1-flash-tts",
                            {
                                input: {
                                    text: segment.narration.replace(/\[.*?\]/g, '').trim(), // strip tags
                                    voice: "Charon",
                                    language_code: "en-US"
                                    // completely removed voicePrompt
                                }
                            }
                        );
                    }
                    throw ttsError;
                }
            }, `Audio Gen ${i+1}`);
            
            const audioPath = path.join(projectDir, `audio_${i}.wav`);
            const audioBuffer = await withRetry(() => axios.get(audioUrl, { responseType: 'arraybuffer' }), `Download Audio ${i+1}`);
            fs.writeFileSync(audioPath, audioBuffer.data);
            addLog(`[Segment ${i + 1}] Voiceover downloaded.`);

            clips.push({ img: imgPath, audio: audioPath });
        }

        addLog("Stitching individual clips with FFmpeg...");
        const clipPaths = [];
        
        for (let i = 0; i < clips.length; i++) {
            addLog(`Encoding clip ${i + 1}/${clips.length}...`);
            const clipPath = path.join(projectDir, `clip_${i}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(clips[i].img)
                    .loop()
                    .input(clips[i].audio)
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .outputOptions([
                        '-shortest',
                        '-pix_fmt yuv420p',
                        '-vf scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080'
                    ])
                    .save(clipPath)
                    .on('end', resolve)
                    .on('error', reject);
            });
            clipPaths.push(clipPath);
        }

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
        addLog(`Video generated successfully: ${finalUrl}`);
        
        // Broadcast success to frontend
        addLog(JSON.stringify({
            event: "complete",
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: finalUrl
        }));

    } catch (err) {
        addLog(JSON.stringify({ event: "error", message: err.message }));
    }
}

app.use('/output', express.static(outputDir));

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
