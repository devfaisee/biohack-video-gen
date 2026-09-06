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

// Auto-retry failed or pending YouTube uploads every 4 hours
cron.schedule('0 */4 * * *', async () => {
    console.log('[CRON] Starting Upload Recovery Sweep...');
    await retryPendingUploads();
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

    // Run upload recovery sweep before queuing new videos
    try { await retryPendingUploads(); } catch (recErr) { console.error('[AUTO-GEN] Pre-run recovery error:', recErr.message); }

    try {
        const channelsRes = await db.query("SELECT channel_id, channel_name, mapped_niches FROM channels");
        const channels = channelsRes.rows;

        // ═══════════════════════════════════════════════════════════════════
        // MASTER NICHE RULES ENGINE — Covers ALL 30 niches in niches.json
        // targetShortsRatio: What % of videos should be Shorts (0.0 = all Longs, 1.0 = all Shorts)
        // videosPerDay: How many videos to generate per day for this niche
        // ═══════════════════════════════════════════════════════════════════
        const nicheRules = {
            // ── TIER 1: HIGH CPM ($15-50+) ──
            "Finance":           { targetShortsRatio: 0.4, videosPerDay: 1 }, // Deep dives build trust
            "Business":          { targetShortsRatio: 0.5, videosPerDay: 1 }, // Balanced advice content
            "Real Estate":       { targetShortsRatio: 0.4, videosPerDay: 1 }, // High value, longer watch time
            "Rise & Fall":       { targetShortsRatio: 0.3, videosPerDay: 1 }, // Story-driven long-form

            // ── TIER 2: TECH, HEALTH & LIFESTYLE ($10-25) ──
            "Tech":              { targetShortsRatio: 0.5, videosPerDay: 1 }, // Balanced tech explainers
            "Health":            { targetShortsRatio: 0.6, videosPerDay: 1 }, // Quick tips dominate
            "Fitness":           { targetShortsRatio: 0.7, videosPerDay: 1 }, // Visual Shorts dominate
            "Luxury":            { targetShortsRatio: 0.7, videosPerDay: 1 }, // Aspirational Shorts

            // ── TIER 3: BROAD AUDIENCE ($5-15) ──
            "Nature":            { targetShortsRatio: 0.5, videosPerDay: 1 }, // Beautiful Shorts + documentaries
            "Ocean":             { targetShortsRatio: 0.5, videosPerDay: 1 }, // Deep sea mysteries
            "Food":              { targetShortsRatio: 0.5, videosPerDay: 1 }, // Culinary history & facts
            "Geography":         { targetShortsRatio: 0.5, videosPerDay: 1 }, // Visual spectacle both formats
            "Survival":          { targetShortsRatio: 0.4, videosPerDay: 1 }, // Story-driven content
            "Money Psychology":  { targetShortsRatio: 0.6, videosPerDay: 1 }, // Quick tips + deep psychology
            "Relationship":      { targetShortsRatio: 0.6, videosPerDay: 1 }, // Balanced emotional content
            "Self-Improvement":  { targetShortsRatio: 0.6, videosPerDay: 1 }, // Productivity hacks & deep dives

            // ── TIER 4: EVERGREEN TITANS (Affiliate Heavy) ──
            "Travel":            { targetShortsRatio: 0.5, videosPerDay: 1 }, // Beautiful visual lists
            "Pets":              { targetShortsRatio: 0.7, videosPerDay: 1 }, // Cute/helpful Shorts dominate
            "Interior Design":   { targetShortsRatio: 0.6, videosPerDay: 1 }, // Aesthetic visual styling
            
            // ── FALLBACK ──
            "default":           { targetShortsRatio: 0.5, videosPerDay: 1 }
        };

        for (const channel of channels) {
            const niches = channel.mapped_niches || [];
            if (niches.length === 0) continue;

            const randomNiche = niches[Math.floor(Math.random() * niches.length)];
            
            // ── STOCK-SAFE GATE ──
            // Auto-mode always uses stock_videos. If the mapped niche isn't stock-safe, skip it.
            let nichesData = {};
            try {
                // Clear require cache so edits to niches.json take effect without restart
                delete require.cache[require.resolve('../client/src/niches.json')];
                nichesData = require('../client/src/niches.json');
            } catch (e) {
                console.log(`[AUTO-GEN] Could not load niches.json`);
            }
            
            let nicheEntry = null;
            let nicheKey = null;
            for (const [name, data] of Object.entries(nichesData)) {
                if (name.startsWith('_')) continue;
                if (name === randomNiche || randomNiche.includes(name) || name.includes(randomNiche)) {
                    nicheEntry = data;
                    nicheKey = name;
                    break;
                }
            }
            
            // Check stock safety — auto-mode is ALWAYS stock footage
            const isStockSafe = nicheEntry && typeof nicheEntry === 'object' && !Array.isArray(nicheEntry) 
                ? nicheEntry._stockSafe 
                : true; // legacy flat arrays assumed safe
            
            if (!isStockSafe) {
                console.log(`[AUTO-GEN] ⚠️ Skipping "${randomNiche}" for channel ${channel.channel_name} — NOT stock-safe (requires AI images). Auto-mode only runs stock-safe niches.`);
                continue;
            }

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

                // ── DE-DUPLICATION ENGINE ──
                // Query the database for all sub-niches used in the last 14 days for this niche.
                // Exclude them from the pool so we never repeat a topic within 2 weeks.
                let selectedSubNiche = 'General';
                try {
                    // Get the sub-niche list from new format
                    let subNicheList = null;
                    if (nicheEntry) {
                        subNicheList = Array.isArray(nicheEntry) ? nicheEntry : (nicheEntry.subNiches || null);
                    }
                    
                    if (subNicheList && subNicheList.length > 0) {
                        // Query recently used sub-niches (last 14 days)
                        const recentRes = await db.query(
                            "SELECT DISTINCT script->>'subNiche' as sub FROM videos WHERE niche = $1 AND created_at > NOW() - INTERVAL '14 days' AND script->>'subNiche' IS NOT NULL",
                            [randomNiche]
                        );
                        const recentlyUsed = new Set(recentRes.rows.map(r => r.sub));
                        
                        // Filter out recently used sub-niches
                        const available = subNicheList.filter(s => !recentlyUsed.has(s));
                        
                        if (available.length > 0) {
                            selectedSubNiche = available[Math.floor(Math.random() * available.length)];
                            console.log(`[AUTO-GEN] De-dup: ${recentlyUsed.size} sub-niches used in last 14d, ${available.length} still available. Picked: "${selectedSubNiche}"`);
                        } else {
                            // All sub-niches exhausted in 14 days — reset and pick any (this means amazing content coverage!)
                            selectedSubNiche = subNicheList[Math.floor(Math.random() * subNicheList.length)];
                            console.log(`[AUTO-GEN] De-dup: All ${subNicheList.length} sub-niches used in last 14d! Full cycle complete. Picking fresh: "${selectedSubNiche}"`);
                        }
                    }
                    console.log(`[AUTO-GEN] Selected sub-niche: "${selectedSubNiche}" from "${randomNiche}"`);
                } catch (e) {
                    console.log(`[AUTO-GEN] De-dup query failed, falling back to random:`, e.message);
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
                        autoSchedule: true,
                        channelId: channel.channel_id
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

async function retryPendingUploads() {
    if (!process.env.DATABASE_URL) return;

    try {
        const pendingRes = await db.query(`
            SELECT id, title, description, tags, niche, published_at, script
            FROM videos 
            WHERE status = 'generated' AND (youtube_id IS NULL OR youtube_id = '') AND created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at ASC
            LIMIT 3
        `);
        if (pendingRes.rows.length === 0) return;

        console.log(`[UPLOAD-RETRY] Found ${pendingRes.rows.length} pending video(s) to recover and upload...`);
        const fs = require('fs');
        const path = require('path');
        const youtube = require('./youtube');
        const outputDir = path.join(__dirname, 'output');

        const channelsRes = await db.query("SELECT channel_id, mapped_niches FROM channels");
        const channels = channelsRes.rows;

        for (const video of pendingRes.rows) {
            const matchedChannel = channels.find(c => c.mapped_niches && c.mapped_niches.includes(video.niche));
            if (!matchedChannel) {
                console.log(`[UPLOAD-RETRY] No channel mapped for niche '${video.niche}'. Skipping video ${video.id}.`);
                continue;
            }

            let targetVideoPath = null;
            let targetThumbPath = null;

            // Check if legacy flat file exists: output/{id}.mp4
            const flatPath = path.join(outputDir, `${video.id}.mp4`);
            if (fs.existsSync(flatPath)) {
                targetVideoPath = flatPath;
                const flatThumb = path.join(outputDir, `${video.id}_thumb.jpg`);
                if (fs.existsSync(flatThumb)) targetThumbPath = flatThumb;
            } else if (fs.existsSync(outputDir)) {
                // Check folder-based structure: output/{date}_{slug}_{shortId}/video.mp4
                const shortId = video.id.substring(0, 8);
                const entries = fs.readdirSync(outputDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && entry.name.includes(shortId)) {
                        const candidate = path.join(outputDir, entry.name, 'video.mp4');
                        if (fs.existsSync(candidate)) {
                            targetVideoPath = candidate;
                            const thumbCandidate = path.join(outputDir, entry.name, 'thumbnail.jpg');
                            if (fs.existsSync(thumbCandidate)) targetThumbPath = thumbCandidate;
                            break;
                        }
                    }
                }
            }

            if (!targetVideoPath) {
                console.log(`[UPLOAD-RETRY] Video file for ID ${video.id} not found on disk. Marking unrecoverable.`);
                await db.query("UPDATE videos SET status = 'file_missing' WHERE id = $1", [video.id]);
                continue;
            }

            console.log(`[UPLOAD-RETRY] Retrying upload for '${video.title}' to channel ${matchedChannel.channel_id}...`);
            try {
                let tags = [];
                if (Array.isArray(video.tags)) tags = video.tags;
                else if (typeof video.tags === 'string') {
                    try { tags = JSON.parse(video.tags); } catch (_) { tags = [video.tags]; }
                }

                const ytVideoId = await youtube.uploadToYouTube(
                    matchedChannel.channel_id,
                    targetVideoPath,
                    targetThumbPath,
                    {
                        title: video.title,
                        description: video.description,
                        tags: tags,
                        mainNiche: video.niche,
                        publishAt: video.published_at ? new Date(video.published_at).toISOString() : null
                    }
                );

                if (ytVideoId) {
                    await db.query("UPDATE videos SET youtube_id = $1, status = 'uploaded' WHERE id = $2", [ytVideoId, video.id]);
                    console.log(`[UPLOAD-RETRY] Successfully uploaded! YouTube ID: ${ytVideoId}`);
                }
            } catch (retryErr) {
                console.error(`[UPLOAD-RETRY] Retry failed for video ${video.id}:`, retryErr.message);
            }
        }
    } catch (err) {
        console.error('[UPLOAD-RETRY] Error:', err.message);
    }
}

module.exports = { syncAnalytics, autoGenerateVideos, retryPendingUploads };
