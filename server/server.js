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
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
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

app.post('/api/generate', async (req, res) => {
    try {
        currentLogs = []; // Reset logs for new generation
        const { durationMinutes = 1 } = req.body;
        addLog(`Starting generation for ${durationMinutes} minutes...`);
        
        const wordCount = durationMinutes * 130; 

        const systemPrompt = `You are an elite YouTube scriptwriter and retention expert specializing in the Psychology, Neuroscience, and Biohacking niche. 
Your goal is to write a highly viral, retention-optimized script for a horizontal YouTube video.
The script should be approximately ${wordCount} words total.
CRITICAL RULES FOR FAST-PACED RETENTION:
1. The first 5 seconds MUST be an aggressive, curiosity-inducing hook.
2. Visuals must change RAPIDLY. Provide a new visual prompt for EVERY SINGLE SENTENCE or every 3-5 seconds of speaking. Do NOT group multiple sentences into one segment.
3. The tone should be punchy, mysterious, and highly engaging.

Output pure JSON with the following structure:
{
  "title": "A highly clickable, viral YouTube title",
  "description": "YouTube video description optimized for SEO",
  "tags": ["biohacking", "neuroscience", "viral"],
  "segments": [
    {
      "narration": "One single punchy sentence.",
      "imagePrompt": "A highly detailed visual prompt for an AI image generator (flux-schnell). Describe the scene, lighting, style (Dark Cinematic Tech, neon, sleek). Must be perfectly relevant to the sentence."
    }
  ]
}
Ensure the JSON is strictly valid and contains no markdown formatting around it.`;

        addLog("Generating script via Grok 4.5 (OpenRouter)...");
        const chatCompletion = await openai.chat.completions.create({
            model: "x-ai/grok-4.5", 
            messages: [{ role: "user", content: systemPrompt }]
        });

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

        // Generate Assets
        for (let i = 0; i < scriptData.segments.length; i++) {
            const segment = scriptData.segments[i];
            addLog(`[Segment ${i + 1}/${scriptData.segments.length}] Generating assets...`);

            // 1. Generate Image
            addLog(`[Segment ${i + 1}] Requesting image from Flux-Schnell...`);
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
            const imageUrl = imgRes[0];
            const imgPath = path.join(projectDir, `img_${i}.webp`);
            addLog(`[Segment ${i + 1}] Image downloaded.`);
            
            const imgBuffer = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imgPath, imgBuffer.data);

            // 2. Generate Audio
            addLog(`[Segment ${i + 1}] Requesting voiceover from XTTS...`);
            const audioRes = await replicate.run(
                "lucataco/xtts-v2:684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e",
                {
                    input: {
                        text: segment.narration,
                        speaker: "https://replicate.delivery/pbxt/Jt79w0xsT64R1JsiJ0IQ5cVK9jjKlWXOcApvqh0rZncuVZQk/speaker.wav", 
                        language: "en"
                    }
                }
            );
            
            const audioUrl = audioRes;
            const audioPath = path.join(projectDir, `audio_${i}.wav`);
            const audioBuffer = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(audioPath, audioBuffer.data);
            addLog(`[Segment ${i + 1}] Voiceover downloaded.`);

            clips.push({ image: imgPath, audio: audioPath, output: path.join(projectDir, `clip_${i}.mp4`) });
        }

        addLog("Assets generated. Stitching video with FFmpeg...");

        // Generate individual clips
        for (let i = 0; i < clips.length; i++) {
            addLog(`Encoding clip ${i + 1}/${clips.length}...`);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(clips[i].image)
                    .loop()
                    .input(clips[i].audio)
                    .outputOptions([
                        '-c:v libx264',
                        '-tune stillimage',
                        '-c:a aac',
                        '-b:a 192k',
                        '-pix_fmt yuv420p',
                        '-shortest'
                    ])
                    .save(clips[i].output)
                    .on('end', resolve)
                    .on('error', reject);
            });
        }

        addLog("Concatenating all clips into final masterpiece...");
        const listPath = path.join(projectDir, 'list.txt');
        const listContent = clips.map(c => `file '${c.output}'`).join('\n');
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

        addLog(`Video generated successfully: ${videoId}.mp4`);

        res.json({
            success: true,
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: `/output/${videoId}.mp4`
        });

    } catch (error) {
        addLog(`CRITICAL ERROR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use('/output', express.static(outputDir));

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
