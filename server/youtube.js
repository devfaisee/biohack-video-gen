const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CHANNELS_FILE = path.join(__dirname, 'channels.json');

function getChannelsDb() {
    if (!fs.existsSync(CHANNELS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveChannelsDb(db) {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(db, null, 2));
}

function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:5000/api/youtube/callback'
    );
}

function getAuthUrl() {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', 
        scope: [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly'
        ]
    });
}

async function handleCallback(code) {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const res = await youtube.channels.list({ part: 'snippet', mine: true });
    if (!res.data.items || res.data.items.length === 0) {
        throw new Error('No YouTube channel found for this account.');
    }
    
    const channel = res.data.items[0];
    const channelId = channel.id;
    const channelName = channel.snippet.title;
    const channelAvatar = channel.snippet.thumbnails?.default?.url || '';

    const db = getChannelsDb();
    const existingIdx = db.findIndex(c => c.channelId === channelId);
    
    const channelData = {
        channelId,
        channelName,
        channelAvatar,
        tokens,
        mappedNiches: existingIdx !== -1 ? db[existingIdx].mappedNiches : []
    };

    if (existingIdx !== -1) {
        db[existingIdx] = channelData;
    } else {
        db.push(channelData);
    }
    
    saveChannelsDb(db);
    return channelData;
}

async function uploadToYouTube(channelId, videoPath, thumbPath, metadata) {
    const db = getChannelsDb();
    const channelData = db.find(c => c.channelId === channelId);
    if (!channelData) throw new Error(`Channel ${channelId} not found in DB.`);

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(channelData.tokens);
    
    oauth2Client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
            channelData.tokens.refresh_token = tokens.refresh_token;
        }
        channelData.tokens.access_token = tokens.access_token;
        if (tokens.expiry_date) channelData.tokens.expiry_date = tokens.expiry_date;
        saveChannelsDb(db);
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    console.log(`[YOUTUBE] Uploading video to ${channelData.channelName}...`);
    
    const videoRes = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: metadata.title.substring(0, 100),
                description: metadata.description.substring(0, 5000),
                tags: metadata.tags ? metadata.tags.slice(0, 500).slice(0, 15) : [],
                categoryId: '27'
            },
            status: {
                privacyStatus: 'private', 
                selfDeclaredMadeForKids: false
            }
        },
        media: {
            body: fs.createReadStream(videoPath)
        }
    });

    const videoId = videoRes.data.id;
    console.log(`[YOUTUBE] Video uploaded. ID: ${videoId}`);

    if (thumbPath && fs.existsSync(thumbPath)) {
        console.log(`[YOUTUBE] Uploading thumbnail...`);
        try {
            await youtube.thumbnails.set({
                videoId: videoId,
                media: {
                    body: fs.createReadStream(thumbPath)
                }
            });
            console.log(`[YOUTUBE] Thumbnail set.`);
        } catch (err) {
            console.error(`[YOUTUBE] Failed to set thumbnail:`, err.message);
        }
    }

    return videoId;
}

module.exports = { getChannelsDb, saveChannelsDb, getAuthUrl, handleCallback, uploadToYouTube };
