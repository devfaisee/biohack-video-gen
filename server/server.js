const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
// OpenAI SDK removed
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const db = require('./db');
const cronModule = require('./cron');

// Unconditionally use static ffprobe to guarantee audio duration checks work safely everywhere
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Robust System FFmpeg Detection - Nix paths + glob + ffmpeg-static fallback
const { execSync } = require('child_process');
function findSystemFfmpeg() {
    const knownPaths = [
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        '/nix/var/nix/profiles/default/bin/ffmpeg',
        '/root/.nix-profile/bin/ffmpeg',
        '/run/current-system/sw/bin/ffmpeg',
        'C:\\ffmpeg\\bin\\ffmpeg.exe'
    ];
    for (const p of knownPaths) {
        if (fs.existsSync(p)) {
            console.log(`[INFO] Found ffmpeg at known path: ${p}`);
            return p;
        }
    }
    // Try resolving from shell PATH (inject Nix profile dirs to be sure)
    try {
        const nixPath = '/nix/var/nix/profiles/default/bin:/root/.nix-profile/bin:/usr/local/bin:/usr/bin:/bin';
        const sysPath = execSync('which ffmpeg || command -v ffmpeg', {
            shell: '/bin/sh',
            env: { ...process.env, PATH: `${nixPath}:${process.env.PATH || ''}` }
        }).toString().trim();
        if (sysPath && fs.existsSync(sysPath)) {
            console.log(`[INFO] Found ffmpeg via which: ${sysPath}`);
            return sysPath;
        }
    } catch (_) {}
    // Search Nix store for any ffmpeg binary (glob-style find)
    try {
        const found = execSync('find /nix/store -maxdepth 4 -name ffmpeg -type f 2>/dev/null | grep -v ".drv" | head -1', {
            shell: '/bin/sh'
        }).toString().trim();
        if (found && fs.existsSync(found)) {
            console.log(`[INFO] Found ffmpeg in Nix store: ${found}`);
            return found;
        }
    } catch (_) {}
    // Last resort: ffmpeg-static npm package (no drawtext support — fallback only)
    try {
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
            console.warn('[WARN] Using ffmpeg-static fallback — drawtext filter may not be available');
            return ffmpegStatic;
        }
    } catch (_) {}
    return null;
}
const detectedFfmpeg = findSystemFfmpeg();
if (detectedFfmpeg) {
    ffmpeg.setFfmpegPath(detectedFfmpeg);
    console.log(`[INFO] Active FFmpeg binary: ${detectedFfmpeg}`);
} else {
    console.error('[FATAL] No FFmpeg binary found on this system!');
}
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

// Unconditional Runtime Font Installation Failsafe — ensures fonts exist in all Linux font search paths on boot
try {
    const fontsSource = path.join(__dirname, 'assets', 'fonts');
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const fontDirs = [
        path.join(homeDir, '.local', 'share', 'fonts'),
        path.join(homeDir, '.fonts'),
        '/tmp/fonts'
    ];
    if (fs.existsSync(fontsSource)) {
        const fontFiles = fs.readdirSync(fontsSource).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));
        for (const dir of fontDirs) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                for (const font of fontFiles) {
                    const destPath = path.join(dir, font);
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(path.join(fontsSource, font), destPath);
                    }
                }
            } catch (_) {}
        }
        console.log(`[FONTS] Unconditional font sync completed to: ${fontDirs.join(', ')}`);
        try { execSync('fc-cache -fv', { stdio: 'ignore' }); } catch(_) {}
    }
} catch (fontErr) {
    console.warn('[FONTS] Runtime font installation warning:', fontErr.message);
}

// OpenRouter/OpenAI removed. All text generation now runs on Replicate via gpt-5.6-luna.
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

// Robust Retry Logic with Exponential Backoff & 429 Rate-Limit Awareness
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Global Replicate Concurrency & Rate Limit Serializer
let replicateQueue = Promise.resolve();
let replicateCooldownUntil = 0;

async function safeReplicateRun(modelIdentifier, inputOptions, label = "Replicate Task") {
    return new Promise((resolve, reject) => {
        replicateQueue = replicateQueue.then(async () => {
            const now = Date.now();
            if (now < replicateCooldownUntil) {
                const waitMs = replicateCooldownUntil - now;
                addLog(`[RATE-LIMIT PROTECTOR] Cooling down Replicate API for ${Math.ceil(waitMs/1000)}s to reset quota...`);
                await sleep(waitMs);
            }

            try {
                const res = await withRetry(async () => {
                    return await replicate.run(modelIdentifier, inputOptions);
                }, label, 20, 5000);
                
                // Add 2.5s minimum gap between Replicate calls
                replicateCooldownUntil = Date.now() + 2500;
                resolve(res);
            } catch (err) {
                const errStr = String(err.message || err.detail || err || '');
                const match = errStr.match(/retry_after["\s:=]*(\d+)/i);
                if (match && match[1]) {
                    const sec = parseInt(match[1], 10);
                    if (!isNaN(sec) && sec > 0) {
                        replicateCooldownUntil = Date.now() + ((sec + 5) * 1000);
                        addLog(`[RATE-LIMIT PROTECTOR] API rate limit triggered (${sec}s). Global cooldown active until ${new Date(replicateCooldownUntil).toLocaleTimeString()}`);
                    }
                }
                reject(err);
            }
        }).catch(reject);
    });
}

async function withRetry(fn, operationName, maxRetries = 20, baseDelayMs = 4000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) {
                addLog(`[FATAL] ${operationName} failed after ${maxRetries} attempts.`);
                throw err;
            }
            let currentDelay = Math.round(baseDelayMs * Math.pow(1.3, i));
            const errStr = String(err.message || err.detail || err || '');
            
            const isRateLimitErr = err.status === 429 || 
                                  (err.response && err.response.status === 429) ||
                                  errStr.includes("429") || 
                                  errStr.toLowerCase().includes("throttled") || 
                                  errStr.toLowerCase().includes("rate limit") ||
                                  errStr.toLowerCase().includes("retry_after");
            
            if (isRateLimitErr) {
                const match = errStr.match(/retry_after["\s:=]*(\d+)/i);
                let retryAfterSec = 10;
                if (match && match[1]) {
                    const parsed = parseInt(match[1], 10);
                    if (!isNaN(parsed) && parsed > 0) retryAfterSec = parsed;
                }
                currentDelay = Math.max(currentDelay, (retryAfterSec + 5) * 1000); // 5s safety buffer
                addLog(`[RATE-LIMIT] ${operationName} hit Replicate quota limit. Waiting ${Math.round(currentDelay/1000)}s for API window to reset... (Attempt ${i+1}/${maxRetries})`);
            } else {
                addLog(`[WARN] ${operationName} failed: ${err.message}. Retrying in ${Math.round(currentDelay/1000)}s... (Attempt ${i+1}/${maxRetries})`);
            }
            
            await sleep(currentDelay);
        }
    }
}

global.jobQueue = [];
global.currentJob = null;

async function processQueue() {
    if (global.currentJob || global.jobQueue.length === 0) return;
    
    const jobData = global.jobQueue.shift();
    const { durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche, subNiche, format, jobId } = jobData;
    
    addLog(`[QUEUE] Starting generation job ${jobId}. Remaining in queue: ${global.jobQueue.length}`);
    
    try {
        await generateVideoJob({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche, subNiche, format, jobId });
    } catch (err) {
        addLog(JSON.stringify({ event: "error", message: err.message, id: jobId }));
    }
    
    // Once finished (success or failure), process the next job
    setTimeout(processQueue, 1000);
}

// Health probe endpoint — used by Electron desktop to detect server readiness
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/generate', (req, res) => {
    const { durationMinutes = 1, topic, customTitle, customDescription, visualSource = 'stock_videos', mainNiche, subNiche, format = 'horizontal' } = req.body;
    if (!mainNiche || !subNiche) return res.status(400).json({ error: 'mainNiche and subNiche are required' });
    if (durationMinutes < 0.5 || durationMinutes > 30) return res.status(400).json({ error: 'Duration must be between 0.5 and 30 minutes' });
    if (!['horizontal', 'vertical'].includes(format)) return res.status(400).json({ error: 'Format must be horizontal or vertical' });
    if (!['stock_videos', 'ai_images'].includes(visualSource)) return res.status(400).json({ error: 'visualSource must be stock_videos or ai_images' });
    const jobId = crypto.randomUUID();
    
    global.jobQueue.push({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche, subNiche, format, jobId });
    
    addLog(`Job ${jobId} added to queue. Position: ${global.jobQueue.length}`);
    
    // Trigger queue processing asynchronously
    processQueue().catch(err => console.error("Queue processor error:", err));
    
    res.json({ message: "Job added to queue", jobId, position: global.jobQueue.length });
});

