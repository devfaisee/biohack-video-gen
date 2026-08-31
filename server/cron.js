const cron = require('node-cron');
const db = require('./db');
const { google } = require('googleapis');
const axios = require('axios');

// Fetch analytics at 3 AM every day
cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Starting YouTube Analytics Sync...');
    await syncAnalytics();
});

// Auto-Generate videos for all mapped channels at 5 AM every day
cron.schedule('0 5 * * *', async () => {
    console.log('[CRON] Starting Daily Auto-Generation...');
    await autoGenerateVideos();
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

async function autoGenerateVideos() {
    if (!process.env.DATABASE_URL) return;

    try {
        const channelsRes = await db.query("SELECT channel_id, channel_name, mapped_niches FROM channels");
        const channels = channelsRes.rows;

        // Advanced Niche Configurations
        const nicheRules = {
            "Science": { targetShortsRatio: 0.5, videosPerDay: 1 },
            "Tech": { targetShortsRatio: 0.5, videosPerDay: 1 },
            "Gaming": { targetShortsRatio: 0.8, videosPerDay: 2 }, // Fast paced, needs high volume shorts
            "Finance": { targetShortsRatio: 0.4, videosPerDay: 1 }, // Deep dives perform better
            "True Crime": { targetShortsRatio: 0.2, videosPerDay: 1 }, // Heavily long-form
            "Motivation": { targetShortsRatio: 0.9, videosPerDay: 3 }, // Extremely high volume shorts
            "Comedy": { targetShortsRatio: 0.8, videosPerDay: 1 },
            "History": { targetShortsRatio: 0.3, videosPerDay: 1 },
            "default": { targetShortsRatio: 0.5, videosPerDay: 1 }
        };

        for (const channel of channels) {
            const niches = channel.mapped_niches || [];
            if (niches.length === 0) continue;

            const randomNiche = niches[Math.floor(Math.random() * niches.length)];
            
            let rules = nicheRules["default"];
            for (const key of Object.keys(nicheRules)) {
                if (randomNiche.includes(key) || randomNiche === key) {
                    rules = nicheRules[key];
                    break;
                }
            }

            for (let v = 0; v < rules.videosPerDay; v++) {
                // Deterministic Balancing: Query the last 10 videos generated for this niche
                // Shorts have <= 6 segments, Longs have > 6 segments
                const pastVideos = await db.query(
                    "SELECT jsonb_array_length(script->'segments') as seg_count FROM videos WHERE niche = $1 AND script->'segments' IS NOT NULL ORDER BY created_at DESC LIMIT 10", 
                    [randomNiche]
                );
                
                let pastShorts = 0;
                let pastTotal = 0;
                for (const row of pastVideos.rows) {
                    pastTotal++;
                    if (row.seg_count <= 6) pastShorts++;
                }
                
                // Calculate current ratio, if we have too many shorts compared to target, force a long-form video.
                const currentShortsRatio = pastTotal > 0 ? (pastShorts / pastTotal) : 0;
                
                let format = 'vertical'; // default short
                if (currentShortsRatio > rules.targetShortsRatio) {
                    format = 'horizontal'; // force long-form to balance
                }

                const durationMinutes = format === 'vertical' ? 1 : 5;

                console.log(`[AUTO-GEN] Queuing ${format} video for channel ${channel.channel_name}, Niche: ${randomNiche} (Video ${v+1}/${rules.videosPerDay})`);

                // Load dynamic sub-niches from the master niches.json file
                let selectedSubNiche = 'General';
                try {
                    const nichesData = require('../client/src/niches.json');
                    const nicheObj = nichesData.find(n => n.name === randomNiche || randomNiche.includes(n.name));
                    if (nicheObj && nicheObj.subNiches && nicheObj.subNiches.length > 0) {
                        const randomIdx = Math.floor(Math.random() * nicheObj.subNiches.length);
                        selectedSubNiche = nicheObj.subNiches[randomIdx];
                    }
                } catch (e) {
                    console.log(`[AUTO-GEN] Could not load niches.json, defaulting to General`);
                }

                const port = process.env.PORT || 5000;
                try {
                    console.log(`[AUTO-GEN] Hitting local API: http://localhost:${port}/api/generate`);
                    const res = await axios.post(`http://localhost:${port}/api/generate`, {
                        durationMinutes,
                        format,
                        mainNiche: randomNiche,
                        subNiche: selectedSubNiche,
                        topic: '', 
                        visualSource: 'stock_videos', // CRITICAL: Forced to always use stock_videos, never AI images in auto-mode
                        autoSchedule: true 
                    });
                    console.log(`[AUTO-GEN] Queued successfully. Response:`, res.data);
                } catch (postErr) {
                    console.error(`[AUTO-GEN] Failed to queue video for ${channel.channel_name}:`, postErr.message);
                    if (postErr.response) {
                        console.error(`[AUTO-GEN] Response data:`, postErr.response.data);
                        // Save this failure to the database so we can see it externally!
                        try {
                            await db.query(
                                "INSERT INTO videos (youtube_id, title, niche, status, script) VALUES ($1, $2, $3, $4, $5)",
                                ["FAILED_AUTO", "Auto-Gen Failed", randomNiche, "failed", JSON.stringify(postErr.response.data)]
                            );
                        } catch(e) {}
                    }
                }
                
                // Robust scaling: Sleep for 60 seconds between queueing to prevent overwhelming the server memory and API quotas
                await new Promise(r => setTimeout(r, 60000));
            }
        }
    } catch (e) {
        console.error('[AUTO-GEN] Error:', e);
    }
}

module.exports = { syncAnalytics, autoGenerateVideos };
