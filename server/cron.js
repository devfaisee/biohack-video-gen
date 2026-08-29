const cron = require('node-cron');
const db = require('./db');
const { google } = require('googleapis');

// Fetch analytics at 3 AM every day
cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Starting YouTube Analytics Sync...');
    await syncAnalytics();
});

async function syncAnalytics() {
    if (!process.env.DATABASE_URL) return;

    try {
        const videosRes = await db.query("SELECT youtube_id, niche, published_at FROM videos WHERE status = 'uploaded' AND youtube_id IS NOT NULL");
        if (videosRes.rows.length === 0) return;

        const channelsRes = await db.query("SELECT channel_id, tokens, mapped_niches FROM channels");
        const channels = channelsRes.rows;

        for (const channel of channels) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.YOUTUBE_CLIENT_ID,
                process.env.YOUTUBE_CLIENT_SECRET,
                process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:5000/api/youtube/callback'
            );
            oauth2Client.setCredentials(channel.tokens);
            
            // Refresh logic handled natively by googleapis if refresh_token is present, but we should listen to tokens event just in case
            oauth2Client.on('tokens', async (tokens) => {
                const currentTokens = channel.tokens;
                if (tokens.refresh_token) currentTokens.refresh_token = tokens.refresh_token;
                currentTokens.access_token = tokens.access_token;
                if (tokens.expiry_date) currentTokens.expiry_date = tokens.expiry_date;
                await db.query('UPDATE channels SET tokens = $1 WHERE channel_id = $2', [JSON.stringify(currentTokens), channel.channel_id]);
            });
            
            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
            
            const channelNiches = channel.mapped_niches || [];
            const channelVideos = videosRes.rows.filter(v => channelNiches.includes(v.niche));
            
            if (channelVideos.length === 0) continue;
            
            for (let i = 0; i < channelVideos.length; i += 50) {
                const chunk = channelVideos.slice(i, i + 50);
                const ids = chunk.map(v => v.youtube_id).join(',');
                
                try {
                    const statsRes = await youtube.videos.list({
                        part: 'statistics',
                        id: ids
                    });
                    
                    for (const item of statsRes.data.items) {
                        const stats = item.statistics;
                        const views = parseInt(stats.viewCount || 0);
                        const likes = parseInt(stats.likeCount || 0);
                        const comments = parseInt(stats.commentCount || 0);
                        
                        // We use engagement rate (likes/views) as a proxy for retention in the basic Data API
                        const retentionScore = views > 0 ? (likes / views) * 100 : 0; 
                        
                        await db.query(`
                            INSERT INTO analytics (youtube_id, views, likes, comments, retention)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (youtube_id) DO UPDATE 
                            SET views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments, retention = EXCLUDED.retention, updated_at = NOW()
                        `, [item.id, views, likes, comments, retentionScore]);
                    }
                } catch (err) {
                    console.error(`[CRON] Failed to fetch stats for channel ${channel.channel_id}:`, err.message);
                }
            }
        }
        console.log('[CRON] Analytics Sync Complete.');
    } catch (e) {
        console.error('[CRON] Sync Error:', e);
    }
}

module.exports = { syncAnalytics };
