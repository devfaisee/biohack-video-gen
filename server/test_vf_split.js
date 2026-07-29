const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function testVfSplit() {
    console.log("=================================================");
    console.log("TESTING FFmpeg -vf TWO-ELEMENT ARRAY SPLIT");
    console.log("=================================================");

    const pexelsKey = process.env.PEXELS_API_KEY || "vGnr3wLcpfgybFLKKXjcPcqMOPc4MM89JJA1j2WpGfrKNh29XTHVualY";
    const testDir = path.join(__dirname, 'test_output');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);

    const stockVideoPath = path.join(testDir, 'raw_stock.mp4');
    const audioPath = path.join(testDir, 'narration.wav');
    const outputClipPath = path.join(__dirname, 'output', 'TEST_VF_SPLIT_SUCCESS.mp4');
    const outputFramePath = path.join(__dirname, 'output', 'TEST_VF_SPLIT_FRAME.jpg');

    if (!fs.existsSync(stockVideoPath)) {
        const res = await axios.get("https://api.pexels.com/videos/search?query=yacht&per_page=1&orientation=landscape", {
            headers: { Authorization: pexelsKey }
        });
        const videoUrl = res.data.videos[0].video_files.find(f => f.quality === 'hd' || f.width >= 1280).link;
        const videoBuffer = await axios.get(videoUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(stockVideoPath, videoBuffer.data);
    }

    if (!fs.existsSync(audioPath)) {
        execSync(`ffmpeg -f lavfi -i "sine=frequency=440:duration=4" "${audioPath}" -y`, { stdio: 'ignore' });
    }

    const fontFile = path.join(__dirname, 'assets', 'fonts', 'Oswald-Bold.ttf');
    const escapedFont = fontFile.replace(/\\/g, '/').replace(/:/g, '\\:');

    // Test text with apostrophe: "EVERYTHING YOUVE BEEN TOLD ABOUT BILLIONAIRES IS A LIE"
    const textChunk = "EVERYTHING YOUVE BEEN TOLD ABOUT BILLIONAIRES IS A LIE";
    const dt = `drawtext=fontfile='${escapedFont}':text='${textChunk}':fontsize=38:fontcolor=green:borderw=3:bordercolor=black:box=1:boxcolor=black@0.75:boxborderw=12:x=(w-text_w)/2:y=h-140:enable='between(t,0,4.0)'`;
    const vfFilters = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setpts=N/FRAME_RATE/TB,eq=contrast=1.12:brightness=0.02:saturation=1.2,vignette=PI/4,negate=enable='between(t,0,0.1)',${dt}`;

    // Notice -vf and vfFilters passed as separate CLI arguments!
    const cmd = `ffmpeg -stream_loop -1 -t 4 -i "${stockVideoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -shortest -r 30 -ar 44100 -pix_fmt yuv420p -vf "${vfFilters}" -preset veryfast "${outputClipPath}" -y`;

    console.log("[STEP 1] Executing FFmpeg with split -vf option...");
    execSync(cmd, { stdio: 'inherit' });

    console.log("[STEP 2] Extracting frame...");
    execSync(`ffmpeg -i "${outputClipPath}" -ss 00:00:01 -vframes 1 "${outputFramePath}" -y`, { stdio: 'ignore' });

    if (fs.existsSync(outputClipPath) && fs.existsSync(outputFramePath)) {
        console.log("=================================================");
        console.log("TEST SUCCESSFUL! NO FFMPEG SPLITTING ERROR!");
        console.log(`[OUTPUT VIDEO]: ${outputClipPath}`);
        console.log(`[OUTPUT FRAME]: ${outputFramePath}`);
        console.log("=================================================");
    }
}

testVfSplit();
