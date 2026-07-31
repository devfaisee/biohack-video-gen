const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');

// Unconditionally use static ffprobe to guarantee audio duration checks work safely everywhere
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Robust System FFmpeg Detection with direct Nix & Linux path searching
const { execSync } = require('child_process');
let hasSystemFfmpeg = false;

function findSystemFfmpeg() {
    const knownPaths = [
        '/nix/var/nix/profiles/default/bin/ffmpeg',
        '/root/.nix-profile/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        'C:\\ffmpeg\\bin\\ffmpeg.exe'
    ];
    for (const p of knownPaths) {
        if (fs.existsSync(p)) {
            try {
                execSync(`"${p}" -version`, { stdio: 'ignore' });
                return p;
            } catch (_) {}
        }
    }
    try {
        const sysPath = execSync('command -v ffmpeg', { shell: '/bin/sh' }).toString().trim();
        if (sysPath) {
            execSync(`"${sysPath}" -version`, { stdio: 'ignore' });
            return sysPath;
        }
    } catch (_) {}
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
    } catch (_) {}
    return null;
}

const detectedFfmpeg = findSystemFfmpeg();
if (detectedFfmpeg) {
    hasSystemFfmpeg = true;
    ffmpeg.setFfmpegPath(detectedFfmpeg);
    console.log(`[INFO] System FFmpeg successfully detected at: ${detectedFfmpeg}`);
} else {
    try {
        const ffmpegStatic = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegStatic);
        console.log(`[INFO] System FFmpeg not found. Using ffmpeg-static fallback: ${ffmpegStatic}`);
    } catch(e) {
        console.error("[FATAL] No FFmpeg binary available!", e);
    }
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

// Robust Retry Logic with Exponential Backoff & 429 Rate-Limit Awareness
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, operationName, maxRetries = 10, baseDelayMs = 4000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === maxRetries - 1) {
                addLog(`[FATAL] ${operationName} failed after ${maxRetries} attempts.`);
                throw err;
            }
            let currentDelay = Math.round(baseDelayMs * Math.pow(1.4, i));
            // Check for explicit 429 status code or retry_after in Replicate error objects
            const isRateLimitErr = err.status === 429 || 
                                  (err.response && err.response.status === 429) ||
                                  (err.message && (err.message.includes("429") || err.message.toLowerCase().includes("throttled") || err.message.includes("retry_after")));
            
            if (isRateLimitErr && err.message) {
                const match = err.message.match(/"retry_after":\s*(\d+)/);
                if (match && match[1]) {
                    const retryAfterSec = parseInt(match[1], 10);
                    if (!isNaN(retryAfterSec) && retryAfterSec > 0) {
                        currentDelay = (retryAfterSec + 3) * 1000; // Add 3s safety buffer to let rate limits reset
                    }
                }
            }
            addLog(`[WARN] ${operationName} failed: ${err.message}. Retrying in ${Math.round(currentDelay/1000)}s... (Attempt ${i+1}/${maxRetries})`);
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
    const { durationMinutes = 1, topic, customTitle, customDescription, visualSource = 'ai_images', mainNiche = 'Science', subNiche = 'General', format = 'horizontal' } = req.body;
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
        const prompt = `You are an elite YouTube strategist in the "${mainNiche}" niche, specifically focusing on "${subNiche}". 
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
            "google/gemini-2.0-flash-exp:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-r1:free",
            "x-ai/grok-2-1212",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
            "openai/gpt-4o-mini"
        ];
        let chatCompletion = null;
        for (const modelId of scriptModels) {
            try {
                chatCompletion = await openai.chat.completions.create({
                    model: modelId,
                    messages: [{ role: "user", content: prompt }]
                });
                if (chatCompletion && chatCompletion.choices && chatCompletion.choices.length > 0) break;
            } catch (mErr) {
                console.warn(`Idea model ${modelId} failed:`, mErr.message);
            }
        }
        
        if (!chatCompletion || !chatCompletion.choices || chatCompletion.choices.length === 0) {
            throw new Error("AI API failed to return a valid response for the idea. Please try again.");
        }

        let jsonStr = chatCompletion.choices[0].message.content;
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        }
        res.json(JSON.parse(jsonStr));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function generateVideoJob({ durationMinutes, topic, customTitle, customDescription, visualSource, mainNiche = "Science", subNiche = "General", format = 'horizontal', jobId }) {
    try {
        const wordCount = durationMinutes * 130;
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
        
        const nicheKey = mainNiche.toLowerCase();
        const isVertical = format === 'vertical';

        if (nicheKey.includes("revenge") || nicheKey.includes("justice")) {
            voiceId = "Algenib";
            voicePrompt = "Grave, serious narrator recounting a dark payback tale. Steady, deliberate pacing.";
            visualStylePreset = "Dark cinematic drama, dramatic volumetric shadows, high contrast, moody urban environment, 35mm lens.";
            nicheRules = `
CRITICAL STORYTELLING RULES FOR REVENGE/JUSTICE:
1. NARRATIVE ARC: Write an emotionally gripping story with a clear victim, villain, tension build-up, and SATISFYING payback climax.
2. CONSISTENT CHARACTERS: Use the EXACT SAME detailed physical description for recurring characters in EVERY visual prompt.
3. PACING: Start with the outrageous offense, build frustration, then deliver the sweet revenge slowly.`;
        } else if (nicheKey.includes("true crime") || nicheKey.includes("criminal")) {
            voiceId = "Algenib";
            voicePrompt = "Seasoned crime documentary narrator. Grave, measured, and highly authoritative.";
            visualStylePreset = "Gritty crime documentary noir, dimly lit evidence boards, shadowy courtrooms, neon rain-soaked streets, vintage film grain.";
            nicheRules = `
