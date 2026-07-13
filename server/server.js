const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);
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
    const { durationMinutes = 1, topic, customTitle, customDescription, visualSource = 'ai_images', mainNiche = 'Science', subNiche = 'General' } = req.body;
    addLog(`Starting generation for ${durationMinutes} minutes on topic: ${topic || 'Default'} [Visuals: ${visualSource}]...`);
    
    // Start background job to prevent Railway 100s timeout
    generateVideoJob({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche, subNiche }).catch(err => {
        addLog(JSON.stringify({ event: "error", message: err.message }));
    });
    
    res.json({ message: "Generation started in the background" });
});

app.post('/api/idea', async (req, res) => {
    try {
        const { topic, mainNiche = "Science", subNiche = "General" } = req.body;
        const prompt = `You are an elite YouTube strategist in the "${mainNiche}" niche, specifically focusing on "${subNiche}". 
The user's specific idea/topic input is: "${topic || 'A generic video for this niche'}".
CRITICAL INSTRUCTION: If the user's input is a broad umbrella term, you MUST randomly select ONE highly specific, fascinating, and unique sub-topic or story from within that field. 
Every time you are called, pick a COMPLETELY DIFFERENT, highly specific angle to ensure massive variety.

Generate a highly clickable, psychologically compelling YouTube title about this SPECIFIC sub-topic. Use MrBeast or Ali Abdaal level of clickbait, leveraging curiosity gaps and strong emotional triggers, but keeping it factual. 
Also generate a highly engaging, long, and SEO-optimized YouTube description with emojis, bullet points, and related hashtags.
Output ONLY pure JSON with no markdown formatting:
{
  "title": "The ultimate viral YouTube title",
  "description": "A very engaging, long SEO description with emojis and hashtags"
}`;
        const chatCompletion = await openai.chat.completions.create({
            model: "x-ai/grok-4.5",
            messages: [{ role: "user", content: prompt }]
        });
        let jsonStr = chatCompletion.choices[0].message.content;
        if (jsonStr.startsWith('\`\`\`')) {
            jsonStr = jsonStr.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        }
        res.json(JSON.parse(jsonStr));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function generateVideoJob({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche = "Science", subNiche = "General" }) {
    try {
        const wordCount = durationMinutes * 130;
        
        let specificIdeaInstruction = "";
        if (customTitle) {
            specificIdeaInstruction = `
CRITICAL TOPIC REQUIREMENT:
The user has provided a SPECIFIC title and concept for this video. You MUST base the entire script exactly on this idea:
User Title: "${customTitle}"
User Description: "${customDescription || ''}"
Do NOT generate a random topic. You MUST strictly follow and explore this exact topic, while still generating the final optimized JSON title/description.`;
        }

        // --- UNIVERSAL NICHE PROMPTING ENGINE ---
        let nicheRules = "";
        if (mainNiche === "Stories & Fiction") {
            nicheRules = `
CRITICAL STORYTELLING RULES:
1. NARRATIVE ARC: Write a highly engaging, emotional story with a hook, rising action, climax, and satisfying resolution.
2. CONSISTENT CHARACTERS: If using AI Images, you MUST use the exact same detailed physical description for the main characters in EVERY SINGLE image prompt (e.g., "John, a tall 40-year-old man with a scarred cheek wearing a torn leather jacket"). Do NOT change their appearance between segments!
3. PACING: Build suspense. Use the expressive voiceover tags [whispering], [shouting], [crying] to make it feel like an audiobook.`;
        } else if (mainNiche === "Finance & Business") {
            nicheRules = `
CRITICAL FINANCE RULES:
1. AUTHORITY: Sound like a high-level financial insider. Use authoritative, fast-paced delivery.
2. VISUALS: Use luxury aesthetics, dynamic charts, wealthy environments, or abstract conceptual representations of money and markets.
3. ACTIONABLE: Provide actual value, case studies, or step-by-step breakdowns.`;
        } else {
            nicheRules = `
CRITICAL EDUCATIONAL RULES:
1. AUTHORITY: Sound like a top-tier documentary narrator (e.g., Huberman Lab style).
2. SCIENCE/FACTS: Provide deep, factual, fascinating insights. Do not just summarize; give specific actionable protocols or historical facts.
3. VISUALS: Keep visuals highly relevant, cinematic, and perfectly tied to the educational concept being explained.`;
        }

        const visualInstruction = visualSource === 'stock_videos'
            ? `"searchQuery": "A 1-3 word highly literal search query for a stock video API (e.g. 'dark alley', 'stock market crash', 'running snow'). Be extremely simple and literal."`
            : `"imagePrompt": "A highly detailed visual prompt for an AI image generator. The aesthetic MUST wildly vary to match the context of the sentence unless it is a story that requires consistent characters. Describe the scene, lighting, and composition."`;

        const systemPrompt = `You are an elite YouTube scriptwriter and retention expert specializing in the "${mainNiche}" niche, specifically focusing on "${subNiche}". 
Your goal is to write a highly viral, retention-optimized script for a horizontal YouTube video.
${specificIdeaInstruction}
${nicheRules}

CRITICAL DURATION REQUIREMENT:
The user requested a ${durationMinutes}-minute video. At normal speaking pace, you MUST write AT LEAST ${wordCount} words of narration total. Do NOT summarize. Do NOT finish early.

CRITICAL RULES FOR FAST-PACED RETENTION & VIRALITY:
1. THE HOOK: The first 5 seconds MUST be an aggressive, curiosity-inducing hook that makes clicking off impossible.
2. VISUAL PACING: Visuals must change RAPIDLY. Provide a new visual instruction for EVERY SINGLE SENTENCE or every 3-5 seconds of speaking.
3. TITLE & SEO: The title must be highly clickable and psychologically compelling, MrBeast or Ali Abdaal level of clickbait but factual. 
4. TAGS/HASHTAGS: Provide 10-15 highly targeted, algorithm-optimizing SEO long-tail keywords used by top creators.
5. DESCRIPTION: Write a very engaging, long SEO description with emojis and timestamps.
5. ABSOLUTE SAFETY & COMPLIANCE: Gemini TTS has a hyper-sensitive safety filter. Even for True Crime or Horror, you MUST NOT use banned words like "kill", "murder", "rape", "drug", "suicide", "blood", or "gore". Use safe alternatives like "eliminated", "dark fate", "perished", "tragic end", "substance", or "mystery". If you use banned words, the generation will instantly fail.

We are using Gemini 3.1 Flash TTS for the voiceover. You MUST utilize its expressive capabilities!
- Use inline tags inside the "narration" like [sigh], [laughing], [whispering], [shouting], [extremely fast], [short pause], [medium pause] to make it sound incredibly human and dynamic.
- Provide a "voicePrompt" for each segment describing the exact style, tone, pace, and emotion for that specific sentence.

Output pure JSON with the following structure:
{
  "title": "A highly clickable, viral YouTube title",
  "description": "YouTube video description optimized for SEO with chapters and engaging copy",
  "tags": ["huberman lab", "neuroplasticity protocol", "dopamine optimization", "cognitive performance"],
  "segments": [
    {
      "narration": "[extremely fast] Did you know that... [short pause] [whispering] your memory can be optimized?",
      "voicePrompt": "DIRECTOR'S NOTES: Intense, extremely fast-paced, dropping into a mysterious whisper at the end.",
      ${visualInstruction}
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

        const pexelsKey = "vGnr3wLcpfgybFLKKXjcPcqMOPc4MM89JJA1j2WpGfrKNh29XTHVualY";
        const pixabayKey = "54069102-5cb5de9252e9808a1e0d5f201";

        async function fetchStockVideo(query) {
            try {
                const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`, {
                    headers: { Authorization: pexelsKey }
                });
                if (res.data.videos && res.data.videos.length > 0) {
                    const video = res.data.videos[0];
                    const hdFile = video.video_files.find(f => f.quality === 'hd' || f.width >= 1280) || video.video_files[0];
                    return hdFile.link;
                }
            } catch (e) {
                console.warn("Pexels failed, falling back to Pixabay", e.message);
            }
            try {
                const res = await axios.get(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${encodeURIComponent(query)}&video_type=film&orientation=horizontal`);
                if (res.data.hits && res.data.hits.length > 0) {
                    const video = res.data.hits[0];
                    return video.videos.large.url || video.videos.medium.url || video.videos.small.url;
                }
            } catch (e) {
                console.warn("Pixabay failed", e.message);
            }
            throw new Error(`No stock videos found for query: ${query}`);
        }

        const getAudioDuration = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata.format.duration);
            });
        });

        // Generate all segments concurrently (limit concurrency to 4 to avoid rate limits)
        const generateSegment = async (i) => {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const segment = scriptData.segments[i];
            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Starting parallel asset generation...`);

            const visualExt = visualSource === 'stock_videos' ? 'mp4' : 'webp';
            const visualPath = path.join(projectDir, `visual_${i}.${visualExt}`);
            const audioPath = path.join(projectDir, `audio_${i}.wav`);

            // Run Visual and Audio concurrently
            await Promise.all([
                // VISUAL TASK
                (async () => {
                    if (visualSource === 'stock_videos') {
                        const query = segment.searchQuery || segment.imagePrompt || "science";
                        addLog(`[Segment ${i + 1}] Searching stock video for: ${query}...`);
                        const videoUrl = await withRetry(() => fetchStockVideo(query), `Stock Search ${i+1}`);
                        const videoBuffer = await withRetry(() => axios.get(videoUrl, { responseType: 'arraybuffer' }), `Download Stock Video ${i+1}`);
                        fs.writeFileSync(visualPath, videoBuffer.data);
                        addLog(`[Segment ${i + 1}] Stock Video downloaded.`);
                    } else {
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
                        fs.writeFileSync(visualPath, imgBuffer.data);
                        addLog(`[Segment ${i + 1}] Image downloaded.`);
                    }
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

            const audioDuration = await getAudioDuration(audioPath);
            clips[i] = { visual: visualPath, audio: audioPath, text: segment.narration, duration: audioDuration };
        };

        // Process API generation in chunks of 5 for MAXIMUM speed (protected by our new exponential backoff)
        const CHUNK_SIZE = 5;
        for (let i = 0; i < scriptData.segments.length; i += CHUNK_SIZE) {
            const chunk = [];
            for (let j = i; j < i + CHUNK_SIZE && j < scriptData.segments.length; j++) {
                chunk.push(generateSegment(j));
            }
            await Promise.all(chunk);
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        // Subtitle Generator Function (Mathematical Word Timing)
        function generateASS(text, durationSec, filepath) {
            const words = text.replace(/\[.*?\]/g, '').trim().split(/\s+/);
            if (words.length === 0) words.push("...");
            const timePerWord = durationSec / words.length;
            
            let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,90,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,10,10,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
            
            const formatASSTime = (sec) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const cs = Math.floor((sec % 1) * 100);
                return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
            };

            let currentStart = 0;
            // Group into 2-word chunks for fast-paced kinetic Hormozi style
            for (let i = 0; i < words.length; i += 2) {
                const chunk = words.slice(i, i + 2).join(' ');
                const chunkDuration = timePerWord * words.slice(i, i+2).length;
                const end = currentStart + chunkDuration;
                
                ass += `Dialogue: 0,${formatASSTime(currentStart)},${formatASSTime(end)},Default,,0,0,0,,{\\fad(50,50)}${chunk}\n`;
                currentStart = end;
            }
            fs.writeFileSync(filepath, ass);
        }

        addLog("Assets generated. Stitching clips with KINETIC SUBTITLES in parallel...");
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
                
                const assPath = path.join(projectDir, `sub_${j}.ass`);
                generateASS(clip.text, clip.duration, assPath);
                
                // Escape paths for FFmpeg filter on Windows
                const escapedAssPath = assPath.replace(/\\\\/g, '\\\\\\\\').replace(/:/g, '\\\\:');

                chunk.push(new Promise((resolve, reject) => {
                    let cmd = ffmpeg();
                    if (visualSource === 'stock_videos') {
                        cmd = cmd.input(clip.visual).inputOptions(['-stream_loop', '-1']);
                    } else {
                        cmd = cmd.input(clip.visual).loop();
                    }
                    
                    cmd.input(clip.audio)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .outputOptions([
                            '-map 0:v:0', // Only take video from input 0
                            '-map 1:a:0', // Only take audio from input 1
                            '-shortest',
                            '-pix_fmt yuv420p',
                            `-vf scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,ass='${escapedAssPath}'`,
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
            imageCount: scriptData.segments.length,
            mainNiche: mainNiche,
            subNiche: subNiche,
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
