const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/video_gen',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

async function initDB() {
  // If no DATABASE_URL, gracefully skip to allow local without pg setup (fallback logic in server will fail, but server starts)
  if (!process.env.DATABASE_URL && !process.env.LOCAL_PG) {
      console.log('[DB] No DATABASE_URL found. Skipping Postgres init.');
      return;
  }
  
  try {
    const client = await pool.connect();
    // 1. Channels Table (Replaces channels.json)
    await client.query(`
      CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        channel_name TEXT,
        avatar TEXT,
        tokens JSONB,
        mapped_niches JSONB DEFAULT '[]'
      );
    `);
    
    // 2. Videos Table (Replaces library.json and tracks generation history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        youtube_id TEXT,
        title TEXT,
        description TEXT,
        tags JSONB,
        niche TEXT,
        published_at TIMESTAMP,
        status TEXT,
        thumbnail_url TEXT,
        script JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 3. Analytics Table (The brain for Auto-Learning)
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics (
        youtube_id TEXT PRIMARY KEY,
        views INTEGER DEFAULT 0,
        ctr NUMERIC DEFAULT 0,
        retention NUMERIC DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[DB] PostgreSQL schemas initialized successfully.');
    client.release();
  } catch (err) {
    console.error('[DB] Initialization error:', err);
  }
}

initDB();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
