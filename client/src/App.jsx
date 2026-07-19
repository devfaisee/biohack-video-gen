import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Video, Terminal, LayoutDashboard, Film, Search, Filter, Clock, ChevronDown, CheckCircle2, AlertCircle, RefreshCw, Eye, Download } from 'lucide-react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import NICHES from './niches.json';

const BASE_URL = 'https://biohack-video-gen-server-production.up.railway.app';

function Navbar() {
  const location = useLocation();
  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">
        <Sparkles size={24} color="#8b5cf6" />
        NeuroGen Studio
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
              videoUrl: `${BASE_URL}${parsedLog.videoUrl}`,
              thumbnailUrl: parsedLog.thumbnailUrl ? `${BASE_URL}${parsedLog.thumbnailUrl}` : null
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
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="glass-card" style={{ width: '100%' }}>
      <div className="header">
        <h1 className="title">Create Masterpiece</h1>
        <p className="subtitle">The Universal God-Tier Generation Pipeline</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="label">Main Content Category</label>
          <select className="select" value={mainNiche} onChange={(e) => { setMainNiche(e.target.value); setSubNiche(NICHES[e.target.value][0]); }}>
            {Object.keys(NICHES).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="label">Highly Specific Sub-Niche</label>
          <select className="select" value={subNiche} onChange={(e) => setSubNiche(e.target.value)}>
            {NICHES[mainNiche].map(sub => <option key={sub} value={sub}>{sub}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="label">Visual Generation Engine</label>
        <select className="select" value={visualSource} onChange={(e) => setVisualSource(e.target.value)}>
          <option value="ai_images">Cinematic AI Images (Flux Schnell + Ken Burns Zoom)</option>
          <option value="stock_videos">Premium Stock Footage (Pexels / Pixabay)</option>
        </select>
      </div>

      <div className="form-group">
        <label className="label">Custom Topic / Idea (Optional)</label>
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`e.g. A highly specific idea within ${subNiche} (or leave blank to brainstorm)`} />
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <button className="btn btn-secondary" onClick={generateIdea} disabled={ideaLoading || loading} style={{ flex: 1 }}>
          {ideaLoading ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
          {ideaLoading ? ' Engineering Viral Hook...' : ' Generate Viral Idea First'}
        </button>
      </div>

      <AnimatePresence>
        {(customTitle || customDescription) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#cbd5e1', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={16} color="#4ade80" /> Generated Idea (Editable)
              </h3>
              <div className="form-group">
                <label className="label">Viral Title</label>
                <input className="input" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label">Psychological Description</label>
                <textarea className="input" value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} rows={3} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="form-group">
        <label className="label">Target Duration (Minutes)</label>
        <input type="number" className="input" min="1" max="10" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn generate-btn" onClick={generateVideo} disabled={loading} style={{ flex: 1 }}>
            {loading ? <><RefreshCw className="spin" size={20} /> Generating Masterpiece...</> : <><Play size={20} /> Generate Full Video</>}
          </button>
          {loading && (
            <button className="btn" onClick={cancelGeneration} style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#f87171', padding: '0 2rem' }}>
              Stop
            </button>
          )}
      </div>

      {loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="progress-ring-container" style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="glow-ring">
             <RefreshCw size={40} className="spin" color="#8b5cf6" />
          </div>
          <p style={{ marginTop: '1rem', color: '#a855f7', fontWeight: 600, letterSpacing: '1px' }}>PIPELINE ACTIVE</p>
        </motion.div>
      )}

      {/* Live Logs Terminal */}
      <div className="terminal-container">
        <div className="terminal-header">
          <Terminal size={14} /> Pipeline Server Logs
        </div>
        <div className="terminal-body">
          {logs.map((log, i) => (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={i} style={{ marginBottom: '0.25rem' }}>
              <span style={{ color: '#8b5cf6' }}>{new Date().toLocaleTimeString()}</span> {`> ${log}`}
            </motion.div>
          ))}
          {logs.length === 0 && <div style={{ color: '#52525b' }}>System idle. Waiting for tasks...</div>}
          <div ref={logsEndRef} />
        </div>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="result-card">
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#fff', fontWeight: 800 }}>{result.title}</h2>
                <div style={{ background: 'rgba(0,0,0,0.5)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.9rem', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                  {result.description}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  {result.tags && result.tags.map(tag => (
                    <span key={tag} className="tag">#{tag}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <a href={result.videoUrl} target="_blank" rel="noreferrer" className="btn" style={{ flex: 1, textDecoration: 'none' }}>
                    <Video size={18} /> Watch Video
                  </a>
                  <a href={result.videoUrl} download className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                    <Download size={18} />
                  </a>
                </div>
              </div>
              {result.thumbnailUrl && (
                <div style={{ width: '40%', flexShrink: 0 }}>
                  <p className="label">Auto-Generated Thumbnail</p>
                  <img src={result.thumbnailUrl} alt="Thumbnail" style={{ width: '100%', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function VideoLibrary() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterNiche, setFilterNiche] = useState('All');

  useEffect(() => {
    fetchLibrary();
  }, []);

  const fetchLibrary = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/videos`);
      setVideos(res.data.filter(v => v.status !== "error")); // Hide crashed ones from gallery
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const filteredVideos = filterNiche === 'All' ? videos : videos.filter(v => v.mainNiche === filterNiche);
  
  const uniqueNiches = ['All', ...new Set(videos.map(v => v.mainNiche).filter(Boolean))];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="library-container" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1 className="title" style={{ fontSize: '2.5rem' }}>Video Library</h1>
          <p className="subtitle">Your previously generated masterpieces.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Filter size={18} color="#94a3b8" />
          <select className="select" value={filterNiche} onChange={(e) => setFilterNiche(e.target.value)} style={{ width: '250px', background: 'rgba(255,255,255,0.05)' }}>
            {uniqueNiches.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <RefreshCw size={40} className="spin" color="#8b5cf6" />
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Film size={48} color="#475569" style={{ marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1.25rem', color: '#cbd5e1' }}>No Videos Found</h3>
          <p style={{ color: '#64748b', marginTop: '0.5rem' }}>Generate your first video in the Creator Studio to see it here.</p>
        </div>
      ) : (
        <div className="video-grid">
          {filteredVideos.map((video, idx) => (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.05 }} key={video.id} className="video-card">
              <div className="video-thumb-container">
                {video.thumbnailUrl ? (
                  <img src={`${BASE_URL}${video.thumbnailUrl}`} alt="Thumbnail" className="video-thumb" />
                ) : (
                  <div className="video-thumb-placeholder">
                    <Video size={32} color="#475569" />
                  </div>
                )}
                <div className="video-badge">{video.subNiche || video.mainNiche}</div>
              </div>
              <div className="video-info">
                <h3 className="video-title" title={video.title}>{video.title || "Untitled Masterpiece"}</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                  <span className="video-date">
                    <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <a href={`${BASE_URL}${video.videoUrl}`} target="_blank" rel="noreferrer" className="icon-btn">
                      <Eye size={16} />
                    </a>
                    <a href={`${BASE_URL}${video.videoUrl}`} download className="icon-btn">
                      <Download size={16} />
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function App() {
  return (
    <Router>
      <Navbar />
      <div className="app-container">
        <Routes>
          <Route path="/" element={<CreatorStudio />} />
          <Route path="/library" element={<VideoLibrary />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