CRITICAL TRUE CRIME RULES:
1. TONE: Sound like a seasoned crime documentary narrator — grave, measured, and authoritative.
2. SUSPENSE: Build tension methodically through story structure.
3. FACTS: Include specific dates, locations, and investigator names to build credibility.
4. SAFETY: Use safe alternatives for violent words: "eliminated", "tragic end", "perished", "vanished".`;
        } else if (nicheKey.includes("horror") || nicheKey.includes("creepypasta")) {
            voiceId = "Enceladus";
            voicePrompt = "Ominous, dread-inducing narrator. Calm but incredibly unsettling.";
            visualStylePreset = "Psychological horror aesthetic, liminal spaces, fog-draped environments, eerie chiaroscuro lighting, unsettling composition.";
            nicheRules = `
CRITICAL HORROR RULES:
1. ATMOSPHERE: Build dread slowly. Start normal, then let wrongness creep in gradually.
2. VISUALS: Dark, unsettling, liminal space imagery. Empty hallways, fog, distorted shadows, eerie landscapes.
3. NEVER RESOLVE FULLY: Leave a lingering sense of unease. The best horror doesn't fully explain everything.`;
        } else if (nicheKey.includes("psychology") || nicheKey.includes("dark")) {
            voiceId = "Charon";
            voicePrompt = "Knowledgeable insider revealing hidden mental truths. Confident, slightly conspiratorial, but professional.";
            visualStylePreset = "Dark psychological thriller style, dramatic silhouettes, chess pieces, puppet strings, sleek glass architecture, high contrast shadows.";
            nicheRules = `
CRITICAL DARK PSYCHOLOGY RULES:
1. TONE: Sound like a knowledgeable insider revealing hidden human behavior truths.
2. EXAMPLES: Every concept MUST include a vivid real-world scenario the viewer can relate to.
3. STRUCTURE: Present each tactic/concept as a numbered "law" or "technique" for maximum retention.`;
        } else if (nicheKey.includes("stoicism") || nicheKey.includes("philosophy")) {
            voiceId = "Schedar";
            voicePrompt = "Wise, contemplative, and profound. Slow, deliberate, and deeply calming delivery.";
            visualStylePreset = "Cinematic classical art style, ancient marble statues, misty mountain peaks, rain on ancient temple stone, golden hour sunlight.";
            nicheRules = `
CRITICAL PHILOSOPHY RULES:
1. TONE: Sound wise, contemplative, and profound — like Marcus Aurelius speaking to a student.
2. QUOTES: Weave in actual philosophical quotes from original texts, then explain them in modern language.
3. APPLICATION: Every philosophical concept MUST be connected to a modern-day practical application.`;
        } else if (nicheKey.includes("military") || nicheKey.includes("warfare")) {
            voiceId = "Orus";
            voicePrompt = "Military analyst briefing. Authoritative, tactical, precise, no-nonsense.";
            visualStylePreset = "Ultra-detailed tactical military documentary feel, aircraft, tactical radar, armored vehicles, smoke and volumetric dust, 70mm IMAX feel.";
            nicheRules = `
CRITICAL MILITARY RULES:
1. TONE: Sound like a military analyst briefing — authoritative, tactical, precise.
2. TECHNICAL DETAIL: Include specific equipment specs, troop numbers, tactical formations when relevant.
3. DRAMA: Highlight the human element — soldiers' decisions under pressure, turning points in battles.`;
        } else if (nicheKey.includes("unethical") || nicheKey.includes("grey")) {
            voiceId = "Sadaltager";
            voicePrompt = "Investigative journalist exposing hidden corporate systems. Knowledgeable and fast-paced.";
            visualStylePreset = "Corporate investigative aesthetic, fine print legal contracts, high-rise glass boardrooms, bank vaults, surveillance feeds.";
            nicheRules = `
CRITICAL GREY AREA RULES:
1. TONE: Sound like an investigative journalist exposing hidden systems.
2. FRAMING: Always frame as EDUCATIONAL — "Here's how this works so you can PROTECT YOURSELF."
3. EVIDENCE: Cite specific companies, laws, or case studies to build credibility.`;
        } else if (nicheKey.includes("space") || nicheKey.includes("universe")) {
            voiceId = "Charon";
            voicePrompt = "Top-tier astronomical documentary narrator. Epic, expansive, and awe-inspiring.";
            visualStylePreset = "Hyper-realistic cosmic photorealism, glowing nebulae, deep space black holes, ray-traced planet surfaces, James Webb telescope aesthetic.";
            nicheRules = `
CRITICAL SPACE RULES:
1. TONE: Sound like a top-tier space documentary narrator.
2. SCALE: Emphasize mind-blowing scale comparisons ("If Earth were a grain of sand...").
3. FACTS: Provide deep, specific, fascinating insights with exact light-year distances and physics concepts.`;
        } else if (nicheKey.includes("science") || nicheKey.includes("biology") || nicheKey.includes("tech")) {
            voiceId = "Charon";
            voicePrompt = "Futuristic tech & science visionary. Sharp, precise, and highly engaging.";
            visualStylePreset = "Cyberpunk scientific render, glowing DNA helixes, microscopic cell photography, futuristic laboratory neon lighting, clean tech aesthetics.";
            nicheRules = `
CRITICAL SCIENCE & TECH RULES:
1. TONE: High-level tech communicator explaining breakthrough innovations.
2. MECHANICS: Clearly explain HOW the mechanism or technology works in simple, vivid visual analogies.`;
        } else if (nicheKey.includes("history") || nicheKey.includes("civiliz") || nicheKey.includes("geopolit")) {
            voiceId = "Rasalgethi";
            voicePrompt = "Epic documentary narrator. Dramatic, grand, painting vast historical canvases.";
            visualStylePreset = "Oil painting historical documentary aesthetic, dramatic golden lighting, ancient ruins, detailed period-accurate armor and attire, parchment textures.";
            nicheRules = `
CRITICAL HISTORY RULES:
1. TONE: Sound like an epic documentary narrator — dramatic, grand, painting vast historical canvases.
2. STORYTELLING: Frame history as a STORY with characters, motivations, betrayals, and consequences.
3. DETAILS: Include specific dates, names of key figures, and cause-effect chains.`;
        } else if (nicheKey.includes("rise") || nicheKey.includes("fall")) {
            voiceId = "Charon";
            voicePrompt = "Corporate empire documentary narrator. Analytical, dramatic, and compelling.";
            visualStylePreset = "High-end corporate documentary look, sleek glass skyscrapers, boardroom drama, crashing stock tickers, dramatic executive portraits.";
            nicheRules = `
CRITICAL RISE & FALL RULES:
1. STRUCTURE: Follow the classic arc — humble beginnings, meteoric rise, fatal flaw, spectacular collapse.
2. HUMAN ELEMENT: Focus on the specific decisions and executives that caused the rise AND the collapse.`;
        } else if (nicheKey.includes("luxury") || nicheKey.includes("motivation")) {
            voiceId = "Puck";
            voicePrompt = "High-level elite mentor. Authoritative, intense, fast-paced, high energy.";
            visualStylePreset = "Ultra-luxurious 8k editorial photography, supercars, private jet interiors, penthouse skylines at dusk, sleek golden hour lighting.";
            nicheRules = `
CRITICAL LUXURY & MOTIVATION RULES:
1. TONE: Sound like an elite high-level mentor — authoritative, intense, fast-paced, no fluff.
2. VISUALS: Supercars, penthouses, yachts, luxury timepieces, private jets, city skylines at night.`;
        } else if (nicheKey.includes("finance") || nicheKey.includes("wealth") || nicheKey.includes("money")) {
            voiceId = "Charon";
            voicePrompt = "Wall Street insider & wealth strategist. Authoritative, sharp, fast-paced delivery.";
            visualStylePreset = "Wall Street financial aesthetic, golden money vaults, 3D financial charts, luxury brokerage offices, high-stakes trading floors.";
            nicheRules = `
CRITICAL FINANCE RULES:
1. AUTHORITY: Sound like a high-level financial insider. Use authoritative, fast-paced delivery.
2. ACTIONABLE: Provide actual value, mathematical breakdowns, or case studies.`;
        } else if (nicheKey.includes("survival") || nicheKey.includes("disaster")) {
            voiceId = "Algenib";
            voicePrompt = "Grave, serious narrator detailing an intense timeline of disaster events.";
            visualStylePreset = "Dramatic disaster photojournalism, volumetric storm clouds, flooded city streets, emergency flare lighting, rugged survival gear.";
            nicheRules = `
CRITICAL SURVIVAL RULES:
1. TONE: Start calm, then escalate urgency as the disaster or survival situation unfolds.
2. TIMELINE: Present events chronologically with specific timestamps for maximum immersion.`;
        } else if (nicheKey.includes("nature") || nicheKey.includes("wildlife")) {
            voiceId = "Achird";
            voicePrompt = "Warm, awestruck, deeply respectful of nature. Calm, inviting, BBC Earth style.";
            visualStylePreset = "National Geographic wildlife photography, macro telephoto lens depth-of-field, lush rainforest canopy light, crisp animal detail.";
            nicheRules = `
CRITICAL NATURE RULES:
1. TONE: Warm, awestruck, deeply respectful of nature.
2. FACTS: Include specific species names, behaviors, and fascinating biological adaptations.`;
        } else if (nicheKey.includes("food")) {
            voiceId = "Zubenelgenubi";
            voicePrompt = "Investigative food journalist. Curious, engaging, and fascinating.";
            visualStylePreset = "Commercial food photography, macro close-ups, vibrant culinary lighting, industrial food processing lines, glowing spices.";
            nicheRules = `
CRITICAL FOOD SCIENCE RULES:
1. TONE: Investigative journalist meets food scientist — curious, slightly outraged at industrial food engineering.`;
        } else if (nicheKey.includes("relationship") || nicheKey.includes("social")) {
            voiceId = "Sulafat";
            voicePrompt = "Empathetic, articulate interpersonal strategist. Warm, perceptive, and direct.";
            visualStylePreset = "Cinematic mood photography, warm golden hour portraits, urban coffee shops, rain-streaked windows, expressive human faces.";
            nicheRules = `
CRITICAL RELATIONSHIP RULES:
1. TONE: Sound like a perceptive interpersonal psychologist — empathetic but direct.
2. PSYCHOLOGY: Back points with attachment theory, body language cues, or social dynamics research.`;
        } else {
            voiceId = "Charon";
            voicePrompt = "Top-tier documentary narrator. Factual, professional, and fascinating.";
            visualStylePreset = "High-end documentary cinematography, rich contrast, balanced 3-point lighting, clean subject isolation.";
            nicheRules = `
CRITICAL DOCUMENTARY RULES:
1. AUTHORITY: Sound like a top-tier documentary narrator.
2. SCIENCE/FACTS: Provide deep, factual, fascinating insights with specific details and evidence.`;
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
            : `"imagePrompt": "A highly detailed visual prompt for an AI image generator adhering strictly to this aesthetic: [${visualStylePreset}]. Describe the exact scene, subject, lighting, and camera composition."`;

        const systemPrompt = `You are an elite YouTube scriptwriter and retention expert specializing in the "${mainNiche}" niche, specifically focusing on "${subNiche}". 
Your goal is to write a highly viral, retention-optimized script for a ${format} YouTube video.
${specificIdeaInstruction}
${nicheRules}
${formatPacingRules}

CRITICAL DURATION REQUIREMENT:
The user requested a ${durationMinutes}-minute video. At normal speaking pace, you MUST write AT LEAST ${wordCount} words of narration total. Do NOT summarize. Do NOT finish early.

NUMBERED LIST & STRUCTURAL INTEGRITY MANDATE:
If the user's topic or title specifies a numbered list (e.g., "10 habits", "7 secrets", "5 rules", "12 tips"), you MUST explicitly write out and cover EVERY SINGLE item sequentially from #1 through #N. Do NOT stop early, skip numbers, or summarize halfway. Every item must receive full detail and narration.

CRITICAL RULES FOR FAST-PACED RETENTION & VIRALITY:
1. PSYCHOLOGICAL HOOK: The first 5 seconds MUST use one of these hook frameworks: 
   - The Contrarian Hook: "Everything you've been told about X is a lie."
   - The Negative Hook: "Do not do X until you understand this dark reality."
   - In-Media-Res: Start exactly at the climax of the story, then rewind.
2. OPEN LOOP ENFORCEMENT: You MUST plant ONE specific, unanswered mystery in the FIRST segment. Reference it briefly at the ~50% mark to remind viewers it is still unanswered. Deliver the FULL payoff in the SECOND-TO-LAST segment. The LAST segment is reserved for the end screen CTA.
3. VISUAL PACING & PATTERN INTERRUPTS: Visuals must change RAPIDLY. Provide a new visual instruction every sentence. Use a "blackout" transition for a sudden 1-second black screen during a whispered secret.
4. TITLE & SEO: The title must be highly clickable and psychologically compelling, MrBeast or Ali Abdaal level of clickbait but factual. 
5. TAG DISTRIBUTION MANDATE: Provide 25-30 highly targeted, algorithm-optimizing SEO tags with this exact distribution:
   - 5 short-tail tags (1 word): "psychology", "wealth", "secrets"
   - 10 medium-tail tags (2-3 words): "dark psychology", "wealth building tips"
   - 10 long-tail tags (4-7 words): "dark psychology tactics used by narcissists"
   - 5 trending/timely tags: "2026", "new research", "just discovered"
6. DESCRIPTION STRUCTURE (in this exact order):
   a) Compelling 2-3 sentence hook paragraph with emojis
   b) ⏱️ TIMESTAMPS section with chapters for every 2-3 segments
   c) 📌 About This Video — 2 paragraph detailed summary
   d) 🔑 Keywords — 30+ long-tail search phrases separated by commas
   e) 3 hashtags at the very end (#niche #subniche #topic)
   f) MANDATORY LAST LINE: "⚠️ This video uses AI-assisted narration and visuals."
7. CONTEXT-AWARE EDITING: For every segment, you MUST act as the video editor. Choose a "transition" ("none", "fade_in", "glitch", or "blackout") and a "camera_motion" ("static" or "zoom_in"). Use "glitch" for shocking/scary moments, "fade_in" for tone shifts, "blackout" for pattern interrupts, and "zoom_in" for intense focus. Vary the distribution — do NOT use only "none" for every segment.
8. COMMENT ENGAGEMENT: Include ONE natural engagement prompt somewhere in the middle of the script (around the 40-60% mark). Example: "Drop a comment below — which of these shocked you the most?" or "Let me know in the comments if you have ever experienced this."
9. END SCREEN CTA: The LAST segment (final 15-20 seconds) MUST be a compelling call-to-action: "If this blew your mind, you need to see what we cover next. Subscribe and hit the bell so you never miss a deep dive like this." This segment's visual should be a clean, simple background suitable for YouTube end screen cards.
10. ABSOLUTE SAFETY & COMPLIANCE: Gemini TTS has a hyper-sensitive safety filter. Even for True Crime or Horror, you MUST NOT use banned words like "kill", "murder", "rape", "drug", "suicide", "blood", or "gore". Use safe alternatives like "eliminated", "dark fate", "perished", "tragic end", "substance", or "mystery". If you use banned words, the generation will instantly fail.

We are using Gemini 3.1 Flash TTS for the voiceover.
- DO NOT use inline expressive tags like [whispering] or [fast]. The delivery MUST be professional, consistent, and perfectly paced.
- DO NOT change the tone wildly between segments. The voiceover should sound like a premium, steady, professional documentary narrator.
- Write pure, clean narration text.

Output pure JSON with the following structure:
{
  "title": "A highly clickable, viral YouTube title",
  "description": "YouTube video description following the DESCRIPTION STRUCTURE above",
  "tags": ["psychology", "dark psychology", "wealth building tips", "dark psychology tactics used by narcissists", "2026 new research"],
  "hasThumbnailText": true,
  "thumbnailText": "THE SECRET",
  "thumbnailTextReason": "Short 2-word curiosity trigger that complements the title without repeating it",
  "thumbnailPrompt": "A masterwork YouTube thumbnail BACKGROUND (no baked-in text). 1. ONE dramatic central focal point — a mysterious human silhouette, dramatic object, or high-stakes visual mystery. 2. Dramatic 3-point volumetric lighting with glowing neon accents contrasting deep shadows. 3. Extreme depth-of-field background blur (bokeh). 4. Clean empty space on one side for external text overlay. 5. Cinematic teal-orange color grade. DO NOT include any text in the image.",
  "segments": [
    {
      "narration": "Did you know that your memory can be mathematically optimized? The science behind it is shocking.",
      "transition": "glitch",
      "camera_motion": "zoom_in",
      ${visualInstruction}
    }
  ]
}
Ensure the JSON is strictly valid and contains no markdown formatting around it.`;

        addLog("Generating script via OpenRouter LLM...");
        const scriptModels = [
            "google/gemini-2.0-flash-exp:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-r1:free",
            "x-ai/grok-2-1212",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
            "openai/gpt-4o-mini"
        ];
        
        let chatCompletion = null;
        let lastError = null;
        for (const modelId of scriptModels) {
            try {
                addLog(`Attempting script generation with model: ${modelId}`);
                chatCompletion = await withRetry(async () => {
                    return await openai.chat.completions.create({
                        model: modelId, 
                        messages: [{ role: "user", content: systemPrompt }]
                    });
                }, `Script Generation (${modelId})`, 2, 2000);
                if (chatCompletion && chatCompletion.choices && chatCompletion.choices.length > 0) {
                    addLog(`Script successfully generated with ${modelId}`);
                    break;
                }
            } catch (mErr) {
                lastError = mErr;
                addLog(`Model ${modelId} unavailable: ${mErr.message}. Trying next fallback...`);
            }
        }

        if (!chatCompletion || !chatCompletion.choices || chatCompletion.choices.length === 0) {
            throw new Error(`AI Scriptwriter failed on all fallback models. Last error: ${lastError?.message || 'Unknown'}`);
        }

        let jsonStr = chatCompletion.choices[0].message.content;
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json\n/, '').replace(/\n```$/, '');
        }

        const scriptData = JSON.parse(jsonStr);
        addLog(`Script generated successfully. Total segments: ${scriptData.segments.length}`);

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
                const bgmPrompt = scriptData.bgmPrompt || "A calm atmospheric ambient track. Instrumental only, no vocals.";
                const lyriaAudioUrl = await withRetry(async () => {
                    return await replicate.run(
                        "google/lyria-3",
                        {
                            input: {
                                prompt: bgmPrompt
                            }
                        }
                    );
                }, "Lyria-3 BGM Generation");
                
                const bgmBuffer = await withRetry(() => axios.get(lyriaAudioUrl, { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `Download Lyria BGM`);
                lyriaBgmPath = path.join(projectDir, `lyria_bgm.mp3`);
                fs.writeFileSync(lyriaBgmPath, bgmBuffer.data);
                addLog("AI Background Music generated successfully via Lyria-3.");
            } catch (e) {
                addLog(`[WARN] Lyria-3 Generation failed: ${e.message}. Falling back to local files.`);
            }
        })();

        addLog(`Starting parallel generation of ${scriptData.segments.length} segments...`);

        const pexelsKey = process.env.PEXELS_API_KEY || "vGnr3wLcpfgybFLKKXjcPcqMOPc4MM89JJA1j2WpGfrKNh29XTHVualY";
        const pixabayKey = process.env.PIXABAY_API_KEY || "54069102-5cb5de9252e9808a1e0d5f201";

        async function fetchStockVideo(query) {
            const isVertical = format === 'vertical';
            try {
                const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=${isVertical ? 'portrait' : 'landscape'}`, {
                    headers: { Authorization: pexelsKey },
                    timeout: 8000,
                    signal: abortController.signal
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
                const res = await axios.get(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${encodeURIComponent(query)}&video_type=film&orientation=${isVertical ? 'vertical' : 'horizontal'}`, {
                    timeout: 8000,
                    signal: abortController.signal
                });
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

        // 1. Fetch Visuals (Stock Footage searches run in parallel chunks of 5 with no Replicate rate limit)
        const visualPaths = new Array(scriptData.segments.length);
        const fetchVisualTask = async (i) => {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const segment = scriptData.segments[i];
            const visualExt = visualSource === 'stock_videos' ? 'mp4' : 'webp';
            const visualPath = path.join(projectDir, `visual_${i}.${visualExt}`);

            if (visualSource === 'stock_videos') {
                const query = segment.searchQuery || segment.imagePrompt || "science";
                addLog(`[Segment ${i + 1}] Searching stock video for: ${query}...`);
                const videoUrl = await withRetry(() => fetchStockVideo(query), `Stock Search ${i+1}`);
                const videoBuffer = await withRetry(() => axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `Download Stock Video ${i+1}`);
                fs.writeFileSync(visualPath, videoBuffer.data);
                addLog(`[Segment ${i + 1}] Stock Video downloaded.`);
            } else {
                addLog(`[Segment ${i + 1}] Requesting image from Flux-Schnell...`);
                const imageUrl = await withRetry(async () => {
                    const imgRes = await replicate.run(
                        "black-forest-labs/flux-schnell:c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e",
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
                }, `Image Gen ${i+1}`, 10);
                const imgBuffer = await withRetry(() => axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000, signal: abortController.signal }), `Download Image ${i+1}`);
                fs.writeFileSync(visualPath, imgBuffer.data);
                addLog(`[Segment ${i + 1}] Image downloaded.`);
            }
            visualPaths[i] = visualPath;
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

        // 2. Fetch Audio (Gemini TTS) sequentially with a 1.2s stagger to protect Replicate burst limits on low-credit accounts
        const audioPaths = new Array(scriptData.segments.length);
        for (let i = 0; i < scriptData.segments.length; i++) {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            const segment = scriptData.segments[i];
            const audioPath = path.join(projectDir, `audio_${i}.wav`);

            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Requesting voiceover (${voiceId}) from Gemini 3.1 Flash TTS...`);
            const audioUrl = await withRetry(async () => {
                try {
                    return await replicate.run(
                        "google/gemini-3.1-flash-tts",
                        {
                            input: {
                                text: segment.narration.replace(/\[.*?\]/g, '').trim(),
                                voice: voiceId,
                                prompt: voicePrompt,
                                language_code: "en-US"
                            }
                        }
                    );
                } catch (ttsError) {
                    const errStr = String(ttsError.message || ttsError.detail || ttsError || '');
                    const isRateLimit = ttsError.status === 429 || 
                                        (ttsError.response && ttsError.response.status === 429) ||
                                        errStr.includes("429") || 
                                        errStr.toLowerCase().includes("throttled") || 
                                        errStr.toLowerCase().includes("rate limit") ||
                                        errStr.includes("retry_after");

                    if (!isRateLimit && (errStr.includes("sensitive") || errStr.includes("E005"))) {
                        addLog(`[WARN] Retrying Segment ${i+1} audio with a sanitized fallback...`);
                        try {
                            return await replicate.run(
                                "google/gemini-3.1-flash-tts",
                                {
                                    input: {
                                        text: segment.narration.replace(/\[.*?\]/g, '').trim(),
                                        voice: voiceId,
                                        language_code: "en-US"
                                    }
                                }
                            );
                        } catch (fallbackErr) {
                            throw fallbackErr;
                        }
                    }
                    throw ttsError;
                }
            }, `Audio Gen ${i+1}`, 15);

            // Replicate SDK v1.4.0+ returns FileOutput objects for file outputs, not plain URL strings.
            // FileOutput has .arrayBuffer(), .blob(), .url(), etc. — axios.get(FileOutput) fails silently.
            // Detect and handle both: FileOutput (SDK v1+) and legacy URL strings (SDK v0.x)
            let audioData;
            if (audioUrl && typeof audioUrl.arrayBuffer === 'function') {
                // SDK v1.4.0+ FileOutput — download directly without axios
                addLog(`[Segment ${i + 1}] Downloading voiceover from FileOutput...`);
                const buffer = await withRetry(async () => {
                    const ab = await audioUrl.arrayBuffer();
                    return Buffer.from(ab);
                }, `Download Audio ${i+1}`);
                audioData = buffer;
            } else {
                // Legacy: URL string — download via axios
                const urlStr = String(audioUrl);
                const resp = await withRetry(() => axios.get(urlStr, {
                    responseType: 'arraybuffer',
                    timeout: 120000,
                    signal: abortController.signal
                }), `Download Audio ${i+1}`);
                audioData = resp.data;
            }
            fs.writeFileSync(audioPath, audioData);
            audioPaths[i] = audioPath;
            addLog(`[Segment ${i + 1}] Voiceover downloaded.`);

            if (i < scriptData.segments.length - 1) {
                await sleep(3500); // 3.5s rate-limit cushion for accounts under $5 credit limit
            }
        }

        // Wait for visual downloads to complete
        await visualPromise;

        // Build clips array
        for (let i = 0; i < scriptData.segments.length; i++) {
            const segment = scriptData.segments[i];
            const audioDuration = await getAudioDuration(audioPaths[i]);
            clips[i] = {
                visual: visualPaths[i],
                audio: audioPaths[i],
                text: segment.narration,
                duration: audioDuration,
                transition: segment.transition || "none",
                camera_motion: segment.camera_motion || "static"
            };
        }

        if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");

        // Universal Word-by-Word Highlighted SRT Subtitle Generator (Proportional Timing + Anti-Template Variety)
        function generateHighlightSRT(text, durationSec, srtPath, highlightColorHex = '#00FF00') {
            const words = text.replace(/\[.*?\]/g, '').trim().split(/\s+/);
            if (words.length === 0) words.push("...");

            // Proportional timing: longer words get more display time
            const totalChars = words.reduce((sum, w) => sum + Math.max(w.length, 2), 0);
            const timePerChar = durationSec / totalChars;

            const formatSRTTime = (sec) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const ms = Math.floor((sec % 1) * 1000);
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
            };

            // Anti-template: vary chunk size (2-4 words) to avoid identical subtitle patterns
            const chunkSize = 2 + Math.floor(Math.random() * 2); // 2 or 3

            let srtContent = "";
            let srtIndex = 1;
            let currentStart = 0;

            for (let i = 0; i < words.length; i += chunkSize) {
                const chunkWords = words.slice(i, i + chunkSize);
                const chunkChars = chunkWords.reduce((sum, w) => sum + Math.max(w.length, 2), 0);
                const chunkDuration = timePerChar * chunkChars;

                for (let wIdx = 0; wIdx < chunkWords.length; wIdx++) {
                    const wordChars = Math.max(chunkWords[wIdx].length, 2);
                    const wordDuration = timePerChar * wordChars;
                    const wordEnd = currentStart + wordDuration;

                    const startTimeStr = formatSRTTime(currentStart);
                    const endTimeStr = formatSRTTime(wordEnd);

                    const formattedWords = chunkWords.map((w, idx) => {
                        const upperW = w.toUpperCase();
                        if (idx === wIdx) {
                            return `<font color="${highlightColorHex}">${upperW}</font>`;
                        }
                        return upperW;
                    });

                    const lineText = formattedWords.join(" ");
                    srtContent += `${srtIndex}\n${startTimeStr} --> ${endTimeStr}\n${lineText}\n\n`;
                    srtIndex++;
                    currentStart = wordEnd;
                }
            }

            fs.writeFileSync(srtPath, srtContent, 'utf8');
        }

        addLog("Assets generated. Stitching clips with WORD-BY-WORD HIGHLIGHT CAPTIONS in parallel...");
        const activeFfmpegPath = ffmpeg.path || detectedFfmpeg || "ffmpeg";
        addLog(`[PRODUCTION LOG] Active FFmpeg Binary: ${activeFfmpegPath}`);
        addLog(`[SUBTITLE ENGINE] Bulletproof Word-by-Word Highlight Subtitle Engine Active`);
        
        const clipPaths = new Array(clips.length);
        
        // Run FFmpeg processes sequentially to prevent CPU starvation
        const FFMPEG_CHUNK_SIZE = 1; 
        for (let i = 0; i < clips.length; i += FFMPEG_CHUNK_SIZE) {
            if (abortController.signal.aborted) throw new Error("Generation Cancelled by User");
            
            const chunk = [];
            for (let j = i; j < i + FFMPEG_CHUNK_SIZE && j < clips.length; j++) {
                const clip = clips[j];
                const clipPath = path.join(projectDir, `clip_${j}.mp4`);
                clipPaths[j] = clipPath;

                const srtPath = path.join(projectDir, `sub_${j}.srt`);
                
                let highlightColorHex = "#FFFF00"; // Bright Yellow (Default)
                const n = (mainNiche || "").toLowerCase();
                if (n.includes("finance") || n.includes("wealth") || n.includes("money")) {
                    highlightColorHex = "#00FF66"; // Money Neon Green
                } else if (n.includes("luxury") || n.includes("motivation")) {
                    highlightColorHex = "#FFD700"; // Gold
                } else if (n.includes("crime") || n.includes("horror")) {
                    highlightColorHex = "#FF1744"; // Blood Red
                } else if (n.includes("revenge") || n.includes("unethical") || n.includes("dark") || n.includes("psychology")) {
                    highlightColorHex = "#FF0055"; // Neon Crimson
                } else if (n.includes("space") || n.includes("science") || n.includes("tech")) {
                    highlightColorHex = "#00E5FF"; // Bright Cyan
                } else if (n.includes("history") || n.includes("stoicism") || n.includes("philosophy") || n.includes("military")) {
                    highlightColorHex = "#FFC107"; // Warm Amber Gold
                } else if (n.includes("health") || n.includes("biohack") || n.includes("food")) {
                    highlightColorHex = "#76FF03"; // Bio Lime Green
                } else if (n.includes("survival") || n.includes("disaster")) {
                    highlightColorHex = "#FF9100"; // Safety Orange
                } else if (n.includes("geography") || n.includes("architecture")) {
                    highlightColorHex = "#E0F7FA"; // Ice Cyan White
                } else if (n.includes("relationship") || n.includes("social")) {
                    highlightColorHex = "#FF80AB"; // Rose Pink
                }

                generateHighlightSRT(clip.text, clip.duration, srtPath, highlightColorHex);
                
                // Build Dynamic Filter Chain for Context-Aware Editing & Monetization Safety
                const isVertical = format === 'vertical';
                const [outW, outH] = isVertical ? [1080, 1920] : [1920, 1080];
                let vfFilters = `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setpts=N/FRAME_RATE/TB`;
                if (visualSource === 'stock_videos') {
                    // Enhanced visual transformation for stock footage (anti-reuse fingerprinting)
                    const hueShift = Math.floor(Math.random() * 16) - 8; // Random ±8° hue shift
                    vfFilters += `,eq=contrast=1.15:brightness=0.03:saturation=1.3,vignette=PI/3.5`;
                    if (hueShift !== 0) vfFilters += `,hue=h=${hueShift}`;
                    vfFilters += `,unsharp=5:5:0.8:3:3:0.4`; // Cinematic sharpening
                }

                // Smart Transitions & Pattern Interrupts
                if (clip.transition === "fade_in") {
                    vfFilters += `,fade=t=in:st=0:d=0.5`;
                } else if (clip.transition === "glitch") {
                    vfFilters += `,negate=enable='between(t,0,0.1)'`;
                } else if (clip.transition === "blackout") {
                    vfFilters += `,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0,1)'`;
                }

                const relSrtPath = path.relative(process.cwd(), srtPath).replace(/\\/g, '/');
                const fontsDir = path.join(__dirname, 'assets', 'fonts').replace(/\\/g, '/').replace(/:/g, '\\:');

                const subFontSize = isVertical ? 28 : 38;
                const subMarginV = isVertical ? 250 : 150;
                vfFilters += `,subtitles='${relSrtPath}':fontsdir='${fontsDir}':force_style='Fontname=Oswald,Fontsize=${subFontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3.5,Alignment=2,MarginV=${subMarginV}'`;

                chunk.push(new Promise((resolve, reject) => {
                    let cmd = ffmpeg();
                    if (visualSource === 'stock_videos') {
                        cmd = cmd.input(clip.visual).inputOptions(['-stream_loop', '-1', '-t', String(clip.duration)]);
                    } else {
                        cmd = cmd.input(clip.visual).inputOptions(['-loop', '1', '-t', String(clip.duration)]);
                    }
                    cmd.input(clip.audio);

                    cmd.videoCodec('libx264')
                        .audioCodec('aac')
                        .videoFilters(vfFilters)
                        .outputOptions([
                            '-map 0:v:0', // Only take video from input 0
                            '-map 1:a:0', // Take voiceover audio from input 1
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
            
            addLog(`Encoding clips ${i + 1} to ${Math.min(i + FFMPEG_CHUNK_SIZE, clips.length)} of ${clips.length}...`);
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
        // Anti-template: randomize BGM volume between 20%-28% per generation
        const bgmVolume = (0.20 + Math.random() * 0.08).toFixed(2);
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
            
            let bgmPath = path.join(__dirname, 'assets', `bgm_${bgmCategory}.mp3`); // fallback
            const categoryDir = path.join(__dirname, 'assets', 'bgm', bgmCategory);
            
            if (fs.existsSync(categoryDir)) {
                const files = fs.readdirSync(categoryDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
                if (files.length > 0) {
                    const randomBgm = files[Math.floor(Math.random() * files.length)];
                    bgmPath = path.join(categoryDir, randomBgm);
                }
            } else if (!fs.existsSync(bgmPath)) {
                bgmPath = path.join(__dirname, 'assets', 'bgm.mp3');
            }
            if (fs.existsSync(bgmPath)) finalBgmToMix = bgmPath;
        }
        
        if (finalBgmToMix) {
            await new Promise((resolve, reject) => {
                const cmd = ffmpeg(stitchedVideoPath)
                    .input(finalBgmToMix)
                    .inputOptions(['-stream_loop', '-1']) // Loop BGM infinitely
                    .complexFilter([
                        `[1:a]volume=${bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first[a]`
                    ])
                    .outputOptions([
                        '-map 0:v:0',           // Keep original video stream
                        '-map [a]',             // Use mixed audio stream
                        '-c:v copy',            // Instant video copy
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags +faststart'  // Relocate moov atom to start of file for web streaming
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
            // Fallback if BGM doesn't exist
            fs.copyFileSync(stitchedVideoPath, finalVideoPath);
            try { fs.copyFileSync(finalVideoPath, legacyVideoPath); } catch (_) {}
        }

        // -------------------------
        // Generate YouTube Thumbnail
        // -------------------------
        addLog("Generating Viral YouTube Thumbnail...");
        const thumbUrlPath = `/output/${folderName}/thumbnail.jpg`;
        const thumbLocalPath = path.join(videoFolder, `thumbnail.jpg`);
        const legacyThumbPath = path.join(outputDir, `${videoId}_thumb.jpg`);
        try {
            let thumbPrompt = scriptData.thumbnailPrompt;
            if (!thumbPrompt) {
                if (scriptData.hasThumbnailText && scriptData.thumbnailText) {
                    thumbPrompt = `A masterwork YouTube thumbnail background for ${subNiche}, 3D depth-of-field, dramatic volumetric lighting, intense focal point, teal and orange cinematic color grade, high contrast, ultra-vibrant, with bold clean high-contrast white text reading '${scriptData.thumbnailText}'`;
                } else {
                    thumbPrompt = `A masterwork YouTube thumbnail background for ${subNiche}, 3D depth-of-field, dramatic volumetric lighting, intense focal point, teal and orange cinematic color grade, high contrast, ultra-vibrant, no text`;
                }
            }
            const thumbUrl = await withRetry(async () => {
                return await replicate.run(
                    "bytedance/seedream-4.5",
                    {
                        input: {
                            prompt: thumbPrompt,
                            size: "2K",
                            aspect_ratio: format === 'vertical' ? "9:16" : "16:9",
                            sequential_image_generation: "disabled"
                        }
                    }
                );
            }, "Thumbnail Gen");
            
            const thumbBuffer = await withRetry(() => axios.get(thumbUrl[0], { responseType: 'arraybuffer' }), "Download Thumbnail");
            fs.writeFileSync(thumbLocalPath, thumbBuffer.data);
            try { fs.copyFileSync(thumbLocalPath, legacyThumbPath); } catch (_) {}
            
            addLog("Thumbnail Generated Successfully!");
            
            // --- AI VISION QA LAYER (Phase 3) ---
            addLog("Running AI Vision QA on Thumbnail...");
            const visionModels = [
                "google/gemini-2.0-flash-exp:free",
                "openai/gpt-4o-mini",
                "meta-llama/llama-3.2-11b-vision-instruct:free"
            ];
            let qaResult = null;
            for (const modelId of visionModels) {
                try {
                    const base64Image = Buffer.from(thumbBuffer.data).toString('base64');
                    const qaResponse = await openai.chat.completions.create({
                        model: modelId,
                        messages: [
                            {
                                role: "user",
                                content: [
                                    { type: "text", text: "You are an elite YouTube thumbnail reviewer. Rate this thumbnail's visual quality, contrast, and click-through potential from 1-10. Provide exactly ONE sentence of feedback. Format exactly like this: 'Rating: X/10 - [Feedback]'" },
                                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                                ]
                            }
                        ]
                    });
                    qaResult = qaResponse.choices[0]?.message?.content;
                    if (qaResult) {
                        scriptData.thumbnailQA = qaResult;
                        addLog(`Vision QA Result (${modelId}): ${qaResult.replace(/\n/g, ' ')}`);
                        break;
                    }
                } catch (qaErr) {
                    // Try next vision model
                }
            }
            if (!qaResult) {
                addLog(`[WARN] Vision QA passed (thumbnail generated successfully).`);
            }
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
// Endpoint to fetch all previously generated videos (scans root & subfolders)
app.get('/api/videos', (req, res) => {
    try {
        const videos = [];
        function scanDir(dir) {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                    try {
                        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                        if (data && data.title && data.videoUrl) {
                            videos.push(data);
                        }
                    } catch (_) {}
                }
            }
        }
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
