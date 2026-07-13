import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Video, Terminal, LayoutDashboard, Film, Search, Filter } from 'lucide-react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';

const NICHES = {
  "Health & Science": ["Neuroscience & Biohacking", "Dopamine Detox", "Fitness & Diet", "Mental Health"],
  "Stories & Fiction": ["True Crime", "Senior Revenge", "Horror / Paranormal", "Sci-Fi Short Stories"],
  "Finance & Business": ["Crypto & Web3", "Personal Finance", "Entrepreneurship", "Real Estate", "Tech Startups"],
  "Mystery & History": ["Unsolved Mysteries", "Ancient History", "Conspiracy Theories", "Lost Civilizations"]
};

const BASE_URL = 'https://biohack-video-gen-server-production.up.railway.app';

function Navbar() {
  const location = useLocation();
  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">
        <Sparkles size={24} color="#8b5cf6" /> NeuroGen Studio
      </Link>
      <div className="nav-links">
        <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          <LayoutDashboard size={18} /> Creator Studio
        </Link>
        <Link to="/library" className={`nav-link ${location.pathname === '/library' ? 'active' : ''}`}>
          <Film size={18} /> Video Library
        </Link>
      </div>
    </nav>
  );
}

function CreatorStudio() {
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(1);
  const [format, setFormat] = useState('horizontal');
  const [mainNiche, setMainNiche] = useState(Object.keys(NICHES)[0]);
  const [subNiche, setSubNiche] = useState(NICHES[Object.keys(NICHES)[0]][0]);
  const [topic, setTopic] = useState('');
  const [visualSource, setVisualSource] = useState('ai_images');
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [ideaLoading, setIdeaLoading] = useState(false);
  
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  useEffect(() => {
    axios.get(`${BASE_URL}/api/status`)
      .then(res => { if (res.data.isRunning) setLoading(true); })
      .catch(e => console.error("Failed to fetch status", e));

    const sse = new EventSource(`${BASE_URL}/api/logs`);
    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      try {
        const parsedLog = JSON.parse(data.log);
        if (parsedLog.event === "complete") {
           setResult({
              title: parsedLog.title,
              description: parsedLog.description,
              tags: parsedLog.tags,
              videoUrl: `${BASE_URL}${parsedLog.videoUrl}`
           });
           setLoading(false);
           return;
        }
        if (parsedLog.event === "error") {
           alert("Generation failed: " + parsedLog.message);
           setLoading(false);
           return;
        }
      } catch(err) {
        setLogs(prev => [...prev, data.log]);
      }
    };
    return () => sse.close();
  }, []);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const generateIdea = async () => {
    setIdeaLoading(true);
    try {
      const res = await axios.post(`${BASE_URL}/api/idea`, { topic, mainNiche, subNiche });
      setCustomTitle(res.data.title);
      setCustomDescription(res.data.description);
    } catch (error) {
      console.error('Error generating idea:', error);
      alert('Failed to generate idea. Check console.');
    }
    setIdeaLoading(false);
  };

  const generateVideo = async () => {
    setLoading(true);
    setLogs([]);
    setResult(null);
    try {
      await axios.post(`${BASE_URL}/api/generate`, {
        durationMinutes: duration, format, topic, mainNiche, subNiche, visualSource, customTitle, customDescription
      });
    } catch (error) {
      console.error('Error generating video:', error);
      alert('Failed to start video generation.');
      setLoading(false);
    }
  };

  const cancelGeneration = async () => {
    try {
      await axios.post(`${BASE_URL}/api/cancel`);
      setLoading(false);
    } catch (error) {
      console.error('Error cancelling video:', error);
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: '1000px', margin: '2rem auto' }}>
      <div className="glass-card" style={{ width: '100%' }}>
        <div className="header">
          <h1 className="title">Create Masterpiece</h1>
          <p className="subtitle">Universal AI Generation Pipeline</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Main Content Category</label>
            <select className="select" value={mainNiche} onChange={(e) => { setMainNiche(e.target.value); setSubNiche(NICHES[e.target.value][0]); }}>
              {Object.keys(NICHES).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Specific Sub-Niche</label>
            <select className="select" value={subNiche} onChange={(e) => setSubNiche(e.target.value)}>
              {NICHES[mainNiche].map(sub => <option key={sub} value={sub}>{sub}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Visual Source Engine</label>
          <select className="select" value={visualSource} onChange={(e) => setVisualSource(e.target.value)}>
            <option value="ai_images">AI Generated Cinematic Images (Replicate Flux)</option>
            <option value="stock_videos">Real Stock Footage (Pexels / Pixabay)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="label">Custom Topic / Specific Idea (Optional)</label>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`e.g. A highly specific idea within ${subNiche} (or leave blank to brainstorm)`} />
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <button className="btn btn-secondary" onClick={generateIdea} disabled={ideaLoading || loading} style={{ flex: 1 }}>
            {ideaLoading ? <div className="loader"></div> : <Sparkles size={18} />}
            {ideaLoading ? ' Brainstorming...' : ' Generate Viral Idea First'}
          </button>
        </div>

        {(customTitle || customDescription) && (
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#cbd5e1', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Generated Idea (You can edit this)</h3>
            <div className="form-group">
              <label className="label">Viral Title</label>
              <input className="input" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="label">Description / Concept</label>
              <textarea className="input" value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} rows={3} />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="label">Target Duration (Minutes)</label>
          <input type="number" className="input" min="1" max="10" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn" onClick={generateVideo} disabled={loading} style={{ flex: 1 }}>
            {loading ? <><div className="loader"></div> Generating Masterpiece...</> : <><Play size={20} /> Generate Full Video</>}
            </button>
            {loading && <button className="btn" onClick={cancelGeneration} style={{ background: '#ef4444', color: '#fff', padding: '0 2rem' }}>Stop</button>}
        </div>

        {/* Live Logs Terminal */}
        <div className="terminal-container" style={{ marginTop: '2rem', height: '250px', display: 'flex', flexDirection: 'column' }}>
          <div className="terminal-header" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>
            <Terminal size={14} /> Pipeline Server Logs
          </div>
          <div style={{ padding: '1rem', flexGrow: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem', color: '#4ade80' }}>
            {logs.map((log, i) => <div key={i} style={{ marginBottom: '0.25rem' }}>{`> ${log}`}</div>)}
            {logs.length === 0 && <div style={{ color: '#52525b' }}>System idle. Waiting for tasks...</div>}
            <div ref={logsEndRef} />
          </div>
        </div>

        {result && (
          <div style={{ marginTop: '3rem', padding: '2rem', background: 'rgba(0,0,0,0.4)', borderRadius: '16px', border: '1px solid rgba(139,92,246,0.3)' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{result.title}</h2>
            <div className="tags" style={{ marginBottom: '1rem' }}>
              {result.tags.map((tag, i) => <span key={i} className="tag">#{tag}</span>)}
            </div>
            <video controls width="100%" src={result.videoUrl} style={{ borderRadius: '12px', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }} />
            <a href={result.videoUrl} download className="btn" style={{ marginTop: '1.5rem', width: '100%' }} target="_blank" rel="noreferrer">
              📥 Download Final Masterpiece (.mp4)
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Library() {
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [filterNiche, setFilterNiche] = useState('All');

  useEffect(() => {
    axios.get(`${BASE_URL}/api/videos`)
      .then(res => setLibraryVideos(res.data))
      .catch(e => console.error("Failed to fetch library", e));
  }, []);

  const filteredVideos = filterNiche === 'All' 
    ? libraryVideos 
    : libraryVideos.filter(v => v.mainNiche === filterNiche);

  return (
    <div className="app-container" style={{ flexDirection: 'column', width: '100%' }}>
      <div className="filters-bar" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8' }}>
          <Filter size={18} /> Filter by Niche:
        </div>
        <select className="select" style={{ width: 'auto', padding: '0.5rem 1rem' }} value={filterNiche} onChange={(e) => setFilterNiche(e.target.value)}>
          <option value="All">All Categories</option>
          {Object.keys(NICHES).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.9rem' }}>
          Showing {filteredVideos.length} videos
        </div>
      </div>

      {filteredVideos.length > 0 ? (
        <div className="video-grid" style={{ width: '100%' }}>
          {filteredVideos.map((video) => (
            <div key={video.id} className="video-card">
              {video.status !== 'error' && (
                <video src={`${BASE_URL}${video.videoUrl}`} controls style={{ width: '100%', height: '200px', objectFit: 'cover', background: '#000' }} />
              )}
              <div className="video-card-body">
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {video.mainNiche && <span className="badge badge-niche">{video.mainNiche}</span>}
                  {video.subNiche && <span className="badge badge-sub">{video.subNiche}</span>}
                  {video.imageCount && <span className="badge badge-img">🖼️ {video.imageCount} Assets</span>}
                </div>
                <h3>{video.status === 'error' ? '❌ ' : ''}{video.title || 'Untitled Video'}</h3>
                {video.status !== 'error' && (
                  <a href={`${BASE_URL}${video.videoUrl}`} download className="btn" style={{ width: '100%', padding: '0.75rem', fontSize: '0.9rem', marginTop: '1rem' }} target="_blank" rel="noreferrer">
                    Download
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card" style={{ width: '100%', textAlign: 'center', padding: '4rem 2rem' }}>
          <Video size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>No videos found</h2>
          <p style={{ color: '#94a3b8' }}>Generate some masterpieces in this niche first!</p>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<CreatorStudio />} />
        <Route path="/library" element={<Library />} />
      </Routes>
    </Router>
  );
}

export default App;
