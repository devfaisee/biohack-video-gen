const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');
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

app.post('/api/generate', async (req, res) => {
    try {
        const { durationMinutes = 1 } = req.body;
        console.log(`Starting generation for ${durationMinutes} minutes...`);
        
        const wordCount = durationMinutes * 130; // approx words per minute

        const systemPrompt = `You are an expert scriptwriter specializing in the Psychology, Neuroscience, and Biohacking niche. 
Your goal is to write a compelling script for a horizontal YouTube video.
The script should be approximately ${wordCount} words total.
Output pure JSON with the following structure:
{
  "title": "A highly clickable YouTube title",
  "description": "YouTube video description",
  "tags": ["tag1", "tag2"],
  "segments": [
    {
      "narration": "The exact words the voiceover will say. Around 2-3 sentences.",
      "imagePrompt": "A highly detailed visual prompt for an AI image generator (flux-schnell). Describe the scene, lighting, style (Dark Cinematic Tech, neon, sleek)."
    }
  ]
}
Ensure the JSON is strictly valid and contains no markdown formatting around it.`;

        console.log("Generating script via Grok 4.5...");
        const chatCompletion = await openai.chat.completions.create({
            model: "x-ai/grok-2-1212", // using grok-2 as standard on openrouter, or grok-4.5 if available
            messages: [{ role: "user", content: systemPrompt }]
        });

        let jsonStr = chatCompletion.choices[0].message.content;
        // Clean up markdown if present
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json\n/, '').replace(/\n```$/, '');
        }

        const scriptData = JSON.parse(jsonStr);
        console.log("Script generated successfully. Total segments:", scriptData.segments.length);

        const videoId = crypto.randomUUID();
        const projectDir = path.join(tmpDir, videoId);
        fs.mkdirSync(projectDir);

        const clips = [];

        // Generate Assets
        for (let i = 0; i < scriptData.segments.length; i++) {
            const segment = scriptData.segments[i];
            console.log(`Generating assets for segment ${i + 1}/${scriptData.segments.length}`);

            // 1. Generate Image
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
            
            // Download image
            const imgBuffer = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imgPath, imgBuffer.data);

            // 2. Generate Audio
            // Using OuteTTS or XTTS on replicate as TTS (Since Gemini TTS via Replicate isn't a standard endpoint for raw audio yet, using a reliable one)
            const audioRes = await replicate.run(
                "lucataco/xtts-v2:684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e",
                {
                    input: {
                        text: segment.narration,
                        speaker: "https://replicate.delivery/pbxt/Jt79w0xsT64R1JsiJ0IQ5cVK9jjKlWXOcApvqh0rZncuVZQk/speaker.wav", // Sample male voice
                        language: "en"
                    }
                }
            );
            
            const audioUrl = audioRes;
            const audioPath = path.join(projectDir, `audio_${i}.wav`);
            const audioBuffer = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(audioPath, audioBuffer.data);

            clips.push({ image: imgPath, audio: audioPath, output: path.join(projectDir, `clip_${i}.mp4`) });
        }

        console.log("Assets generated. Stitching video with FFmpeg...");

        // Generate individual clips
        for (let i = 0; i < clips.length; i++) {
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

        // Concat clips
        const listPath = path.join(projectDir, 'list.txt');
        const listContent = clips.map(c => \`file '\${c.output}'\`).join('\n');
        fs.writeFileSync(listPath, listContent);

        const finalVideoPath = path.join(outputDir, \`\${videoId}.mp4\`);

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions('-c copy')
                .save(finalVideoPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log("Video generated successfully:", finalVideoPath);

        res.json({
            success: true,
            title: scriptData.title,
            description: scriptData.description,
            tags: scriptData.tags,
            videoUrl: \`/output/\${videoId}.mp4\`
        });

    } catch (error) {
        console.error("Error generating video:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use('/output', express.static(outputDir));

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(\`Server running on port \${port}\`);
});
