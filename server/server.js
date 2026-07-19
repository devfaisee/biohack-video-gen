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
    // GUARD: Prevent duplicate concurrent generations
    if (global.currentJob) {
        return res.status(409).json({ error: "A generation is already in progress. Please wait or cancel it first." });
    }

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
        
        if (!chatCompletion || !chatCompletion.choices || chatCompletion.choices.length === 0) {
            throw new Error("AI API failed to return a valid response for the idea. Please try again.");
        }

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
        // --- EXPANDED NICHE-SPECIFIC PROMPTING ENGINE (24 Categories) ---
        let nicheRules = "";
        const nicheKey = mainNiche.toLowerCase();
        if (nicheKey.includes("revenge") || nicheKey.includes("justice")) {
            nicheRules = `
CRITICAL STORYTELLING RULES FOR REVENGE/JUSTICE STORIES:
1. NARRATIVE ARC: Write an emotionally gripping story with a clear victim, villain, build-up, and SATISFYING payback at the climax.
2. CONSISTENT CHARACTERS: Use the EXACT SAME detailed physical description for recurring characters in EVERY image prompt.
3. EMOTIONAL PEAKS: Use [whispering], [shouting], [short pause] at tension points. Make the listener feel the injustice AND the satisfaction of revenge.
4. PACING: Start with the outrageous offense, build frustration, then deliver the sweet revenge slowly.`;
        } else if (nicheKey.includes("true crime") || nicheKey.includes("criminal")) {
            nicheRules = `
CRITICAL TRUE CRIME RULES:
1. TONE: Sound like a seasoned crime documentary narrator — grave, measured, and authoritative.
2. SUSPENSE: Build tension methodically. Use [whispering] for chilling details, [short pause] before reveals.
3. FACTS: Include specific dates, locations, and investigator names when possible to build credibility.
4. VISUALS: Use dark, moody, noir-style imagery — dimly lit streets, evidence boards, courtrooms, shadowy figures.
5. SAFETY: Use safe alternatives for violent words: "eliminated", "tragic end", "perished", "vanished".`;
        } else if (nicheKey.includes("horror") || nicheKey.includes("creepypasta")) {
            nicheRules = `
CRITICAL HORROR RULES:
1. ATMOSPHERE: Build dread slowly. Start normal, then let wrongness creep in gradually.
2. SOUND DESIGN: Use [whispering] extensively. Use [extremely fast] for panic moments. Use [medium pause] to let silence create tension.
3. VISUALS: Dark, unsettling, liminal space imagery. Empty hallways, fog, distorted faces, eerie landscapes.
4. NEVER RESOLVE FULLY: Leave a lingering sense of unease. The best horror doesn't fully explain everything.`;
        } else if (nicheKey.includes("psychology") || nicheKey.includes("dark")) {
            nicheRules = `
CRITICAL DARK PSYCHOLOGY RULES:
1. TONE: Sound like a knowledgeable insider revealing hidden truths — confident, slightly conspiratorial.
2. EXAMPLES: Every concept MUST include a vivid real-world example or scenario the viewer can relate to.
3. STRUCTURE: Present each tactic/concept as a numbered "law" or "technique" for maximum retention.
4. VISUALS: Use shadowy corporate settings, chess pieces, puppet strings, maze imagery, people in crowds.`;
        } else if (nicheKey.includes("stoicism") || nicheKey.includes("philosophy")) {
            nicheRules = `
CRITICAL PHILOSOPHY RULES:
1. TONE: Sound wise, contemplative, and profound — like Marcus Aurelius speaking to a student.
2. QUOTES: Weave in actual philosophical quotes from original texts, then explain them in modern language.
3. APPLICATION: Every philosophical concept MUST be connected to a modern-day practical application.
4. VISUALS: Ancient marble statues, mountain landscapes, forests, rain, campfires, ancient libraries, scrolls.`;
        } else if (nicheKey.includes("military") || nicheKey.includes("warfare")) {
            nicheRules = `
CRITICAL MILITARY RULES:
1. TONE: Sound like a military analyst briefing — authoritative, tactical, precise.
2. TECHNICAL DETAIL: Include specific equipment specs, troop numbers, tactical formations when relevant.
3. DRAMA: Highlight the human element — soldiers' decisions under pressure, turning points in battles.
4. VISUALS: Tanks, aircraft, naval vessels, maps with arrows, military formations, explosions, uniforms.`;
        } else if (nicheKey.includes("unethical") || nicheKey.includes("grey")) {
            nicheRules = `
CRITICAL GREY AREA RULES:
1. TONE: Sound like an investigative journalist exposing hidden systems — knowledgeable, slightly outraged.
2. FRAMING: Always frame as EDUCATIONAL — "Here's how this works so you can PROTECT YOURSELF."
3. EVIDENCE: Cite specific companies, laws, or case studies to build credibility.
4. VISUALS: Corporate boardrooms, fine print documents, bank vaults, surveillance cameras, courtrooms.`;
        } else if (nicheKey.includes("space") || nicheKey.includes("universe") || nicheKey.includes("science")) {
            nicheRules = `
CRITICAL SCIENCE/SPACE RULES:
1. TONE: Sound like a top-tier documentary narrator — Huberman Lab meets Neil deGrasse Tyson.
2. SCALE: Emphasize mind-blowing scale comparisons ("If Earth were a grain of sand...").
3. FACTS: Provide deep, specific, fascinating insights with exact numbers and recent discoveries.
4. VISUALS: Nebulas, galaxies, microscopic cells, laboratory equipment, scientific diagrams, DNA strands.`;
        } else if (nicheKey.includes("history") || nicheKey.includes("civiliz") || nicheKey.includes("geopolit")) {
            nicheRules = `
CRITICAL HISTORY RULES:
1. TONE: Sound like an epic documentary narrator — dramatic, grand, painting vast historical canvases.
2. STORYTELLING: Frame history as a STORY with characters, motivations, betrayals, and consequences.
3. DETAILS: Include specific dates, names of key figures, and cause-effect chains.
4. VISUALS: Ancient ruins, battle paintings, maps, period-appropriate architecture, crowns, scrolls, armor.`;
        } else if (nicheKey.includes("rise") || nicheKey.includes("fall")) {
            nicheRules = `
CRITICAL RISE & FALL RULES:
1. STRUCTURE: Follow the classic arc — humble beginnings, meteoric rise, fatal flaw, spectacular collapse.
2. HUMAN ELEMENT: Focus on the specific decisions and people that caused the rise AND the fall.
3. LESSONS: End with clear takeaways the viewer can apply to their own life or business.
4. VISUALS: Corporate offices, product shots, stock charts going up then crashing, empty buildings, headlines.`;
        } else if (nicheKey.includes("luxury") || nicheKey.includes("motivation")) {
            nicheRules = `
CRITICAL LUXURY/MOTIVATION RULES:
1. TONE: Sound like a high-level mentor — authoritative, intense, fast-paced, no fluff.
2. VISUALS: Supercars, penthouses, yachts, watches, private jets, city skylines at night, gym sessions.
3. STRUCTURE: Open with a powerful quote or shocking fact, then deliver rapid-fire value.
4. ENERGY: Maintain relentless intensity. Use [extremely fast] for key sections.`;
        } else if (nicheKey.includes("finance") || nicheKey.includes("wealth") || nicheKey.includes("money")) {
            nicheRules = `
CRITICAL FINANCE RULES:
1. AUTHORITY: Sound like a high-level financial insider. Use authoritative, fast-paced delivery.
2. VISUALS: Luxury aesthetics, dynamic charts, wealthy environments, abstract money representations.
3. ACTIONABLE: Provide actual value, case studies, or step-by-step breakdowns.`;
        } else if (nicheKey.includes("survival") || nicheKey.includes("disaster")) {
            nicheRules = `
CRITICAL SURVIVAL/DISASTER RULES:
1. TONE: Start calm, then escalate urgency as the disaster unfolds.
2. TIMELINE: Present events chronologically with specific times and dates for maximum immersion.
3. HUMAN STORIES: Focus on individual survivors' decisions and experiences.
4. VISUALS: Devastated landscapes, rescue operations, emergency shelters, cracked earth, flooding, rubble.`;
        } else if (nicheKey.includes("nature") || nicheKey.includes("wildlife")) {
            nicheRules = `
CRITICAL NATURE RULES:
1. TONE: Sound like David Attenborough — warm, awestruck, deeply respectful of nature.
2. FACTS: Include specific species names, behaviors, and fascinating biological adaptations.
3. VISUALS: Stunning wildlife footage, underwater scenes, aerial landscapes, close-up animal faces, jungles.`;
        } else if (nicheKey.includes("food")) {
            nicheRules = `
CRITICAL FOOD SCIENCE RULES:
1. TONE: Investigative journalist meets food scientist — curious, slightly outraged at industry practices.
2. CHEMISTRY: Explain the actual chemical or biological mechanisms behind food topics.
3. VISUALS: Close-up food shots, factory production lines, molecular diagrams, grocery store aisles.`;
        } else if (nicheKey.includes("relationship") || nicheKey.includes("social")) {
            nicheRules = `
CRITICAL RELATIONSHIP RULES:
1. TONE: Sound like a wise, experienced therapist — empathetic but direct.
2. PSYCHOLOGY: Back every point with psychological research or attachment theory.
3. EXAMPLES: Use relatable scenarios the viewer has likely experienced.
4. VISUALS: People in conversation, couples, city streets, coffee shops, silhouettes, rain on windows.`;
        } else {
            nicheRules = `
CRITICAL EDUCATIONAL RULES:
1. AUTHORITY: Sound like a top-tier documentary narrator (e.g., Huberman Lab style).
2. SCIENCE/FACTS: Provide deep, factual, fascinating insights with specific numbers and protocols.
3. VISUALS: Keep visuals highly relevant, cinematic, and perfectly tied to the concept being explained.`;
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
6. CONTEXT-AWARE EDITING: For every segment, you MUST act as the video editor. Choose a "transition" ("none", "fade_in", or "glitch") and a "camera_motion" ("static" or "zoom_in"). Use "glitch" for shocking/scary moments, "fade_in" for tone shifts, and "zoom_in" for intense focus. Keep most transitions as "none" to avoid overwhelming the viewer.
7. ABSOLUTE SAFETY & COMPLIANCE: Gemini TTS has a hyper-sensitive safety filter. Even for True Crime or Horror, you MUST NOT use banned words like "kill", "murder", "rape", "drug", "suicide", "blood", or "gore". Use safe alternatives like "eliminated", "dark fate", "perished", "tragic end", "substance", or "mystery". If you use banned words, the generation will instantly fail.

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
      "transition": "glitch",
      "camera_motion": "zoom_in",
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

        if (!chatCompletion || !chatCompletion.choices || chatCompletion.choices.length === 0) {
            throw new Error("AI Scriptwriter failed to return a response. This may be due to a rate limit or content filter.");
        }

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
            
            // Ultimate fallback to guarantee the pipeline never crashes
            if (query !== "abstract background") {
                addLog(`No video found for "${query}", using generic fallback...`);
                return fetchStockVideo("abstract background");
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
            clips[i] = { 
                visual: visualPath, 
                audio: audioPath, 
                text: segment.narration, 
                duration: audioDuration,
                transition: segment.transition || "none",
                camera_motion: segment.camera_motion || "static"
            };
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
Style: Default,Arial,90,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,10,10,120,1

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
            // Group into 3-word chunks for fast-paced kinetic Hormozi style
            for (let i = 0; i < words.length; i += 3) {
                const chunkWords = words.slice(i, i + 3);
                const chunkDuration = timePerWord * chunkWords.length;
                const chunkEnd = currentStart + chunkDuration;
                
                // For each word in the chunk, display the whole chunk but highlight the active word
                for (let w = 0; w < chunkWords.length; w++) {
                    const wordStart = currentStart + (w * timePerWord);
                    const wordEnd = wordStart + timePerWord;
                    
                    let highlightedText = "";
                    for (let j = 0; j < chunkWords.length; j++) {
                        if (j === w) {
                            highlightedText += `{\\c&H0000FFFF&}${chunkWords[j]} `; // Highlight Yellow
                        } else {
                            highlightedText += `{\\c&H00FFFFFF&}${chunkWords[j]} `; // Default White
                        }
                    }
                    
                    ass += `Dialogue: 0,${formatASSTime(wordStart)},${formatASSTime(wordEnd)},Default,,0,0,0,,${highlightedText.trim()}\n`;
                }
                
                currentStart = chunkEnd;
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

                // Build Dynamic Filter Chain for Context-Aware Editing
                let vfFilters = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setpts=N/FRAME_RATE/TB`;
                
                // Ken Burns Zoom In (Only applied to AI Images to prevent stock video distortion)
                if (visualSource !== 'stock_videos' && clip.camera_motion === "zoom_in") {
                    vfFilters += `,zoompan=z='min(zoom+0.0015,1.5)':d=${Math.ceil(clip.duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
                }
                
                // Smart Transitions
                if (clip.transition === "fade_in") {
                    vfFilters += `,fade=t=in:st=0:d=0.5`;
                } else if (clip.transition === "glitch") {
                    // Intense inverted flash for 0.1 seconds
                    vfFilters += `,negate=enable='between(t,0,0.1)'`;
                }
                
                // Add Kinetic Subtitles
                vfFilters += `,ass='${escapedAssPath}'`;

                chunk.push(new Promise((resolve, reject) => {
                    let cmd = ffmpeg();
                    if (visualSource === 'stock_videos') {
                        // FIX: Force-limit stock video to exact audio duration to prevent freeze/desync
                        cmd = cmd.input(clip.visual).inputOptions(['-stream_loop', '-1', '-t', String(clip.duration)]);
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
                            `-vf ${vfFilters}`,
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

        const stitchedVideoPath = path.join(projectDir, 'stitched.mp4');
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions('-c copy')
                .save(stitchedVideoPath)
                .on('end', resolve)
                .on('error', reject);
        });
        
        // -------------------------
        // Mix Background Music
        // -------------------------
        addLog("Mixing Background Music at 12% Volume...");
        const finalVideoPath = path.join(outputDir, `${videoId}.mp4`);
        
        let bgmFilename = 'bgm.mp3'; // Lofi default for Tech, Finance, Health, Biohacking, Food Science, Money Psychology
        const suspenseNiches = ["Psychology", "Conspiracies", "True Crime", "Horror", "Creepypasta", "Revenge", "Unethical", "Grey Area", "Survival", "Disaster"];
        const cinematicNiches = ["Luxury", "History", "Civilizations", "Space", "Universe", "Military", "Warfare", "Nature", "Wildlife", "Geography", "Architecture", "Stoicism", "Philosophy", "Rise & Fall", "Geopolitics", "Science"];
        if (suspenseNiches.some(n => mainNiche.includes(n))) {
            bgmFilename = 'bgm_suspense.mp3';
        } else if (cinematicNiches.some(n => mainNiche.includes(n))) {
            bgmFilename = 'bgm_cinematic.mp3';
        }
        const bgmPath = path.join(__dirname, 'assets', bgmFilename);
        
        if (fs.existsSync(bgmPath)) {
            await new Promise((resolve, reject) => {
                ffmpeg(stitchedVideoPath)
                    .input(bgmPath)
                    .inputOptions(['-stream_loop', '-1']) // Loop BGM infinitely
                    .complexFilter([
                        '[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.12[a]'
                    ])
                    .outputOptions([
                        '-map 0:v:0', // Keep original video stream
                        '-map [a]',   // Use mixed audio stream
                        '-c:v copy',  // Instant video copy
                        '-c:a aac',
                        '-b:a 192k'
                    ])
                    .save(finalVideoPath)
                    .on('end', resolve)
                    .on('error', reject);
            });
        } else {
            // Fallback if BGM doesn't exist
            fs.copyFileSync(stitchedVideoPath, finalVideoPath);
        }

        // -------------------------
        // Generate YouTube Thumbnail
        // -------------------------
        addLog("Generating Viral YouTube Thumbnail...");
        const thumbUrlPath = `/output/${videoId}_thumb.jpg`;
        const thumbLocalPath = path.join(outputDir, `${videoId}_thumb.jpg`);
        try {
            const thumbPrompt = `A high contrast, ultra-vibrant YouTube thumbnail background representing ${subNiche}, cinematic lighting, wide angle, incredibly eye-catching, empty space in center for text`;
            const thumbUrl = await withRetry(async () => {
                return await replicate.run(
                    "black-forest-labs/flux-schnell",
                    {
                        input: {
                            prompt: thumbPrompt,
                            go_fast: true,
                            megapixels: "1",
                            num_outputs: 1,
                            output_format: "jpg",
                            output_quality: 90,
                            aspect_ratio: "16:9"
                        }
                    }
                );
            }, "Thumbnail Gen");
            
            const thumbBuffer = await withRetry(() => axios.get(thumbUrl[0], { responseType: 'arraybuffer' }), "Download Thumbnail");
            const rawThumbPath = path.join(projectDir, "raw_thumb.jpg");
            fs.writeFileSync(rawThumbPath, thumbBuffer.data);
            
            const titleWords = scriptData.title.split(' ').slice(0, 3).join(' ').toUpperCase().replace(/'/g, ""); 
            await new Promise((resolve, reject) => {
                ffmpeg(rawThumbPath)
                    .outputOptions([
                        `-vf drawtext=text='${titleWords}':fontcolor=yellow:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2:borderw=8:bordercolor=black`
                    ])
                    .save(thumbLocalPath)
                    .on('end', resolve)
                    .on('error', reject);
            });
            addLog("Thumbnail Generated Successfully!");
        } catch (e) {
            console.warn("Thumbnail generation failed:", e.message);
        }

        const finalUrl = `/output/${videoId}.mp4`;
        
        // Save metadata for the Library
        const metadata = {
            id: videoId,
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: finalUrl,
            thumbnailUrl: fs.existsSync(thumbLocalPath) ? thumbUrlPath : null,
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
        // DISK CLEANUP: Remove all temp files for this generation (success or failure)
        const jobId = global.currentJob?.id;
        global.currentJob = null;
        if (jobId) {
            const cleanupDir = path.join(tmpDir, jobId);
            if (fs.existsSync(cleanupDir)) {
                try {
                    fs.rmSync(cleanupDir, { recursive: true, force: true });
                    console.log(`[CLEANUP] Removed temp directory: ${cleanupDir}`);
                } catch (cleanupErr) {
                    console.warn(`[CLEANUP] Failed to remove ${cleanupDir}:`, cleanupErr.message);
                }
            }
        }
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
