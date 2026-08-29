const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const db = require('./db');

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

    const existing = await db.query('SELECT mapped_niches FROM channels WHERE channel_id = $1', [channelId]);
    let mappedNiches = '[]';
    if (existing.rows.length > 0) {
        mappedNiches = JSON.stringify(existing.rows[0].mapped_niches);
    }
    
    await db.query(`
        INSERT INTO channels (channel_id, channel_name, avatar, tokens, mapped_niches)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (channel_id) DO UPDATE 
        SET channel_name = EXCLUDED.channel_name, avatar = EXCLUDED.avatar, tokens = EXCLUDED.tokens
    `, [channelId, channelName, channelAvatar, JSON.stringify(tokens), mappedNiches]);

    return { channelId, channelName, channelAvatar };
}

async function uploadToYouTube(channelId, videoPath, thumbPath, metadata) {
    const res = await db.query('SELECT * FROM channels WHERE channel_id = $1', [channelId]);
    if (res.rows.length === 0) throw new Error(`Channel ${channelId} not found in DB.`);
    
    const channelData = res.rows[0];
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(channelData.tokens);
    
    oauth2Client.on('tokens', async (tokens) => {
        const currentTokens = channelData.tokens;
        if (tokens.refresh_token) currentTokens.refresh_token = tokens.refresh_token;
        currentTokens.access_token = tokens.access_token;
        if (tokens.expiry_date) currentTokens.expiry_date = tokens.expiry_date;
        await db.query('UPDATE channels SET tokens = $1 WHERE channel_id = $2', [JSON.stringify(currentTokens), channelId]);
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    console.log(`[YOUTUBE] Uploading video to ${channelData.channel_name}...`);
    
    const statusObj = {
        privacyStatus: 'private', 
        selfDeclaredMadeForKids: false
    };
    
    if (metadata.publishAt) {
        statusObj.publishAt = metadata.publishAt;
    }

    const videoRes = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: metadata.title.substring(0, 100),
                description: metadata.description.substring(0, 5000),
                tags: metadata.tags ? metadata.tags.slice(0, 500).slice(0, 15) : [],
                categoryId: '27'
            },
            status: statusObj
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

module.exports = { getAuthUrl, handleCallback, uploadToYouTube };