app.post('/api/idea', async (req, res) => {
    try {
        const { topic, mainNiche = "Science", subNiche = "General" } = req.body;
        const randomSeed = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
        const safeMainNicheIdea = mainNiche.replace(/[⭐]/g, '').replace(/&/g, 'and').trim();
        const safeSubNicheIdea = subNiche.replace(/&/g, 'and').trim();
        const prompt = `You are an elite YouTube strategist in the "${safeMainNicheIdea}" niche, specifically focusing on "${safeSubNicheIdea}". 
User Input Topic: "${topic || 'None provided'}".

CRITICAL DIVERSITY MANDATE [Random Seed: ${randomSeed}]:
1. If the user provided a topic, generate a viral angle directly for that topic.
2. If NO topic was provided, you MUST pick ONE hyper-specific, real-world historical event, case study, obscure psychological phenomenon, corporate scandal, or specific entity under "${subNiche}".
3. DO NOT output generic advice or overused topics. Pick something unexpected, shocking, and factual.

Generate a highly clickable, psychologically compelling YouTube title. Use MrBeast or Ali Abdaal curiosity gaps.
Generate 'thumbnailText' (1-3 words max, curiosity gap).
Generate an engaging, long, SEO-optimized YouTube description with emojis, chapters, and hashtags.

Output ONLY pure JSON:
{
  "title": "A highly specific viral YouTube title",
  "thumbnailText": "They Know...",
  "description": "A very engaging, long SEO description with emojis and hashtags"
}`;
        const scriptModels = [
            "openai/gpt-5.6-luna"
        ];
        let chatCompletionText = "";
        for (const modelId of scriptModels) {
            try {
                const responseStream = await replicate.run(modelId, {
                    input: {
                        system_prompt: prompt,
                        prompt: "Output ONLY the raw JSON object. Begin your response with { and end with }. No markdown, no explanation.",
                        max_completion_tokens: 2000,
                        reasoning_effort: "low"
                    }
                });
                chatCompletionText = responseStream.join("");
                if (chatCompletionText.length > 0) break;
            } catch (err) {
                console.error(`Idea Gen (${modelId}) failed:`, err.message);
            }
        }

        if (!chatCompletionText) {
            throw new Error('AI Idea Generator failed to connect to Replicate LLM');
        }

        // Robust JSON extraction
        const fenceMatch = chatCompletionText.match(/```(?:json)?\s*([\s\S]*?)```/i);
        let jsonStr = fenceMatch ? fenceMatch[1].trim() : chatCompletionText;
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
        res.json(JSON.parse(jsonStr));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function generateVideoJob({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche = "Science", subNiche = "General", format = 'horizontal', autoSchedule = false, jobId }) {
    try {
        // ── FORMAT-AWARE DURATION MATH ────────────────────────────────────────
        // Shorts (vertical): TTS speaks faster (~155 WPM), max 60s YouTube limit
        // Long-form (horizontal): documentary pace ~130 WPM
        const isVertical = format === 'vertical';
        const wpm = isVertical ? 155 : 130;
        const effectiveDuration = isVertical ? Math.min(durationMinutes, 1) : durationMinutes;
        const wordCount = Math.round(effectiveDuration * wpm);

        // Shorts: fewer segments so each has enough words to be spoken clearly (never under 3s)
        // Long-form: 2 segments/min keeps each segment at 60-90 words
        const targetSegments = isVertical
            ? Math.max(Math.min(Math.round(effectiveDuration * 6), 6), 4) // 4-6 segs for Shorts
            : Math.max(Math.round(effectiveDuration * 2), 6);
        const minSegments = isVertical
            ? Math.max(targetSegments - 1, 3)
            : Math.max(Math.round(effectiveDuration * 1.5), 5);
        const wordsPerSegment = Math.round(wordCount / targetSegments);
        // Never let minWordsPerSegment exceed the per-segment budget (was causing LLM confusion)
        const minWordsPerSegment = isVertical
            ? Math.max(10, wordsPerSegment - 5)   // Shorts: ~25 words min
            : Math.max(50, wordsPerSegment - 15);  // Long-form: 50+ words min
        const maxWordsPerSegment = wordsPerSegment + (isVertical ? 10 : 25);
        const randomSeed = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
        
        let specificIdeaInstruction = "";
        if (customTitle) {
            specificIdeaInstruction = `
CRITICAL TOPIC REQUIREMENT:
The user has provided a SPECIFIC title and concept for this video. You MUST base the entire script exactly on this idea:
User Title: "${customTitle}"
User Description: "${customDescription || ''}"
Do NOT generate a random topic. You MUST strictly follow and explore this exact topic, while still generating the final optimized JSON title/description.`;
        } else if (topic && topic.trim() !== "") {
            specificIdeaInstruction = `
CRITICAL TOPIC REQUIREMENT:
The user specified the exact topic/angle: "${topic}".
You MUST base the entire script directly on "${topic}" within the sub-niche "${subNiche}". Do NOT drift into generic topics.`;
        } else {
            specificIdeaInstruction = `
CRITICAL TOPIC REQUIREMENT [Random Seed: ${randomSeed}]:
The user has NOT provided a specific topic, only the sub-niche "${subNiche}". 
You MUST pick ONE hyper-specific, real-world historical event, case study, obscure psychological phenomenon, corporate scandal, or specific entity under "${subNiche}".
FORBIDDEN: Do NOT write generic overviews or surface-level advice. Pick a concrete narrative or case study to ensure massive uniqueness every time.`;
        }

        // --- EXPANDED 24-NICHE PRECISION ENGINE & VISUAL AESTHETIC DIRECTIVES ---
        let nicheRules = "";
        let visualStylePreset = "Cinematic photo, 35mm lens, atmospheric depth, 8k quality";
        let voiceId = "Charon";
        let voicePrompt = "Professional, authoritative documentary narrator. Consistent and perfectly paced.";
        
        const nicheKey = mainNiche.toLowerCase().replace('⭐', '').trim();
        const subNicheKey = subNiche.toLowerCase();
        // Sanitize niche strings — remove special chars that break LLM JSON generation
        const safeMainNiche = mainNiche.replace(/[⭐]/g, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
        const safeSubNiche = subNiche.replace(/&/g, 'and').replace(/\s+/g, ' ').trim();


        if (nicheKey.includes("revenge") || nicheKey.includes("justice")) {
            voiceId = "Algenib";
            voicePrompt = "Grave, serious narrator recounting a dark payback tale. Steady, deliberate pacing.";
            nicheRules = `
CRITICAL STORYTELLING RULES FOR REVENGE/JUSTICE:
1. NARRATIVE ARC: Write an emotionally gripping story with a clear victim, villain, tension build-up, and SATISFYING payback climax.
2. CONSISTENT CHARACTERS: Use the EXACT SAME detailed physical description for recurring characters in EVERY visual prompt.
3. PACING: Start with the outrageous offense, build frustration, then deliver the sweet revenge slowly.`;
        } else if (nicheKey.includes("true crime") || nicheKey.includes("criminal")) {
            voiceId = "Algenib";
            voicePrompt = "Seasoned crime documentary narrator. Grave, measured, and highly authoritative.";
            nicheRules = `
CRITICAL TRUE CRIME RULES:
1. TONE: Sound like a seasoned crime documentary narrator — grave, measured, and authoritative.
2. SUSPENSE: Build tension methodically through story structure.
3. FACTS: Include specific dates, locations, and investigator names to build credibility.
4. SAFETY: Use safe alternatives for violent words: "eliminated", "tragic end", "perished", "vanished".`;
        } else if (nicheKey.includes("horror") || nicheKey.includes("paranormal") || nicheKey.includes("creepypasta")) {
            voiceId = "Enceladus";
            voicePrompt = "Ominous, dread-inducing narrator. Calm but incredibly unsettling.";
            nicheRules = `
CRITICAL HORROR RULES:
1. ATMOSPHERE: Build dread slowly. Start normal, then let wrongness creep in gradually.
2. VISUALS: Dark, unsettling, liminal space imagery. Empty hallways, fog, distorted shadows, eerie landscapes.
3. NEVER RESOLVE FULLY: Leave a lingering sense of unease. The best horror doesn't fully explain everything.`;
        } else if (nicheKey.includes("dark psychology") || nicheKey.includes("psychology") || nicheKey.includes("manipulation")) {
            voiceId = "Charon";
            voicePrompt = "Knowledgeable insider revealing hidden mental truths. Confident, slightly conspiratorial, but professional.";
            nicheRules = `
CRITICAL DARK PSYCHOLOGY RULES:
1. TONE: Sound like a knowledgeable insider revealing hidden human behavior truths.
2. EXAMPLES: Every concept MUST include a vivid real-world scenario the viewer can relate to.
3. STRUCTURE: Present each tactic/concept as a numbered "law" or "technique" for maximum retention.`;
        } else if (nicheKey.includes("stoicism") || nicheKey.includes("philosophy")) {
            voiceId = "Schedar";
            voicePrompt = "Wise, contemplative, and profound. Slow, deliberate, and deeply calming delivery.";
            nicheRules = `
CRITICAL PHILOSOPHY RULES:
1. TONE: Sound wise, contemplative, and profound — like Marcus Aurelius speaking to a student.
2. QUOTES: Weave in actual philosophical quotes from original texts, then explain them in modern language.
3. APPLICATION: Every philosophical concept MUST be connected to a modern-day practical application.`;
        } else if (nicheKey.includes("military") || nicheKey.includes("warfare")) {
            voiceId = "Orus";
            voicePrompt = "Military analyst briefing. Authoritative, tactical, precise, no-nonsense.";
            nicheRules = `
CRITICAL MILITARY RULES:
1. TONE: Sound like a military analyst briefing — authoritative, tactical, precise.
2. TECHNICAL DETAIL: Include specific equipment specs, troop numbers, tactical formations when relevant.
3. DRAMA: Highlight the human element — soldiers' decisions under pressure, turning points in battles.`;
        } else if (nicheKey.includes("unethical") || nicheKey.includes("grey area") || nicheKey.includes("legal loophole")) {
            voiceId = "Sadaltager";
            voicePrompt = "Investigative journalist exposing hidden corporate systems. Knowledgeable and fast-paced.";
            nicheRules = `
CRITICAL GREY AREA RULES:
1. TONE: Sound like an investigative journalist exposing hidden systems.
2. FRAMING: Always frame as EDUCATIONAL — "Here's how this works so you can PROTECT YOURSELF."
3. EVIDENCE: Cite specific companies, laws, or case studies to build credibility.`;
        } else if (nicheKey.includes("space") || nicheKey.includes("universe") || nicheKey.includes("cosmos")) {
            voiceId = "Charon";
            voicePrompt = "Top-tier astronomical documentary narrator. Epic, expansive, and awe-inspiring.";
            nicheRules = `
CRITICAL SPACE RULES:
1. TONE: Sound like a top-tier space documentary narrator.
2. SCALE: Emphasize mind-blowing scale comparisons ("If Earth were a grain of sand...").
3. FACTS: Provide deep, specific, fascinating insights with exact light-year distances and physics concepts.`;
        } else if (nicheKey.includes("ai") || nicheKey.includes("artificial intelligence") || nicheKey.includes("machine learning")) {
            voiceId = "Charon";
            voicePrompt = "Sharp, visionary AI researcher and tech communicator. Fast, precise, and exciting.";
            nicheRules = `
CRITICAL AI & TECH RULES:
1. TONE: Sound like a top-tier AI researcher at a TED Talk — brilliant, fast, thrilling.
2. SIMPLIFY: Break down complex algorithms and breakthroughs into vivid, simple analogies the general public understands.
3. STAKES: Emphasize why this technology matters for the future of humanity.`;
        } else if (nicheKey.includes("crypto") || nicheKey.includes("blockchain") || nicheKey.includes("bitcoin") || nicheKey.includes("web3")) {
            voiceId = "Sadaltager";
            voicePrompt = "Crypto insider. Fast, intense, with an undercurrent of controlled chaos.";
            nicheRules = `
CRITICAL CRYPTO RULES:
1. TONE: Sound like a crypto insider who has seen cycles come and go — experienced, not hyped.
2. FACTS: Include specific blockchain protocols, wallet addresses, historical prices, and on-chain data.
3. BALANCED: Present both the opportunity AND the risk. Never pure hype, never pure doom.`;
        } else if (nicheKey.includes("fitness") || nicheKey.includes("gym") || nicheKey.includes("workout") || nicheKey.includes("bodybuilding")) {
            voiceId = "Puck";
            voicePrompt = "High-energy fitness coach. Motivating, intense, commanding.";
            nicheRules = `
CRITICAL FITNESS RULES:
1. TONE: Sound like an elite fitness coach — direct, no-nonsense, motivating.
2. SCIENCE: Back every claim with exercise physiology, peer-reviewed studies, or elite athlete examples.
3. ACTIONABLE: Give the viewer a specific protocol, rep scheme, or nutrition strategy they can use immediately.`;
        } else if (nicheKey.includes("entrepreneurship") || nicheKey.includes("startup") || nicheKey.includes("business")) {
            voiceId = "Puck";
            voicePrompt = "Battle-hardened entrepreneur. Practical, direct, no fluff, high-value.";
            nicheRules = `
CRITICAL ENTREPRENEURSHIP RULES:
1. TONE: Sound like a founder who has built and failed and built again — authentic, direct, zero fluff.
2. CASE STUDIES: Use specific founders, companies, funding rounds, and pivots as evidence.
3. MENTAL MODELS: Teach the viewer frameworks and mental models they can immediately apply.`;
        } else if (nicheKey.includes("comedy") || nicheKey.includes("entertainment") || nicheKey.includes("funny")) {
            voiceId = "Zubenelgenubi";
            voicePrompt = "Witty, fast-talking entertainment narrator. Sharp observations, perfect comic timing.";
            nicheRules = `
CRITICAL COMEDY/ENTERTAINMENT RULES:
1. TONE: Witty, self-aware, with sharp observational comedy woven into facts.
2. TIMING: Use short punchy sentences followed by a longer reveal — classic comedy rhythm.
3. RELATABILITY: Ground every joke or observation in something the audience has personally experienced.`;
        } else if (nicheKey.includes("gaming") || nicheKey.includes("esports") || nicheKey.includes("video game")) {
            voiceId = "Puck";
            voicePrompt = "Seasoned gaming commentator. Energetic, knowledgeable, conversational.";
            nicheRules = `
CRITICAL GAMING RULES:
1. TONE: Sound like a passionate gaming journalist or documentarian — deep knowledge, high energy.
2. HISTORY: Include specific game release dates, developer studios, speedrun records, and iconic community moments.
3. DRAMA: Focus on the human stories — rivalries, controversies, underdog victories.`;
        } else if (nicheKey.includes("science") || nicheKey.includes("biology") || nicheKey.includes("tech") || nicheKey.includes("technology")) {
            voiceId = "Charon";
            voicePrompt = "Futuristic tech & science visionary. Sharp, precise, and highly engaging.";
            nicheRules = `
CRITICAL SCIENCE & TECH RULES:
1. TONE: High-level tech communicator explaining breakthrough innovations.
2. MECHANICS: Clearly explain HOW the mechanism or technology works in simple, vivid visual analogies.`;
        } else if (nicheKey.includes("history") || nicheKey.includes("civiliz") || nicheKey.includes("geopolit") || nicheKey.includes("ancient")) {
            voiceId = "Rasalgethi";
            voicePrompt = "Epic documentary narrator. Dramatic, grand, painting vast historical canvases.";
            nicheRules = `
CRITICAL HISTORY RULES:
1. TONE: Sound like an epic documentary narrator — dramatic, grand, painting vast historical canvases.
2. STORYTELLING: Frame history as a STORY with characters, motivations, betrayals, and consequences.
3. DETAILS: Include specific dates, names of key figures, and cause-effect chains.`;
        } else if (nicheKey.includes("corporate collapse") || nicheKey.includes("downfall") || nicheKey.includes("rise") || nicheKey.includes("empire")) {
            voiceId = "Charon";
            voicePrompt = "Corporate empire documentary narrator. Analytical, dramatic, and compelling.";
            nicheRules = `
CRITICAL RISE & FALL RULES:
1. STRUCTURE: Follow the classic arc — humble beginnings, meteoric rise, fatal flaw, spectacular collapse.
2. HUMAN ELEMENT: Focus on the specific decisions and executives that caused the rise AND the collapse.`;
        } else if (nicheKey.includes("luxury") || nicheKey.includes("motivation") || nicheKey.includes("success") || nicheKey.includes("mindset")) {
            voiceId = "Puck";
            voicePrompt = "High-level elite mentor. Authoritative, intense, fast-paced, high energy.";
            nicheRules = `
CRITICAL LUXURY & MOTIVATION RULES:
1. TONE: You must design a script that forces high retention. Start with an aggressive, visually striking hook. No "hello guys". 
${analyticsFeedback}
Never promise what you will talk about; just start talking about it. Every segment must deliver high-value information, not filler.
2. VISUALS: Supercars, penthouses, yachts, luxury timepieces, private jets, city skylines at night.
3. ASPIRATION: Every segment must make the viewer feel they are witnessing a secret of the ultra-successful.`;
        } else if (nicheKey.includes("finance") || nicheKey.includes("wealth") || nicheKey.includes("money") || nicheKey.includes("investing")) {
            voiceId = "Charon";
            voicePrompt = "Wall Street insider and wealth strategist. Authoritative, sharp, fast-paced delivery.";
            nicheRules = `
CRITICAL FINANCE RULES:
1. AUTHORITY: Sound like a high-level financial insider. Use authoritative, fast-paced delivery.
2. ACTIONABLE: Provide actual value, mathematical breakdowns, or case studies the viewer can use.
3. PSYCHOLOGY: Tie every financial concept back to a human behavioral insight or cognitive bias.`;
        } else if (nicheKey.includes("survival") || nicheKey.includes("disaster") || nicheKey.includes("prepper")) {
            voiceId = "Algenib";
            voicePrompt = "Grave, serious narrator detailing an intense timeline of disaster events.";
            nicheRules = `
CRITICAL SURVIVAL RULES:
1. TONE: Start calm, then escalate urgency as the disaster or survival situation unfolds.
2. TIMELINE: Present events chronologically with specific timestamps for maximum immersion.
3. STAKES: Make the viewer feel they are witnessing the event unfold in real-time.`;
        } else if (nicheKey.includes("nature") || nicheKey.includes("wildlife") || nicheKey.includes("animal")) {
            voiceId = "Achird";
            voicePrompt = "Warm, awestruck, deeply respectful of nature. Calm, inviting, BBC Earth style.";
            nicheRules = `
CRITICAL NATURE RULES:
1. TONE: Warm, awestruck, deeply respectful of nature like David Attenborough.
2. FACTS: Include specific species names, behaviors, and fascinating biological adaptations.
3. WONDER: Every segment must end on a fact that makes the viewer say they had no idea.`;
        } else if (nicheKey.includes("food") || nicheKey.includes("cooking") || nicheKey.includes("culinary")) {
            voiceId = "Zubenelgenubi";
            voicePrompt = "Investigative food journalist. Curious, engaging, and fascinating.";
            nicheRules = `
CRITICAL FOOD SCIENCE RULES:
1. TONE: Investigative journalist meets food scientist. Curious, slightly outraged at industrial food engineering.
2. REVELATION: Each segment should expose something the viewer never knew about the food they eat daily.`;
        } else if (nicheKey.includes("relationship") || nicheKey.includes("social") || nicheKey.includes("dating")) {
            voiceId = "Sulafat";
            voicePrompt = "Empathetic, articulate interpersonal strategist. Warm, perceptive, and direct.";
            nicheRules = `
CRITICAL RELATIONSHIP RULES:
1. TONE: Sound like a perceptive interpersonal psychologist. Empathetic but direct.
2. PSYCHOLOGY: Back every point with attachment theory, body language cues, or social dynamics research.
3. RELATABILITY: Open each concept with a scenario the viewer has personally experienced.`;
        } else if (nicheKey.includes("unsolved") || nicheKey.includes("conspiracy") || nicheKey.includes("mystery")) {
            voiceId = "Charon";
            voicePrompt = "Enigmatic, measured investigator. Builds suspense with deliberate pauses and a conspiratorial undertone.";
            nicheRules = `
CRITICAL MYSTERY RULES:
1. TONE: Build suspense layer by layer. Use rhetorical questions to keep viewers guessing.
2. EVIDENCE: Present clues, timelines, and competing theories systematically.
3. OPEN LOOPS: Never fully resolve the mystery. Leave the viewer with one unanswered question.`;
        } else if (nicheKey.includes("health") || nicheKey.includes("biohack") || nicheKey.includes("longevity")) {
            voiceId = "Charon";
            voicePrompt = "Science-backed health expert. Clear, authoritative, cutting-edge research communicator.";
            nicheRules = `
CRITICAL HEALTH AND BIOHACKING RULES:
1. TONE: Sound like a cutting-edge health researcher. Evidence-based, no pseudoscience.
2. CITATIONS: Reference specific studies, journals, or researchers for credibility.
3. APPLICATION: Give the viewer an actionable protocol they can implement immediately after watching.`;
        } else if (nicheKey.includes("geography") || nicheKey.includes("architecture") || nicheKey.includes("travel") || nicheKey.includes("cities")) {
            voiceId = "Rasalgethi";
            voicePrompt = "Worldly, cultured travel narrator. Deeply reverent of place and design.";
            nicheRules = `
CRITICAL GEOGRAPHY AND ARCHITECTURE RULES:
1. TONE: Sound like a cultured world traveler. Reverent, awestruck, deeply knowledgeable.
2. DETAILS: Include specific architectural styles, construction dates, cultural significance, and geographic context.
3. IMMERSION: Transport the viewer. Make them feel they are standing in the location through vivid sensory narration.`;
        } else {
            voiceId = "Charon";
            voicePrompt = "Top-tier documentary narrator. Factual, professional, and fascinating.";
            nicheRules = `
CRITICAL DOCUMENTARY RULES:
1. AUTHORITY: Sound like a top-tier documentary narrator. Factual, professional, fascinating.
2. DETAILS: Provide deep, specific insights with actual names, dates, and evidence-backed claims.
3. STORYTELLING: Every fact must be delivered as part of a compelling narrative arc.`;
        }


        // Format-Aware Pacing Engine Injection
        let formatPacingRules = "";
        if (isVertical) {
            formatPacingRules = `
CRITICAL YOUTUBE SHORTS (9:16) PACING RULES:
1. INSTANT 0-SECOND HOOK: Start IMMEDIATELY with the core conflict or question. Zero intro, zero buildup.
2. SHORTS RETENTION LOOP: The final sentence MUST seamlessly loop back into the first sentence so the Short loops endlessly.
3. HIGH DENSITY PACING: Keep sentences short, punchy, and rapid-fire (150-160 WPM pace).`;
        } else {
            formatPacingRules = `
CRITICAL LONG-FORM (16:9) PACING RULES:
1. NARRATIVE CHAPTERS: Build a rich, cinematic story arc divided into logical chapters.
2. DEEP ENGAGEMENT: Maintain a steady 130-140 WPM documentary narration pace with deliberate pauses for drama.`;
        }

        const visualInstruction = visualSource === 'stock_videos'
            ? `"searchQuery": "A 1-3 word highly literal search query for a stock video API (e.g. 'dark alley', 'stock market crash', 'running snow'). Be extremely simple and literal."`
            : `"imagePrompt": "A highly detailed visual prompt for an AI image generator adhering strictly to the 'global_visual_style' you defined above. Describe the exact scene, subject, lighting, and camera composition."`;

        const systemPrompt = `You are an elite YouTube scriptwriter and retention expert specializing in the "${safeMainNiche}" niche, specifically focusing on "${safeSubNiche}". 
Your goal is to write a highly viral, retention-optimized script for a ${format} YouTube video.
${specificIdeaInstruction}
${analyticsFeedback}
${nicheRules}
${formatPacingRules}

CRITICAL DURATION & SEGMENT REQUIREMENT — READ THIS CAREFULLY:
The user requested a ${durationMinutes}-minute video. This is NON-NEGOTIABLE.
- You MUST generate EXACTLY ${targetSegments} segments in the "segments" array.
- Each segment narration MUST be ${minWordsPerSegment}-${maxWordsPerSegment} words long. Count them.
- Total narration word count across ALL segments MUST reach AT LEAST ${wordCount} words.
- The video is ${durationMinutes} minutes. Not 2. Not 3. ${durationMinutes} full minutes of substance.
- If you stop early or write short segments, the generation FAILS and is retried.
- MID-VIDEO CTA: In exactly ONE segment near the middle of the video, seamlessly weave in a very brief, natural call to action (e.g. "If you're finding this valuable, hit subscribe.").

════════════════════════════════════════════════════════
⚠️  ANTI-FILLER MANDATE — THIS IS THE MOST CRITICAL RULE
════════════════════════════════════════════════════════
You are writing the COMPLETE VIDEO CONTENT, not a trailer or teaser.

ABSOLUTELY BANNED PHRASES (these will cause immediate rejection):
- "In this video we will..."
- "Stay tuned to find out..."
- "You won't believe what comes next..."
- "We're about to reveal..."
- "Later in this video..."
- "What you're about to hear will shock you..."
- "We'll uncover / We'll explore / We'll dive into..."
- Any sentence that PROMISES content instead of DELIVERING it.

CONTENT DELIVERY LAW:
Every segment MUST deliver the actual information. If the segment topic is "Tesla's morning routine",
that segment MUST describe the actual routine in specific detail — what time he woke up,
exactly what he did, specific habits with names and details. NOT "Tesla had a remarkable
morning routine that we're about to explore."

SEGMENT STRUCTURE RULE:
Each segment = one complete self-contained piece of the story or topic.
Think of each segment as a fully realized chapter, not a teaser.
The viewer must LEARN or FEEL something specific from each segment.
════════════════════════════════════════════════════════

DYNAMIC CONTENT ARCHITECTURE & VISUALS:
Instead of a rigid structure, you MUST INVENT a unique storytelling framework for this video (e.g. Chronological Timeline, Top 10 Countdown, Investigative Journey, Myth vs Fact, Case Study). Make it dynamic!
You MUST ALSO INVENT a unique, highly specific visual aesthetic for this video (e.g. '1970s vintage polaroid film', 'cyberpunk neon noir', 'medical textbook diagrams'). Let your creativity run wild.

NUMBERED LIST MANDATE:
If the topic specifies a numbered list ("10 habits", "7 secrets"), you MUST cover EVERY item
with equal depth. Item 1 through Item N must all appear with full narration.

SEO & METADATA RULES:
- Title: Psychologically compelling. MrBeast-level curiosity but factually accurate.
- Tags: 25-30 tags mixing short-tail (1 word), medium-tail (2-3 words), long-tail (5+ words), trending (2026).
- Description: Hook paragraph → Timestamps → About → Keywords → hashtags → AI disclosure line.

TTS COMPLIANCE (Gemini TTS safety filter — violations cause generation failure):
- NEVER use: kill, murder, rape, drug, suicide, blood, gore, bomb, terrorist
- USE INSTEAD: eliminated, dark fate, perished, substance, tragic end, explosive device
- Write PURE clean narration. NO stage directions. NO [whispering]. NO [fast]. NO brackets.

EDITING METADATA (per segment):
- "transition": one of "none", "fade_in", "glitch", "blackout"
  Use "glitch" for shocking revelations, "blackout" for dramatic pauses, "fade_in" for tone shifts.
- "camera_motion": "static" or "zoom_in"
  Use "zoom_in" for intense emotional moments.

Output ONLY a raw JSON object. No markdown. No code fences. No explanation. Start with { end with }.

JSON STRUCTURE:
{
  "title": "...",
  "global_visual_style": "Detailed description of the unique visual aesthetic you invented.",
  "narrative_framework": "The specific storytelling structure you chose.",
  "description": "...",
  "tags": [...],
  "hasThumbnailText": true or false,
  "thumbnailText": "2-3 WORD MAX",
  "thumbnailPrompt": "Detailed image generation prompt for background only. NO TEXT in image.",
  "bgmPrompt": "A highly specific Lyria AI music prompt matching the mood of this exact video. E.g. 'Slow-burn orchestral thriller, low cello drones building to brass crescendo, eerie ambience, no vocals.' Be creative and niche-specific.",
  "segments": [
    {
      "narration": "FULL CONTENT HERE. Minimum ${minWordsPerSegment} words of actual information, stories, facts, and specific details. NOT teasers. NOT promises. Real content.",
      "transition": "none",
      "camera_motion": "static",
      ${visualInstruction}
    }
  ]
}

REMEMBER: ${targetSegments} segments. ${minWordsPerSegment}-${maxWordsPerSegment} words each. ${wordCount}+ total words. DELIVER content, never promise it.`;


        addLog(`Generating ${durationMinutes}-min script: ${targetSegments} segments × ~${wordsPerSegment} words = ${wordCount}+ total words...`);

        // CTA variation pool — rotated per generation so repeat viewers hear different closing
        const ctaVariants = [
            "If this opened your eyes, don't let the algorithm forget you exist. Hit subscribe and the notification bell — we go deep every week.",
            "Most people scroll past and never find content like this again. Be the exception — subscribe and turn on notifications.",
            "You made it to the end. That means you're exactly who this channel is built for. Subscribe so you never miss what we uncover next.",
            "The research behind this video took hours. Your subscribe takes one second. It means everything — hit it now.",
            "If one thing from this video changed how you see the world, imagine what the next one will do. Subscribe and find out.",
            "Every week we go somewhere most channels won't. If you want to come along, subscribe and ring that bell.",
            "Channels like this live or die by your support. If this delivered value, subscribe — it costs nothing and means everything.",
            "You've just seen what most people will never know. If you want more of that, the subscribe button is right there — use it."
        ];
        const selectedCTA = ctaVariants[Math.floor(Math.random() * ctaVariants.length)];

        // Script generation with auto-retry on content QA failure (up to 3 full attempts)
        const scriptModels = [
            "openai/gpt-5.6-luna"
        ];

        let scriptData;
        for (let scriptAttempt = 1; scriptAttempt <= 3; scriptAttempt++) {
            let chatCompletionText = "";
            let lastError = null;
            for (const modelId of scriptModels) {
                try {
                    const responseStream = await withRetry(async () => {
                        const result = await replicate.run(modelId, {
                            input: {
                                system_prompt: systemPrompt,
                                prompt: `Output ONLY the raw JSON object. No markdown. No code fences. No explanations. Start immediately with { and end with }. Generate EXACTLY ${targetSegments} segments with ${minWordsPerSegment}-${maxWordsPerSegment} words of REAL CONTENT per narration. WRITE LONG, DETAILED PARAGRAPHS for every single segment. Do not write short sentences. Use this exact CTA for the last segment narration: "${selectedCTA}"`,
                                max_completion_tokens: 15000,
                                reasoning_effort: "medium"
                            }
                        });
                        if (!result || result.length === 0) throw new Error('Empty LLM response');
                        return result;
                    }, `Script Gen attempt ${scriptAttempt} (${modelId})`, 3, 3000);
                    chatCompletionText = responseStream.join("");
                    if (chatCompletionText.length > 0) break;
                } catch (mErr) {
                    lastError = mErr;
                }
            }
            if (!chatCompletionText) throw new Error(`AI Scriptwriter failed: ${lastError?.message || 'Unknown'}`);

            // Aggressive JSON extraction for models that wrap output in text/markdown
            function extractJson(raw) {
                const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
                if (fenceMatch) return fenceMatch[1].trim();
                const firstBrace = raw.indexOf('{');
                const lastBrace = raw.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1);
                return raw.trim();
            }
            function repairJson(str) {
                str = str.replace(/,\s*([\]}])/g, '$1');
                str = str.replace(/\/\/.*$/gm, '');
                return str;
            }

            let jsonStr = repairJson(extractJson(chatCompletionText));
            let parsedScript;
            try {
                parsedScript = JSON.parse(jsonStr);
            } catch (parseErr) {
                addLog(`[WARN] JSON parse failed, attempting aggressive recovery...`);
                const allMatches = [...chatCompletionText.matchAll(/\{[\s\S]*?\}/g)];
                const largest = allMatches.sort((a, b) => b[0].length - a[0].length)[0];
                if (largest) {
                    try { parsedScript = JSON.parse(repairJson(largest[0])); }
                    catch (_) { addLog(`[WARN] Attempt ${scriptAttempt}: JSON parse failed completely. Retrying script gen...`); continue; }
                } else {
                    addLog(`[WARN] Attempt ${scriptAttempt}: No JSON found. Retrying script gen...`); continue;
                }
            }

            if (!parsedScript?.segments || parsedScript.segments.length < minSegments) {
                addLog(`[WARN] Attempt ${scriptAttempt}: Only ${parsedScript?.segments?.length || 0} segments (need ${minSegments}+). Retrying...`);
                continue;
            }
            let totalWords = parsedScript.segments.reduce((sum, s) => sum + (s.narration || '').split(/\s+/).filter(w => w.length > 0).length, 0);
            addLog(`[CONTENT QA] Attempt ${scriptAttempt}: ${parsedScript.segments.length} segments, ${totalWords}/${wordCount} words`);
            if (totalWords < wordCount * 0.55) {
                addLog(`[WARN] Attempt ${scriptAttempt}: Only ${totalWords} words (need ${Math.floor(wordCount * 0.55)}+). Script is too thin. Retrying...`);
                continue;
            }

            // --- SCRIPT EXPANSION PASS (Fixes Duration for Long Videos) ---
            if (totalWords < wordCount * 0.90) {
                addLog(`[EXPANSION] Script passed QA but is under requested duration (${totalWords}/${wordCount} words). Running AI expansion pass...`);
                try {
                    const expansionResult = await withRetry(async () => {
                        const result = await replicate.run(scriptModels[0], {
                            input: {
                                system_prompt: "You are an expert documentary script editor. You MUST output ONLY raw JSON.",
                                prompt: `Here is a JSON video script. It currently has ${totalWords} words, but the user requested a ${durationMinutes}-minute video which requires at least ${wordCount} words.\n\nExpand the 'narration' of every single segment by adding more fascinating details, deep explanations, quotes, and immersive storytelling. DO NOT change the JSON structure or remove any segments. Just make every narration paragraph much longer and richer.\n\nScript:\n${JSON.stringify(parsedScript)}\n\nOutput ONLY the expanded raw JSON. Do not use markdown blocks. Start with { and end with }.`,
                                max_completion_tokens: 15000,
                                reasoning_effort: "low"
                            }
                        });
                        if (!result || result.length === 0) throw new Error('Empty expansion response');
                        return result;
                    }, "Script Expansion", 2, 4000);
                    
                    const expText = expansionResult.join("");
                    const expParsed = JSON.parse(repairJson(extractJson(expText)));
                    if (expParsed?.segments?.length >= parsedScript.segments.length * 0.8) {
                        const newTotal = expParsed.segments.reduce((sum, s) => sum + (s.narration || '').split(/\s+/).filter(w => w.length > 0).length, 0);
                        addLog(`[EXPANSION SUCCESS] Script expanded from ${totalWords} to ${newTotal} words!`);
                        parsedScript = expParsed;
                        totalWords = newTotal;
                    } else {
                        addLog(`[WARN] Expansion broke segment structure. Using original.`);
                    }
                } catch (expErr) {
                    addLog(`[WARN] Script expansion failed (${expErr.message}). Using original script (video will be shorter than requested).`);
                }
            }
            // -------------------------------------------------------------

            // QA passed — accept this script
            scriptData = parsedScript;
            addLog(`Script finalized: ${scriptData.segments.length} segments, ${totalWords} words (est. ${Math.round(totalWords/130)} min).`);
            break;
        }
        if (!scriptData) throw new Error(`Script generation failed after 3 attempts. Content too short or JSON malformed every time.`);

        const videoId = jobId || crypto.randomUUID();
        const projectDir = path.join(tmpDir, videoId);
        fs.mkdirSync(projectDir);

        const clips = [];
        
        // Expose a global abort controller for the current job
        const abortController = new AbortController();
        global.currentJob = { 
            id: videoId, 
            abort: () => {
                abortController.abort();
                if (global.currentJob.ffmpegProcesses) {
                    for (const cmd of global.currentJob.ffmpegProcesses) {
                        try { cmd.kill('SIGKILL'); } catch(e) {}
                    }
                }
            },
            ffmpegProcesses: []
        };

        let lyriaBgmPath = null;
        const bgmPromise = (async () => {
            try {
                addLog("Starting Lyria-3 AI Background Music Generation...");
                const bgmStyle = isVertical
                    ? `An energetic, punchy, high-tension background track for a YouTube Short. Fast-paced, driving rhythm, no vocals. Matches the niche: ${safeMainNiche}.`
                    : `A cinematic, atmospheric, dramatic underscore for a ${safeMainNiche} documentary. Instrumental only, no vocals, builds gradually.`;
                const bgmPrompt = scriptData.bgmPrompt || bgmStyle;
                const lyriaAudioUrl = await safeReplicateRun(
                    "google/lyria-3",
                    {
                        input: {
                            prompt: bgmPrompt
                        }
                    },
                    "Lyria-3 BGM Generation"
                );
                
                let bgmData;
                if (lyriaAudioUrl && typeof lyriaAudioUrl.arrayBuffer === 'function') {
                    const ab = await lyriaAudioUrl.arrayBuffer();
                    bgmData = Buffer.from(ab);
                } else {
                    const bgmBuffer = await withRetry(() => axios.get(String(lyriaAudioUrl), { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `Download Lyria BGM`);
                    bgmData = bgmBuffer.data;
                }
                lyriaBgmPath = path.join(projectDir, `lyria_bgm.mp3`);
                fs.writeFileSync(lyriaBgmPath, bgmData);
                addLog("AI Background Music generated successfully via Lyria-3.");
            } catch (e) {
                addLog(`[WARN] Lyria-3 BGM Generation unavailable or flagged (${e.message}). Using premium curated local track.`);
            }
        })();

        addLog(`Starting parallel generation of ${scriptData.segments.length} segments...`);

        const pexelsKey = process.env.PEXELS_API_KEY || "vGnr3wLcpfgybFLKKXjcPcqMOPc4MM89JJA1j2WpGfrKNh29XTHVualY";
        const pixabayKey = process.env.PIXABAY_API_KEY || "54069102-5cb5de9252e9808a1e0d5f201";

        async function fetchStockClips(queries, maxClips = 5) {
            const isVertical = format === 'vertical';
            const results = [];
            const queryList = Array.isArray(queries) ? queries : [queries];

            for (const query of queryList) {
                if (results.length >= maxClips) break;
                try {
                    const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${isVertical ? 'portrait' : 'landscape'}`, {
                        headers: { Authorization: pexelsKey },
                        timeout: 10000,
                        signal: abortController.signal
                    });
                    if (res.data.videos && res.data.videos.length > 0) {
                        const shuffled = res.data.videos.sort(() => Math.random() - 0.5);
                        for (const video of shuffled.slice(0, maxClips - results.length)) {
                            const hdFile = video.video_files.find(f => f.quality === 'hd' || f.width >= 1280) || video.video_files[0];
                            if (hdFile?.link) results.push(hdFile.link);
                        }
                    }
                } catch (e) { /* try next query */ }
            }

            if (results.length < maxClips) {
                // Pixabay fallback
                for (const query of queryList) {
                    if (results.length >= maxClips) break;
                    try {
                        const res = await axios.get(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${encodeURIComponent(query)}&video_type=film&orientation=${isVertical ? 'vertical' : 'horizontal'}&per_page=10`, {
                            timeout: 10000,
                            signal: abortController.signal
                        });
                        if (res.data.hits && res.data.hits.length > 0) {
                            const shuffled = res.data.hits.sort(() => Math.random() - 0.5);
                            for (const video of shuffled.slice(0, maxClips - results.length)) {
                                const url = video.videos.large?.url || video.videos.medium?.url || video.videos.small?.url;
                                if (url) results.push(url);
                            }
                        }
                    } catch (e) { /* skip */ }
                }
            }

            return results;
        }

        const getAudioDuration = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata.format.duration);
            });
        });

        // 1. Fetch Visuals (Stock Footage searches run in parallel chunks of 5 with no Replicate rate limit)
        const visualPaths = new Array(scriptData.segments.length);
        const fetchVisualTask = async (i) => {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const isVertical = format === 'vertical';
            const segment = scriptData.segments[i];
            const visualPath = path.join(projectDir, `visual_${i}.mp4`);
            const visualPathWebp = path.join(projectDir, `visual_${i}.webp`);

            if (visualSource === 'stock_videos') {
                const primaryQuery = segment.searchQuery || segment.imagePrompt || 'cinematic abstract';
                // Sanitize: strip sentence prefixes and punctuation that confuse stock search APIs
                const cleanQuery = primaryQuery
                    .replace(/^(a |an |the |show |showing |depicting |of |with )/gi, '')
                    .replace(/["'.,!?]/g, '')
                    .split(' ').slice(0, 3).join(' ') // max 3 keywords
                    .trim();
                const fallbackQuery = cleanQuery.split(' ')[0];
                const nicheQuery = (safeSubNiche || safeMainNiche || 'cinematic').split(' ').slice(0, 2).join(' ');
                const queries = [...new Set([cleanQuery, fallbackQuery, nicheQuery, 'cinematic nature'])];
                addLog(`[Segment ${i + 1}] Searching stock clips for: "${cleanQuery}"...`);
                const clipUrls = await withRetry(() => fetchStockClips(queries, 5), `Stock Search ${i+1}`);

                if (clipUrls.length > 0) {
                    // Download all returned clips and probe their durations
                    const rawPaths = [];
                    for (let ci = 0; ci < clipUrls.length; ci++) {
                        const rawPath = path.join(projectDir, `raw_${i}_${ci}.mp4`);
                        try {
                            const buf = await withRetry(() => axios.get(clipUrls[ci], { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `DL Stock Clip ${i+1}-${ci+1}`);
                            fs.writeFileSync(rawPath, buf.data);
                            rawPaths.push(rawPath);
                        } catch { /* skip this clip on download error */ }
                    }

                    if (rawPaths.length === 0) {
                        // All downloads failed — fall to AI image fallback below
                        clipUrls.length = 0;
                    } else {
                        // We'll assemble the final clip during FFmpeg phase (after audio duration is known)
                        // Store raw clip paths for later assembly
                        visualPaths[i] = { type: 'multi_clip', paths: rawPaths };
                        addLog(`[Segment ${i + 1}] ${rawPaths.length} stock clip(s) ready for montage.`);
                    }
                }

                if (clipUrls.length === 0 || !visualPaths[i]) {
                    // Stock video not found — auto-fallback to AI image for this segment
                    addLog(`[Segment ${i + 1}] No stock video found for "${query}" — generating AI image fallback...`);
                    const fallbackPrompt = segment.imagePrompt || segment.searchQuery || `cinematic ${safeSubNiche} scene, dramatic lighting, 4k`;
                    const imgResult = await safeReplicateRun(
                        "black-forest-labs/flux-schnell:c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e",
                        { input: { prompt: fallbackPrompt + ", cinematic, highly detailed, 4k", aspect_ratio: isVertical ? "9:16" : "16:9", output_format: "webp", num_outputs: 1 } },
                        `AI Image Fallback ${i+1}`
                    );
                    const imageOutput = Array.isArray(imgResult) ? imgResult[0] : imgResult;
                    let imgData;
                    if (imageOutput && typeof imageOutput.arrayBuffer === 'function') { const ab = await imageOutput.arrayBuffer(); imgData = Buffer.from(ab); }
                    else { const b = await withRetry(() => axios.get(String(imageOutput), { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `DL AI Fallback ${i+1}`); imgData = b.data; }
                    fs.writeFileSync(visualPathWebp, imgData);
                    visualPaths[i] = visualPathWebp;
                    addLog(`[Segment ${i + 1}] AI image fallback saved.`);
                }
            } else {
                addLog(`[Segment ${i + 1}] Requesting image from Flux-Schnell...`);
                const imgResult = await safeReplicateRun(
                    "black-forest-labs/flux-schnell:c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e",
                    { input: { prompt: (segment.imagePrompt || '') + ", cinematic, highly detailed, 4k resolution", aspect_ratio: isVertical ? "9:16" : "16:9", output_format: "webp", num_outputs: 1 } },
                    `Image Gen ${i+1}`
                );
                const imageOutput = Array.isArray(imgResult) ? imgResult[0] : imgResult;
                let imgData;
                if (imageOutput && typeof imageOutput.arrayBuffer === 'function') { const ab = await imageOutput.arrayBuffer(); imgData = Buffer.from(ab); }
                else { const b = await withRetry(() => axios.get(String(imageOutput), { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `Download Image ${i+1}`); imgData = b.data; }
                fs.writeFileSync(visualPathWebp, imgData);
                visualPaths[i] = visualPathWebp;
                addLog(`[Segment ${i + 1}] Image downloaded.`);
            }
        };

        const VISUAL_CHUNK_SIZE = 5;
        const visualPromise = (async () => {
            for (let i = 0; i < scriptData.segments.length; i += VISUAL_CHUNK_SIZE) {
                const chunk = [];
                for (let j = i; j < i + VISUAL_CHUNK_SIZE && j < scriptData.segments.length; j++) {
                    chunk.push(fetchVisualTask(j));
                }
                await Promise.all(chunk);
            }
        })();

        // Sanitize narration text before TTS — remove all characters that cause Gemini TTS to fail silently
        function sanitizeForTTS(text) {
            return text
                .replace(/\[.*?\]/g, '')          // Remove stage directions [whispering]
                .replace(/[*_#~`]/g, '')           // Remove markdown formatting
                .replace(/\u2014/g, ' - ')         // Em dash → hyphen
                .replace(/\u2013/g, ' - ')         // En dash → hyphen
                .replace(/\u2018|\u2019/g, "'")    // Curly single quotes → straight
                .replace(/\u201C|\u201D/g, '"')    // Curly double quotes → straight
                .replace(/&/g, ' and ')            // Ampersand → and
                .replace(/[<>]/g, '')              // Strip angle brackets
                .replace(/\s+/g, ' ')              // Collapse multiple spaces
                .trim();
        }

        // 2. Fetch Audio (Gemini TTS) sequentially
        const audioPaths = new Array(scriptData.segments.length);
        for (let i = 0; i < scriptData.segments.length; i++) {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const segment = scriptData.segments[i];
            const audioPath = path.join(projectDir, `audio_${i}.wav`);
            const cleanNarration = sanitizeForTTS(segment.narration || '');

            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Requesting voiceover (${voiceId}) from Gemini TTS...`);
            try {
                const audioUrl = await safeReplicateRun(
                    "google/gemini-3.1-flash-tts",
                    { input: { text: cleanNarration, voice: voiceId, prompt: voicePrompt, language_code: "en-US" } },
                    `Audio Gen ${i+1}`
                );
                let audioData;
                if (audioUrl && typeof audioUrl.arrayBuffer === 'function') {
                    const ab = await audioUrl.arrayBuffer();
                    audioData = Buffer.from(ab);
                } else {
                    const resp = await withRetry(() => axios.get(String(audioUrl), { responseType: 'arraybuffer', timeout: 120000, signal: abortController.signal }), `Download Audio ${i+1}`);
                    audioData = resp.data;
                }
                fs.writeFileSync(audioPath, audioData);
                audioPaths[i] = audioPath;
                addLog(`[Segment ${i + 1}] Voiceover downloaded.`);
            } catch (ttsErr) {
                // TTS failed for this segment — generate a short silent audio so pipeline continues
                addLog(`[WARN] Segment ${i + 1} TTS failed (${ttsErr.message}). Using silent placeholder — video will continue.`);
                // Create a 2-second silent WAV (44 bytes header + silence)
                const silentWav = Buffer.alloc(44 + 88200); // 1s at 44100 Hz stereo 16-bit
                silentWav.write('RIFF', 0); silentWav.writeUInt32LE(36 + 88200, 4);
                silentWav.write('WAVE', 8); silentWav.write('fmt ', 12);
                silentWav.writeUInt32LE(16, 16); silentWav.writeUInt16LE(1, 20);
                silentWav.writeUInt16LE(2, 22); silentWav.writeUInt32LE(44100, 24);
                silentWav.writeUInt32LE(176400, 28); silentWav.writeUInt16LE(4, 32);
                silentWav.writeUInt16LE(16, 34); silentWav.write('data', 36);
                silentWav.writeUInt32LE(88200, 40);
                fs.writeFileSync(audioPath, silentWav);
                audioPaths[i] = audioPath;
            }
        }

        // Wait for visual downloads to complete
        await visualPromise;

        // ── MINIMUM SEGMENT DURATION ENFORCEMENT ─────────────────────────────
        // If TTS returned barely anything (malformed segment, very few words) the
        // clip will be under ~2.5s — causing the visible "skip" in Shorts.
        // Pad audio with silence to a guaranteed minimum.
        const MIN_CLIP_SECONDS = isVertical ? 2.5 : 3.0;
        for (let i = 0; i < audioPaths.length; i++) {
            const dur = await getAudioDuration(audioPaths[i]).catch(() => 0);
            if (dur > 0 && dur < MIN_CLIP_SECONDS) {
                const needed = MIN_CLIP_SECONDS - dur;
                const paddedPath = audioPaths[i].replace('.wav', '_padded.wav');
                await new Promise((res, rej) => {
                    ffmpeg()
                        .input(audioPaths[i])
                        .outputOptions([
                            `-af apad=pad_dur=${needed.toFixed(3)}`,
                            '-ar 44100', '-ac 2'
                        ])
                        .save(paddedPath)
                        .on('end', res).on('error', rej);
                });
                audioPaths[i] = paddedPath;
                addLog(`[Segment ${i + 1}] Audio padded from ${dur.toFixed(2)}s to ${MIN_CLIP_SECONDS}s (was too short to render)`);
            }
        }

        // Build clips array
        for (let i = 0; i < scriptData.segments.length; i++) {
            const segment = scriptData.segments[i];
            const audioDuration = await getAudioDuration(audioPaths[i]);
            let resolvedVisual = visualPaths[i];

            // Multi-clip montage assembly: stitch raw stock clips to exactly match audio duration
            if (resolvedVisual && typeof resolvedVisual === 'object' && resolvedVisual.type === 'multi_clip') {
                const { paths: rawPaths } = resolvedVisual;
                const stitchedPath = path.join(projectDir, `stitched_${i}.mp4`);

                // Probe each raw clip's duration
                const clipDurations = await Promise.all(rawPaths.map(p => getAudioDuration(p).catch(() => 0)));

                // Build a clip list that covers audioDuration without padding or excessive looping
                let totalCovered = 0;
                const clipList = [];
                for (let ci = 0; ci < rawPaths.length && totalCovered < audioDuration; ci++) {
                    const needed = audioDuration - totalCovered;
                    const use = Math.min(clipDurations[ci], needed); // trim clip if it overshoots
                    if (use > 0.5) { // skip clips shorter than 0.5s
                        clipList.push({ path: rawPaths[ci], duration: use });
                        totalCovered += use;
                    }
                }

                // If we ran out of clips and still need more, cycle through them with short trims
                // (Much better than looping a single clip for a minute)
                if (totalCovered < audioDuration * 0.95) {
                    let idx = 0;
                    while (totalCovered < audioDuration && idx < rawPaths.length * 3) {
                        const ci = idx % rawPaths.length;
                        const needed = audioDuration - totalCovered;
                        const maxUseFromCycle = Math.min(clipDurations[ci], needed, 8); // max 8s per clip in cycle
                        if (maxUseFromCycle > 0.5) {
                            clipList.push({ path: rawPaths[ci], duration: maxUseFromCycle });
                            totalCovered += maxUseFromCycle;
                        }
                        idx++;
                    }
                }

                if (clipList.length === 1) {
                    // Only one clip — just use it directly (will be stream-looped by FFmpeg if too short)
                    resolvedVisual = clipList[0].path;
                } else {
                    // Stitch multiple clips together with FFmpeg concat
                    const concatListPath = path.join(projectDir, `concat_${i}.txt`);
                    const concatContent = clipList.map(c => `file '${c.path.replace(/\\/g, '/')}'
duration ${c.duration.toFixed(3)}`).join('\n');
                    fs.writeFileSync(concatListPath, concatContent, 'utf8');

                    await new Promise((resolve, reject) => {
                        ffmpeg()
                            .input(concatListPath)
                            .inputOptions(['-f', 'concat', '-safe', '0'])
                            .videoCodec('libx264')
                            .outputOptions(['-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-an'])
                            .save(stitchedPath)
                            .on('end', resolve)
                            .on('error', reject);
                    });
                    resolvedVisual = stitchedPath;
                    addLog(`[Segment ${i + 1}] Montage stitched: ${clipList.length} clips over ${totalCovered.toFixed(1)}s`);
                }
            }

            clips[i] = {
                visual: resolvedVisual,
                audio: audioPaths[i],
                text: segment.narration,
                duration: audioDuration,
                transition: segment.transition || "none",
                camera_motion: segment.camera_motion || "static",
                isMultiClip: typeof resolvedVisual === 'string' && resolvedVisual.includes('stitched')
            };
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        // ─── KARAOKE SUBTITLE ENGINE (word-highlight style) ──────────────────
        // Shows 3 words at a time: [white] [ACCENT] [white]
        // Current word pops in accent color, flanking words fade in white.
        // Works via ASS karaoke format (libass). Falls back to phrase-only drawtext.

        function buildWordTimings(text, durationSec) {
            const clean = text.replace(/\[.*?\]/g, '').replace(/[*_#~`]/g, '').trim();
            const words = clean.split(/\s+/).filter(w => w.length > 0);
            if (!words.length || durationSec <= 0) return [];
            
            // TTS doesn't speak evenly; it pauses on punctuation. Weighting prevents subtitles from racing ahead.
            let totalWeight = 0;
            const wordWeights = words.map(w => {
                let weight = Math.max(w.length, 2);
                if (w.endsWith('.') || w.endsWith('!') || w.endsWith('?')) weight += 8; // Heavy pause
                else if (w.endsWith(',') || w.endsWith(';')) weight += 4; // Short pause
                totalWeight += weight;
                return weight;
            });
            
            const startOffset = 0.15; // Account for typical TTS leading silence
            const activeDur = Math.max(0.1, durationSec - 0.4); // Account for trailing silence
            const secPerWeight = activeDur / totalWeight;
            
            const timings = [];
            let t = startOffset;
            for (let i = 0; i < words.length; i++) {
                const dur = wordWeights[i] * secPerWeight;
                timings.push({ word: words[i], start: t, end: Math.min(t + dur, durationSec) });
                t = timings[timings.length - 1].end;
            }
            return timings;
        }

        // ASS time: seconds → H:MM:SS.cs
        function toAssTime(sec) {
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = (sec % 60).toFixed(2);
            return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(5,'0')}`;
        }

        function hexToAss(hex) {
            const h = hex.replace('#','');
            return `&H00${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}&`;
        }

        // Generate ASS karaoke subtitle file — Full phrase on screen, active word highlights in accent color
        function generateKaraokeAss(text, durationSec, isVertical, accentHex) {
            const timings = buildWordTimings(text, durationSec);
            if (!timings.length) return null;

            const W = isVertical ? 1080 : 1920;
            const H = isVertical ? 1920 : 1080;
            const fontSz = isVertical ? 72 : 62;
            const marginV = isVertical ? 380 : 145;
            const accentAss = hexToAss(accentHex);
            const whiteAss  = '&H00FFFFFF&';

            const header = [
                '[Script Info]',
                'ScriptType: v4.00+',
                `PlayResX: ${W}`,
                `PlayResY: ${H}`,
                'ScaledBorderAndShadow: yes',
                'WrapStyle: 1',
                '',
                '[V4+ Styles]',
                'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
                `Style: Default,Oswald,${fontSz},${whiteAss},&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1,0,1,4,3,2,40,40,${marginV},1`,
                '',
                '[Events]',
                'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
            ].join('\n');

            // Group words into phrases (sentences or max ~6 words)
            const phrases = [];
            let currentPhrase = [];
            for (let i = 0; i < timings.length; i++) {
                currentPhrase.push(timings[i]);
                const w = timings[i].word;
                const isPunctuation = w.endsWith('.') || w.endsWith('!') || w.endsWith('?') || w.endsWith(',');
                if (isPunctuation || currentPhrase.length >= 6 || i === timings.length - 1) {
                    phrases.push(currentPhrase);
                    currentPhrase = [];
                }
            }

            const lines = [];
            for (const phrase of phrases) {
                for (let i = 0; i < phrase.length; i++) {
                    const curr = phrase[i];
                    const st = toAssTime(curr.start);
                    // Active word holds until the next word starts (or phrase ends)
                    const et = toAssTime(i < phrase.length - 1 ? phrase[i+1].start : curr.end);
                    
                    const formattedWords = phrase.map((item, idx) => {
                        let clean = item.word.toUpperCase().replace(/[{}\\|<>]/g, '');
                        if (idx === i) {
                            return `{\\c${accentAss}\\b1\\fs${Math.round(fontSz * 1.15)}\\bord5\\shad4}${clean}{\\r}`; // Pop active word
                        } else {
                            return clean; // Default white
                        }
                    });

                    lines.push(`Dialogue: 0,${st},${et},Default,,0,0,0,,${formattedWords.join(' ')}`);
                }
            }

            return `${header}\n${lines.join('\n')}\n`;
        }

        // Drawtext fallback for phrase-by-phrase (when libass unavailable)
        function drawtextEscape(str) {
            return str
                .replace(/\\/g, '\\\\')
                .replace(/'/g, '')
                .replace(/:/g, '\\:')
                .replace(/%/g, '%%')
                .replace(/[\[\]]/g, '')
                .replace(/[\x00-\x1F]/g, '');
        }

        function buildPhrases(text, durationSec) {
            const clean = text.replace(/\[.*?\]/g, '').replace(/[*_#~`]/g, '').trim();
            const words = clean.split(/\s+/).filter(w => w.length > 0);
            if (!words.length || durationSec <= 0) return [];
            const groups = [];
            let cur = [];
            for (let i = 0; i < words.length; i++) {
                cur.push(words[i]);
                if (cur.length >= 3 || /[.!?]$/.test(words[i]) || i === words.length - 1) {
                    groups.push([...cur]);
                    cur = [];
                }
            }
            if (groups.length > 1 && groups[groups.length-1].length === 1) {
                groups[groups.length-2].push(...groups.pop());
            }
            const totalChars = words.reduce((s, w) => s + Math.max(w.length, 2), 0);
            const secPerChar = durationSec / totalChars;
            const result = [];
            let t = 0;
            for (const g of groups) {
                const chars = g.reduce((s, w) => s + Math.max(w.length, 2), 0);
                const dur = secPerChar * chars;
                const end = Math.min(t + dur, durationSec - 0.05);
                result.push({ words: g, start: t, end });
                t = end;
            }
            return result;
        }

        function generateDrawtextFallback(text, durationSec, isVertical, colorHex) {
            const phrases = buildPhrases(text, durationSec);
            if (!phrases.length) return '';
            const fontFile = path.join(__dirname, 'assets', 'fonts', 'Oswald-Bold.ttf')
                .replace(/\\/g, '/').replace(/:/g, '\\\\:');
            const fontSize = isVertical ? 72 : 60;
            const yPos = isVertical ? '(h*0.78)' : '(h*0.82)';
            const fcolor = `0x${colorHex.replace('#', '')}`;
            return phrases.map(({ words, start, end }) => {
                const txt = drawtextEscape(words.map(w => w.toUpperCase()).join(' '));
                return `drawtext=fontfile='${fontFile}':text='${txt}':fontsize=${fontSize}:fontcolor=${fcolor}:borderw=4:bordercolor=black@0.95:shadowx=3:shadowy=3:shadowcolor=black@0.7:x=(w-text_w)/2:y=${yPos}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
            }).join(',');
        }

        addLog("Assets generated. Stitching clips with KARAOKE WORD-HIGHLIGHT captions...");
        addLog(`[SUBTITLE ENGINE] Karaoke Word-Highlight Engine active`);
        addLog(`[PRODUCTION LOG] Active FFmpeg Binary: ${detectedFfmpeg || 'system ffmpeg'}`);

        // Runtime detection: prefer ASS karaoke (most compatible), fallback to drawtext
        let subtitleMode = 'ass'; // 'ass' | 'drawtext' | 'none'
        try {
            execSync(`${detectedFfmpeg || 'ffmpeg'} -filters 2>/dev/null | grep subtitles`, { shell: '/bin/sh', stdio: 'pipe' });
            subtitleMode = 'ass';
            addLog('[SUBTITLE ENGINE] ASS karaoke mode active (libass detected)');
        } catch (_) {
            try {
                execSync(`${detectedFfmpeg || 'ffmpeg'} -filters 2>/dev/null | grep drawtext`, { shell: '/bin/sh', stdio: 'pipe' });
                subtitleMode = 'drawtext';
                addLog('[SUBTITLE ENGINE] drawtext fallback mode active');
            } catch (__) {
                subtitleMode = 'none';
                addLog('[SUBTITLE ENGINE] [WARN] No subtitle filters available');
            }
        }
        
        // Niche-Aware Subtitle Color Selection (computed once, used for all clips)
        const clipPaths = new Array(clips.length);
        let highlightColorHex = "#FFFF00"; // Bright Yellow (Default)
        const nicheColorKey = (mainNiche || "").toLowerCase();
        if (nicheColorKey.includes("finance") || nicheColorKey.includes("wealth") || nicheColorKey.includes("money")) {
            highlightColorHex = "#00FF66"; // Money Neon Green
        } else if (nicheColorKey.includes("luxury") || nicheColorKey.includes("motivation")) {
            highlightColorHex = "#FFD700"; // Gold
        } else if (nicheColorKey.includes("crime") || nicheColorKey.includes("horror")) {
            highlightColorHex = "#FF1744"; // Blood Red
        } else if (nicheColorKey.includes("revenge") || nicheColorKey.includes("unethical") || nicheColorKey.includes("dark") || nicheColorKey.includes("psychology")) {
            highlightColorHex = "#FF0055"; // Neon Crimson
        } else if (nicheColorKey.includes("health") || nicheColorKey.includes("biohack") || nicheColorKey.includes("food")) {
            highlightColorHex = "#76FF03"; // Bio Lime Green
        } else if (nicheColorKey.includes("space") || nicheColorKey.includes("science") || nicheColorKey.includes("tech")) {
            highlightColorHex = "#00E5FF"; // Bright Cyan
        } else if (nicheColorKey.includes("history") || nicheColorKey.includes("stoicism") || nicheColorKey.includes("philosophy") || nicheColorKey.includes("military")) {
            highlightColorHex = "#FFC107"; // Warm Amber Gold
        } else if (nicheColorKey.includes("survival") || nicheColorKey.includes("disaster")) {
            highlightColorHex = "#FF9100"; // Safety Orange
        } else if (nicheColorKey.includes("geography") || nicheColorKey.includes("architecture")) {
            highlightColorHex = "#E0F7FA"; // Ice Cyan White
        } else if (nicheColorKey.includes("relationship") || nicheColorKey.includes("social")) {
            highlightColorHex = "#FF80AB"; // Rose Pink
        } else if (nicheColorKey.includes("mystery") || nicheColorKey.includes("unsolved") || nicheColorKey.includes("conspiracy")) {
            highlightColorHex = "#B388FF"; // Mystic Purple
        } else if (nicheColorKey.includes("rise") || nicheColorKey.includes("fall") || nicheColorKey.includes("company") || nicheColorKey.includes("empire")) {
            highlightColorHex = "#FF6D00"; // Corporate Amber
        } else if (nicheColorKey.includes("nature") || nicheColorKey.includes("wildlife")) {
            highlightColorHex = "#69F0AE"; // Nature Emerald
        }

        // Run FFmpeg processes sequentially to prevent CPU starvation
        const FFMPEG_CHUNK_SIZE = 1; 
        for (let i = 0; i < clips.length; i += FFMPEG_CHUNK_SIZE) {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            
            const chunk = [];
            for (let j = i; j < i + FFMPEG_CHUNK_SIZE && j < clips.length; j++) {
                const clip = clips[j];
                const clipPath = path.join(projectDir, `clip_${j}.mp4`);
                clipPaths[j] = clipPath;

                
                // Build Dynamic Filter Chain for Context-Aware Editing & Monetization Safety

                const isVertical = format === 'vertical';
                const [outW, outH] = isVertical ? [1080, 1920] : [1920, 1080];
                let vfFilters = `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setpts=N/FRAME_RATE/TB`;
                if (visualSource === 'stock_videos') {
                    // Enhanced visual transformation for stock footage (anti-reuse fingerprinting)
                    const hueShift = Math.floor(Math.random() * 16) - 8;
                    vfFilters += `,eq=contrast=1.15:brightness=0.03:saturation=1.3,vignette=PI/3.5`;
                    if (hueShift !== 0) vfFilters += `,hue=h=${hueShift}`;
                    vfFilters += `,unsharp=5:5:0.8:3:3:0.4`;
                } else {
                    // KEN BURNS EFFECT — only apply for clips >= 3s to prevent FFmpeg frame glitches on short clips
                    if (clip.duration >= 3.0) {
                        const kenMode = j % 4;
                        const fps = 30;
                        const dFrames = Math.max(1, Math.round(clip.duration * fps));
                        let zExpr, xExpr, yExpr;
                        if (kenMode === 0) {
                            zExpr = `min(1+${(0.0004).toFixed(5)}*n,1.25)`;
                            xExpr = `iw/2-(iw/zoom/2)`;  yExpr = `ih/2-(ih/zoom/2)`;
                        } else if (kenMode === 1) {
                            zExpr = `max(1.25-${(0.0004).toFixed(5)}*n,1.0)`;
                            xExpr = `iw/2-(iw/zoom/2)`;  yExpr = `ih/2-(ih/zoom/2)`;
                        } else if (kenMode === 2) {
                            zExpr = `1.12`;
                            xExpr = `(iw-iw/zoom)/2*(n/${dFrames})`; yExpr = `ih/2-(ih/zoom/2)`;
                        } else {
                            zExpr = `1.12`;
                            xExpr = `iw/2-(iw/zoom/2)`; yExpr = `(ih-ih/zoom)/2*(n/${dFrames})`;
                        }
                        vfFilters += `,zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${dFrames}:s=${outW}x${outH}:fps=${fps}`;
                        vfFilters += `,eq=contrast=1.12:brightness=0.02:saturation=1.25`;
                    } else {
                        // Short clip: simple color grade, no motion (zoompan on <3s causes frame glitches)
                        vfFilters += `,eq=contrast=1.12:brightness=0.02:saturation=1.25`;
                    }
                }

                // Smart Transitions & Pattern Interrupts
                if (clip.transition === "fade_in") {
                    vfFilters += `,fade=t=in:st=0:d=0.5`;
                } else if (clip.transition === "glitch") {
                    vfFilters += `,negate=enable='between(t,0,0.1)'`;
                } else if (clip.transition === "blackout") {
                    vfFilters += `,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0,1)'`;
                }

                // Apply subtitles using best detected method
                if (subtitleMode === 'ass') {
                    const assPath = path.join(projectDir, `sub_${j}.ass`);
                    const assContent = generateKaraokeAss(clip.text, clip.duration, isVertical, highlightColorHex);
                    if (assContent) {
                        fs.writeFileSync(assPath, assContent, 'utf8');
                        const escaped = assPath.replace(/\\/g, '/');
                        vfFilters += `,subtitles=${escaped}`;
                    }
                } else if (subtitleMode === 'drawtext') {
                    const dtFilter = generateDrawtextFallback(clip.text, clip.duration, isVertical, highlightColorHex);
                    if (dtFilter) vfFilters += `,${dtFilter}`;
                }

                chunk.push(new Promise((resolve, reject) => {
                    let cmd = ffmpeg();
                    if (clip.isMultiClip) {
                        // Pre-stitched montage: already exact duration, no loop needed
                        cmd = cmd.input(clip.visual).inputOptions(['-t', String(clip.duration)]);
                    } else if (clip.visual && clip.visual.endsWith('.mp4')) {
                        // Single stock mp4: stream-loop if it's shorter than audio
                        cmd = cmd.input(clip.visual).inputOptions(['-stream_loop', '-1', '-t', String(clip.duration)]);
                    } else {
                        // Static image (AI-generated webp): use -loop 1
                        cmd = cmd.input(clip.visual).inputOptions(['-loop', '1', '-t', String(clip.duration)]);
                    }
                    cmd.input(clip.audio);

                    cmd.videoCodec('libx264')
                        .audioCodec('aac')
                        .videoFilters(vfFilters)
                        .outputOptions([
                            '-map 0:v:0', // Only take video from input 0
                            '-map 1:a:0', // Take voiceover audio from input 1
                            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', // Per-segment normalization
                            '-shortest',
                            '-r 30', // Force uniform 30fps for all clips (prevents concat desync)
                            '-ar 44100', // Force uniform 44.1kHz audio (prevents concat desync)
                            '-pix_fmt yuv420p',
                            '-preset veryfast', // Drastically speeds up encoding
                            '-threads 2' // Balances CPU load across parallel processes
                        ])
                        .save(clipPath)
                        .on('end', resolve)
                        .on('error', (err, stdout, stderr) => {
                            console.error(`[FFMPEG ERROR on Clip ${j}]`, err.message);
                            console.error(`[FFMPEG STDERR]`, stderr);
                            addLog(`[FATAL] Encoding failed on Clip ${j+1}: ${err.message}. Check Railway logs for exact stderr.`);
                            reject(err);
                        });
                    global.currentJob.ffmpegProcesses.push(cmd);
                }));
            }
            
            const progress = Math.round(((i + Math.min(FFMPEG_CHUNK_SIZE, clips.length - i)) / clips.length) * 100);
            addLog(`Encoding clip ${i + 1} of ${clips.length}... (${progress}% complete)`);
            await Promise.all(chunk);
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        addLog("Concatenating clips into final video...");
        const listPath = path.join(projectDir, 'list.txt');
        // Use forward slashes in concat list for cross-platform compatibility
        const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);

        const stitchedVideoPath = path.join(projectDir, 'stitched.mp4');
        await new Promise((resolve, reject) => {
            const cmd = ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions('-c copy')
                .save(stitchedVideoPath)
                .on('end', resolve)
                .on('error', reject);
            global.currentJob.ffmpegProcesses.push(cmd);
        });
        
        // -------------------------
        // Mix Background Music
        // -------------------------
        // Anti-template: randomize BGM volume between 7%-11% per generation
        const bgmVolume = (0.07 + Math.random() * 0.04).toFixed(2);
        addLog(`Mixing Background Music at ${Math.round(bgmVolume * 100)}% Volume...`);
        
        await bgmPromise; // Ensure Lyria-3 generation is complete

        // Create organized subfolder for this video: [YYYY-MM-DD]_[Clean_Title]_[ShortId]
        const dateStr = new Date().toISOString().split('T')[0];
        const titleSlug = (scriptData.title || "Video").replace(/[^a-zA-Z0-9_\- ]/g, '').trim().substring(0, 45).replace(/\s+/g, '_');
        const folderName = `${dateStr}_${titleSlug}_${videoId.substring(0, 8)}`;
        const videoFolder = path.join(outputDir, folderName);
        if (!fs.existsSync(videoFolder)) fs.mkdirSync(videoFolder, { recursive: true });

        const finalVideoPath = path.join(videoFolder, 'video.mp4');
        const finalVideoTmpPath = path.join(videoFolder, 'video.tmp.mp4');
        const legacyVideoPath = path.join(outputDir, `${videoId}.mp4`); // Legacy flat path compatibility
        
        let finalBgmToMix = null;
        if (lyriaBgmPath && fs.existsSync(lyriaBgmPath)) {
            finalBgmToMix = lyriaBgmPath;
        } else {
            let bgmCategory = 'neutral';
            const n = (mainNiche || "").toLowerCase();
            if (n.includes("luxury") || n.includes("finance") || n.includes("wealth") || n.includes("money") || n.includes("motivation")) {
                bgmCategory = 'luxury';
            } else if (n.includes("horror") || n.includes("creepypasta")) {
                bgmCategory = 'horror';
            } else if (n.includes("psychology") || n.includes("unethical") || n.includes("revenge") || n.includes("crime") || n.includes("mystery")) {
                bgmCategory = 'suspense';
            } else if (n.includes("history") || n.includes("ancient") || n.includes("military") || n.includes("geopolit") || n.includes("rise")) {
                bgmCategory = 'cinematic';
            } else if (n.includes("space") || n.includes("science") || n.includes("tech")) {
                bgmCategory = 'space_sci';
            } else if (n.includes("stoicism") || n.includes("philosophy") || n.includes("relationship")) {
                bgmCategory = 'chill_lofi';
            } else if (n.includes("survival") || n.includes("disaster") || n.includes("wildlife") || n.includes("nature")) {
                bgmCategory = 'survival';
            }
            
            // Flat file fallback: bgm_${category}.mp3 or bgm.mp3
            let bgmPath = path.join(__dirname, 'assets', `bgm_${bgmCategory}.mp3`);
            if (!fs.existsSync(bgmPath)) {
                bgmPath = path.join(__dirname, 'assets', 'bgm.mp3');
            }
            if (fs.existsSync(bgmPath)) finalBgmToMix = bgmPath;
        }
        
        // Get total video duration for audio fade-out timing
        let totalVideoDuration = 0;
        try { totalVideoDuration = await getAudioDuration(stitchedVideoPath); } catch (_) {}
        const fadeOutStart = Math.max(0, totalVideoDuration - 3); // Start audio fade 3s before end

        if (finalBgmToMix) {
            await new Promise((resolve, reject) => {
                const cmd = ffmpeg(stitchedVideoPath)
                    .input(finalBgmToMix)
                    .inputOptions(['-stream_loop', '-1'])
                    .complexFilter([
                        // BGM at set lower volume, fade out last 3 seconds
                        `[1:a]volume=${bgmVolume},afade=t=out:st=${fadeOutStart}:d=3[bgm]`,
                        // Voiceover: apply broadcast normalization (loudnorm) to make it punchy and consistent, fade in first 0.5s, fade out last 1s
                        `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, totalVideoDuration - 1)}:d=1[vo]`,
                        `[vo][bgm]amix=inputs=2:duration=first[a]`
                    ])
                    .outputOptions([
                        '-map 0:v:0',
                        '-map [a]',
                        '-c:v copy',
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags +faststart'
                    ])
                    .save(finalVideoTmpPath)
                    .on('end', () => {
                        fs.renameSync(finalVideoTmpPath, finalVideoPath);
                        try { fs.copyFileSync(finalVideoPath, legacyVideoPath); } catch (_) {}
                        resolve();
                    })
                    .on('error', (err) => {
                        if (fs.existsSync(finalVideoTmpPath)) fs.unlinkSync(finalVideoTmpPath);
                        reject(err);
                    });
                global.currentJob.ffmpegProcesses.push(cmd);
            });
        } else {
            fs.copyFileSync(stitchedVideoPath, finalVideoPath);
            try { fs.copyFileSync(finalVideoPath, legacyVideoPath); } catch (_) {}
        }

        // ─── INTELLIGENT THUMBNAIL SYSTEM ─────────────────────────────────────
        addLog("Generating Viral YouTube Thumbnail...");
        const thumbUrlPath = `/output/${folderName}/thumbnail.jpg`;
        const thumbLocalPath = path.join(videoFolder, `thumbnail.jpg`);
        const legacyThumbPath = path.join(outputDir, `${videoId}_thumb.jpg`);
        try {
            // 1. NICHE-AWARE VISUAL STYLE — each niche gets a unique cinematic language
            const nicheKey = (mainNiche || '').toLowerCase();
            let nicheVisualStyle = '';
            if (nicheKey.includes('finance') || nicheKey.includes('wealth') || nicheKey.includes('money')) {
                nicheVisualStyle = 'Dark mahogany desk with gold coins and luxury watch, dramatic chiaroscuro lighting, deep shadows, glowing amber highlights, ultra-luxurious atmosphere, Wall Street aesthetic';
            } else if (nicheKey.includes('crime') || nicheKey.includes('mystery') || nicheKey.includes('unsolved')) {
                nicheVisualStyle = 'Moody noir atmosphere, single harsh overhead light casting deep shadows, crime scene yellow tape or shadowy silhouette, dark purple and red color palette, cinematic thriller aesthetic';
            } else if (nicheKey.includes('psychology') || nicheKey.includes('dark') || nicheKey.includes('mind')) {
                nicheVisualStyle = 'Fragmented mirror reflection showing multiple faces, dark blue and deep purple, subtle geometric patterns in background, psychological thriller atmosphere, dramatic side lighting';
            } else if (nicheKey.includes('history') || nicheKey.includes('military') || nicheKey.includes('ancient')) {
                nicheVisualStyle = 'Dramatic historical scene with epic volumetric lighting, aged texture, sepia-teal color grade, sense of epic scale and grandeur, documentary cinematography style';
            } else if (nicheKey.includes('science') || nicheKey.includes('space') || nicheKey.includes('tech')) {
                nicheVisualStyle = 'Futuristic neon-lit environment, electric blue and teal glowing circuitry, holographic elements, deep space or high-tech laboratory background, cutting-edge aesthetic';
            } else if (nicheKey.includes('health') || nicheKey.includes('biohack') || nicheKey.includes('food')) {
                nicheVisualStyle = 'Clean bright environment, vibrant lime green and white, healthy body or brain visualization, scientific precision meets wellness aesthetics, energetic and motivating';
            } else if (nicheKey.includes('motivation') || nicheKey.includes('success') || nicheKey.includes('luxury')) {
                nicheVisualStyle = 'Inspiring silhouette on mountain peak or urban skyline, golden hour lighting, epic scale, warm gold and orange color grade, aspirational lifestyle aesthetic';
            } else if (nicheKey.includes('relationship') || nicheKey.includes('social')) {
                nicheVisualStyle = 'Emotionally charged scene with deep human connection or dramatic confrontation, warm pink and deep red tones, shallow depth of field, cinematic portrait style';
            } else if (nicheKey.includes('survival') || nicheKey.includes('disaster')) {
                nicheVisualStyle = 'Dramatic natural environment, stormy sky, intense orange emergency lighting, survival gear, apocalyptic cinematic scale, high tension atmosphere';
            } else {
                nicheVisualStyle = 'Dramatic central focal point with volumetric lighting, deep shadows, cinematic teal-orange color grade, extreme depth of field';
            }

            // 2. ALWAYS overlay text — but rewrite the thumbnail prompt to pre-compose space for it
            const thumbTextRaw = (scriptData.thumbnailText || scriptData.title?.split(' ').slice(0, 3).join(' ') || 'SHOCKING').trim();

            // 3. THUMBNAIL PROMPT — YouTube-proven compositional spec
            // Left 55%: dramatic subject. Right 45%: clean gradient zone for text.
            const videoTitle = (scriptData.title || '').replace(/"/g, "'");
            const aesthetic = scriptData.global_visual_style || nicheVisualStyle;

            let thumbPrompt = '';
            if (scriptData.thumbnailPrompt && scriptData.thumbnailPrompt.length > 60) {
                thumbPrompt = scriptData.thumbnailPrompt
                    .replace(/with.*?text.*?reading.*?['"][^'"]+['"][,.]?/gi, '')
                    .replace(/NO TEXT[^.]*\.?/gi, '')
                    .trim();
            }

            const thumbImagePrompt = [
                `Ultra-high-quality YouTube thumbnail. ${aesthetic}.`,
                thumbPrompt ? thumbPrompt + '.' : '',
                `Topic: "${videoTitle}".`,
                `COMPOSITION: Left 55% of frame — ONE dramatic photorealistic focal subject (person with extreme shocked/fearful/amazed expression, or a dramatic object/scene related to the topic). Right 45% of frame — intentionally clean, dark-to-transparent gradient fade, negative space reserved for text overlay (no objects, no faces, no details in right zone).`,
                `STYLE: Cinematic, ultra-vivid colours, deep contrast, harsh directional lighting from left, shallow depth of field. Photorealistic, 4K sharp.`,
                `NO TEXT. NO WORDS. NO LETTERS. NO WATERMARKS anywhere in the image.`
            ].filter(Boolean).join(' ');

            addLog(`[THUMBNAIL] Generating with topic-aware compositional prompt...`);

            const thumbUrl = await safeReplicateRun(
                "black-forest-labs/flux-1.1-pro",
                {
                    input: {
                        prompt: thumbImagePrompt,
                        aspect_ratio: format === 'vertical' ? "9:16" : "16:9",
                        output_format: "jpg"
                    }
                },
                "Thumbnail Gen"
            );
            
            const thumbBuffer = await withRetry(() => axios.get(thumbUrl[0], { responseType: 'arraybuffer' }), "Download Thumbnail");
            
            // 4. SERVER-SIDE TEXT COMPOSITOR — always overlay text in the RIGHT ZONE
            try {
                const sharp = require('sharp');
                const imgBuf = Buffer.from(thumbBuffer.data);
                const meta = await sharp(imgBuf).metadata();
                const W = meta.width || 1920;
                const H = meta.height || 1080;

                // Embed Anton font as base64
                const fontPath = path.join(__dirname, 'assets', 'fonts', 'Anton-Regular.ttf');
                let fontFaceCSS = '';
                if (fs.existsSync(fontPath)) {
                    const fontB64 = fs.readFileSync(fontPath).toString('base64');
                    fontFaceCSS = `@font-face { font-family: 'Anton'; src: url('data:font/truetype;base64,${fontB64}') format('truetype'); }`;
                }
                const fontFamily = fontFaceCSS ? 'Anton' : 'Arial Black, sans-serif';
                const accentColor = highlightColorHex || '#FFD700';
                const thumbDisplay = thumbTextRaw.toUpperCase();

                // Split into lines (one word per line if short, split at midpoint for longer)
                const words = thumbDisplay.split(' ');
                let lines;
                if (words.length <= 2) {
                    lines = words; // each word its own line — big and bold
                } else {
                    const mid = Math.ceil(words.length / 2);
                    lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
                }

                // Text zone: right 45% of image, vertically centred
                const zoneX = Math.round(W * 0.55);
                const zoneW = W - zoneX;

                // Font size: fill ~90% of zone width
                const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');
                let fontSize = Math.min(
                    Math.round(H * 0.28),                                    
                    Math.round(zoneW * 0.90 / (longestLine.length * 0.52))   
                );
                fontSize = Math.max(fontSize, Math.round(H * 0.09)); 
                const lineH = Math.round(fontSize * 1.10);
                const strokeW = Math.max(5, Math.round(fontSize * 0.06));
                const pad = Math.round(fontSize * 0.18); 

                const totalTextH = lines.length * lineH;
                const blockStartY = Math.round((H - totalTextH) / 2); 

                const lineEls = lines.map((line, idx) => {
                    const textY = blockStartY + idx * lineH + lineH * 0.82;
                    const textX = zoneX + Math.round(zoneW / 2); // centred in zone
                    // Approximate text width for pill backing
                    const approxTW = Math.round(line.length * fontSize * 0.52);
                    const minPillW = Math.round(fontSize * 2.5); // min pill so short words still look good
                    const finalPillW = Math.max(approxTW, minPillW);
                    const pillX = textX - Math.round(finalPillW / 2) - pad;
                    const pillY = blockStartY + idx * lineH - Math.round(lineH * 0.12);
                    const pillW = finalPillW + pad * 2;
                    const pillH2 = lineH + Math.round(lineH * 0.12);
                    const r = Math.round(pillH2 * 0.18); // rounded corner radius

                    return `
                        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH2}" rx="${r}" ry="${r}"
                              fill="#000000" fill-opacity="0.78"/>
                        <text
                            x="${textX}" y="${textY}"
                            font-family="${fontFamily}, Impact, Arial Black, sans-serif"
                            font-size="${fontSize}"
                            font-weight="900"
                            fill="${accentColor}"
                            stroke="#000000"
                            stroke-width="${strokeW}"
                            stroke-linejoin="round"
                            paint-order="stroke fill"
                            filter="url(#glow)"
                            text-anchor="middle"
                            dominant-baseline="auto"
                            letter-spacing="2"
                        >${line}</text>`;
                }).join('\n');

                // Vertical dark gradient on the right zone to ensure zone is always readable
                const svgOverlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <style>${fontFaceCSS}</style>
                        <linearGradient id="zone" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
                            <stop offset="40%" stop-color="#000000" stop-opacity="0.55"/>
                            <stop offset="100%" stop-color="#000000" stop-opacity="0.80"/>
                        </linearGradient>
                        <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
                            <feDropShadow dx="0" dy="3" stdDeviation="10" flood-color="#000000" flood-opacity="1"/>
                            <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${accentColor}" flood-opacity="0.5"/>
                        </filter>
                    </defs>
                    <!-- Right-zone darkening gradient -->
                    <rect x="${zoneX - Math.round(W * 0.08)}" y="0" width="${W - zoneX + Math.round(W * 0.08)}" height="${H}" fill="url(#zone)"/>
                    <!-- Text with pill backings -->
                    ${lineEls}
                </svg>`;

                const composited = await sharp(imgBuf)
                    .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
                    .jpeg({ quality: 97 })
                    .toBuffer();

                fs.writeFileSync(thumbLocalPath, composited);
                addLog(`[THUMBNAIL] Composited: "${thumbDisplay}" | ${lines.length} line(s), ${fontSize}px, right-zone layout`);
            } catch (sharpErr) {
                console.warn('[THUMBNAIL] Compositor failed, saving raw:', sharpErr.message);
                fs.writeFileSync(thumbLocalPath, thumbBuffer.data);
            }

            try { fs.copyFileSync(thumbLocalPath, legacyThumbPath); } catch (_) {}
            addLog("Thumbnail Generated Successfully!");
        } catch (e) {
            console.warn("Thumbnail generation failed:", e.message);
        }

        const finalUrl = `/output/${folderName}/video.mp4`;
        
        // Save metadata for the Library
        const metadata = {
            id: videoId,
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: finalUrl,
            thumbnailUrl: fs.existsSync(thumbLocalPath) ? thumbUrlPath : null,
            thumbnailQA: scriptData.thumbnailQA || "N/A",
            imageCount: scriptData.segments.length,
            mainNiche: mainNiche,
            subNiche: subNiche,
            aiDisclosureRequired: true,
            visualSource: visualSource,
            format: format,
            folderPath: videoFolder,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(videoFolder, `metadata.json`), JSON.stringify(metadata, null, 2));
        fs.writeFileSync(path.join(outputDir, `${videoId}.json`), JSON.stringify(metadata, null, 2)); // Legacy root copy

        let publishAtIso = null;
        if (autoSchedule) {
            // Peak-hour calculation: schedule for 15:00 UTC (10 AM EST) the next day
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setUTCHours(15, 0, 0, 0); 
            publishAtIso = tomorrow.toISOString();
        }

        // Save to Postgres videos table
        try {
            if (process.env.DATABASE_URL) {
                await db.query(`
                    INSERT INTO videos (youtube_id, title, description, tags, niche, published_at, status, thumbnail_url, script)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    null, // No youtube_id yet
                    metadata.title,
                    metadata.description,
                    JSON.stringify(metadata.tags),
                    metadata.mainNiche,
                    publishAtIso ? new Date(publishAtIso) : new Date(),
                    'generated',
                    metadata.thumbnailUrl,
                    JSON.stringify(scriptData)
                ]);
            }
        } catch (e) {
            console.error("[DB] Failed to save video to database:", e.message);
        }

        addLog(`Video generated successfully: ${finalUrl}`);
        
        // YouTube Auto-Upload Check
        try {
            const youtubeModule = require('./youtube');
            const channelsRes = await db.query('SELECT * FROM channels');
            const channelsDb = channelsRes.rows;
            // mapped_niches is stored as JSONB array, pg returns it as an array
            const matchedChannel = channelsDb.find(c => c.mapped_niches && c.mapped_niches.includes(mainNiche));
            
            if (matchedChannel) {
                addLog(`[YOUTUBE] Mapped channel found (${matchedChannel.channel_name}). Initiating auto-upload...`);
                const ytVideoId = await youtubeModule.uploadToYouTube(
                    matchedChannel.channel_id,
                    stitchedVideoPath,
                    fs.existsSync(thumbLocalPath) ? thumbLocalPath : null,
                    {
                        title: customTitle || scriptData.title,
                        description: customDescription || scriptData.description,
                        tags: scriptData.tags,
                        mainNiche: mainNiche,
                        publishAt: publishAtIso
                    }
                );
                
                if (process.env.DATABASE_URL && ytVideoId) {
                    await db.query(`UPDATE videos SET youtube_id = $1, status = 'uploaded' WHERE title = $2`, [ytVideoId, metadata.title]);
                }
                addLog(`[YOUTUBE] Upload complete! Private Video ID: ${ytVideoId}`);
            } else {
                addLog(`[YOUTUBE] No channel mapped for niche '${mainNiche}'. Skipping auto-upload.`);
            }
        } catch (ytErr) {
            console.error("[YOUTUBE ERROR]", ytErr);
            addLog(`[WARN] YouTube auto-upload failed: ${ytErr.message}`);
        }

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

const youtube = require('./youtube');

app.get('/api/youtube/auth', (req, res) => {
    res.json({ url: youtube.getAuthUrl() });
});

app.get('/api/youtube/callback', async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
        const code = req.query.code;
        await youtube.handleCallback(code);
        res.redirect(`${frontendUrl}/#/channels?success=true`);
    } catch (err) {
        console.error("YouTube Auth Error:", err);
        res.redirect(`${frontendUrl}/#/channels?error=true`);
    }
});

app.post('/api/analytics/sync', async (req, res) => {
    try {
        await cronModule.syncAnalytics();
        res.json({ success: true, message: 'Analytics synced manually.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/youtube/channels', async (req, res) => {
    try {
        const result = await db.query('SELECT channel_id as "channelId", channel_name as "channelName", avatar as "channelAvatar", mapped_niches as "mappedNiches" FROM channels');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/youtube/channels/:id/niches', async (req, res) => {
    const { niches } = req.body;
    try {
        await db.query('UPDATE channels SET mapped_niches = $1 WHERE channel_id = $2', [JSON.stringify(niches || []), req.params.id]);
        res.json({ success: true, mappedNiches: niches });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/youtube/channels/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM channels WHERE channel_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
    res.json({ 
        isRunning: !!global.currentJob, 
        currentJobId: global.currentJob?.id || null,
        queueLength: global.jobQueue ? global.jobQueue.length : 0
    });
});

app.post('/api/queue/clear', (req, res) => {
    global.jobQueue = [];
    res.json({ message: "Queue cleared." });
});

app.get('/api/videos', async (req, res) => {
    try {
        if (process.env.DATABASE_URL) {
            const result = await db.query('SELECT * FROM videos ORDER BY created_at DESC');
            return res.json(result.rows);
        }
        
        // Legacy file scan fallback
        const videos = [];
        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    scanDir(fullPath);
                } else if (file.endsWith('.json') && file !== 'status.json' && file !== 'channels.json') {
                    try {
                        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                        if (data.id && data.title) {
                            videos.push(data);
                        }
                    } catch (e) { }
                }
            }
        };
        scanDir(outputDir);
        // Deduplicate by video id
        const unique = [];
        const seen = new Set();
        videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        for (const v of videos) {
            const key = v.id || v.videoUrl;
            if (key && !seen.has(key)) {
                seen.add(key);
                unique.push(v);
            }
        }
        res.json(unique);
    } catch (err) {
        console.error("Error reading video library:", err);
        res.status(500).json({ error: "Failed to read videos" });
    }
});

app.use('/output', express.static(outputDir));

const port = process.env.PORT || 5000;
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

module.exports = { generateVideoJob, app };
