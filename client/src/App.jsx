import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, Play, Video, Terminal, LayoutDashboard, Film, Search, Filter, Clock, CheckCircle2, RefreshCw, Eye, Download, X, Copy, Check, ChevronDown, Zap, TrendingUp, AlertTriangle, XCircle, BarChart3, Hash } from 'lucide-react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import NICHES from './niches.json';

const BASE_URL = 'https://biohack-video-gen-server-production.up.railway.app';
const MAX_LOGS = 80;

// ─── Toast System ───────────────────────────────────────────
const ToastContext = React.createContext();
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }} className={`toast toast-${t.type}`}>
              {t.type === 'success' && <CheckCircle2 size={16} />}
              {t.type === 'error' && <XCircle size={16} />}
              {t.type === 'info' && <Zap size={16} />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
function useToast() { return React.useContext(ToastContext); }

// ─── Copy Hook ──────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = useCallback((text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);
  return { copied, copy };
}

// ─── Navbar ─────────────────────────────────────────────────
function Navbar() {
  const location = useLocation();
  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">
        <div className="brand-icon"><Sparkles size={20} /></div>
        NeuroGen Studio
      </Link>
      <div className="nav-links">
        <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          <LayoutDashboard size={16} /> Creator
        </Link>
        <Link to="/library" className={`nav-link ${location.pathname === '/library' ? 'active' : ''}`}>
          <Film size={16} /> Library
        </Link>
        <Link to="/analytics" className={`nav-link ${location.pathname === '/analytics' ? 'active' : ''}`}>
          <BarChart3 size={16} /> Analytics
        </Link>
      </div>
    </nav>
  );
}

// ─── Creator Studio ─────────────────────────────────────────
function CreatorStudio() {
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(1);
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
  const toast = useToast();
  const { copied, copy } = useCopy();

  // SSE connection - stable ref, no re-renders on logs
  useEffect(() => {
    axios.get(`${BASE_URL}/api/status`)
      .then(res => { if (res.data.isRunning) setLoading(true); })
      .catch(() => {});

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
          setLoading(false);
          return;
        }
      } catch {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => {
          const next = [...prev, { text: data.log, time: timestamp }];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
      }
    };
    return () => sse.close();
  }, []);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const generateIdea = useCallback(async () => {
    setIdeaLoading(true);
    try {
      const res = await axios.post(`${BASE_URL}/api/idea`, { topic, mainNiche, subNiche });
      setCustomTitle(res.data.title);
      setCustomDescription(res.data.description);
      toast('Viral idea generated!', 'success');
    } catch {
      toast('Failed to generate idea. Try again.', 'error');
    }
    setIdeaLoading(false);
  }, [topic, mainNiche, subNiche, toast]);

  const generateVideo = useCallback(async () => {
    setLoading(true);
    setLogs([]);
    setResult(null);
    try {
      await axios.post(`${BASE_URL}/api/generate`, {
        durationMinutes: duration, format: 'horizontal', topic, mainNiche, subNiche, visualSource, customTitle, customDescription
      });
      toast('Pipeline started! Generating your masterpiece...', 'info');
    } catch {
      toast('Failed to start generation. Server may be busy.', 'error');
      setLoading(false);
    }
  }, [duration, topic, mainNiche, subNiche, visualSource, customTitle, customDescription, toast]);

  const cancelGeneration = useCallback(async () => {
    try {
      await axios.post(`${BASE_URL}/api/cancel`);
      setLoading(false);
      toast('Generation cancelled.', 'info');
    } catch {
      toast('Failed to cancel.', 'error');
    }
  }, [toast]);

  const nicheKeys = useMemo(() => Object.keys(NICHES), []);
  const subNiches = useMemo(() => NICHES[mainNiche] || [], [mainNiche]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="page-content">
      <div className="glass-card creator-card">
        <div className="header">
          <h1 className="title">Create Masterpiece</h1>
          <p className="subtitle">Universal AI Generation Pipeline</p>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="label">Content Category</label>
            <div className="select-wrapper">
              <select className="select" value={mainNiche} onChange={(e) => { setMainNiche(e.target.value); setSubNiche(NICHES[e.target.value][0]); }}>
                {nicheKeys.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Sub-Niche</label>
            <div className="select-wrapper">
              <select className="select" value={subNiche} onChange={(e) => setSubNiche(e.target.value)}>
                {subNiches.map(sub => <option key={sub} value={sub}>{sub}</option>)}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="label">Visual Engine</label>
            <div className="select-wrapper">
              <select className="select" value={visualSource} onChange={(e) => setVisualSource(e.target.value)}>
                <option value="ai_images">AI Cinematic Images (Flux + Ken Burns)</option>
                <option value="stock_videos">Stock Footage (Pexels / Pixabay)</option>
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Duration (Minutes)</label>
            <input type="number" className="input" min="1" max="10" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </div>
        </div>

        <div className="form-group">
          <label className="label">Custom Topic (Optional)</label>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`e.g. A specific angle on "${subNiche}" (or leave blank)`} />
        </div>

        <button className="btn btn-ghost btn-full" onClick={generateIdea} disabled={ideaLoading || loading}>
          {ideaLoading ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
          {ideaLoading ? 'Engineering Viral Hook...' : 'Generate Viral Idea First'}
        </button>

        <AnimatePresence>
          {(customTitle || customDescription) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="idea-reveal">
              <div className="idea-box">
                <div className="idea-header">
                  <CheckCircle2 size={14} color="#4ade80" />
                  <span>Generated Idea (Editable)</span>
                </div>
                <div className="form-group">
                  <label className="label">Viral Title</label>
                  <input className="input" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="label">Description</label>
                  <textarea className="input textarea" value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} rows={3} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="action-row">
          <button className="btn btn-primary btn-full" onClick={generateVideo} disabled={loading}>
            {loading ? <><RefreshCw className="spin" size={18} /> Generating...</> : <><Play size={18} /> Generate Video</>}
          </button>
          {loading && (
            <button className="btn btn-danger" onClick={cancelGeneration}>
              <X size={18} /> Stop
            </button>
          )}
        </div>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pipeline-status">
            <div className="glow-ring"><RefreshCw size={28} className="spin" /></div>
            <span className="pipeline-label">PIPELINE ACTIVE</span>
          </motion.div>
        )}

        <div className="terminal-container">
          <div className="terminal-header">
            <Terminal size={13} /> <span>Pipeline Logs</span>
            {logs.length > 0 && <span className="log-count">{logs.length}</span>}
          </div>
          <div className="terminal-body">
            {logs.map((log, i) => (
              <div key={i} className="log-line">
                <span className="log-time">{log.time}</span>
                <span className="log-text">{log.text}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="log-empty">System idle. Waiting for tasks...</div>}
            <div ref={logsEndRef} />
          </div>
        </div>

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="result-card">
              <div className="result-layout">
                <div className="result-main">
                  <div className="result-title-row">
                    <h2 className="result-title">{result.title}</h2>
                    <button className="copy-btn" onClick={() => copy(result.title, 'title')} title="Copy Title">
                      {copied === 'title' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div className="result-desc">
                    <p>{result.description}</p>
                    <button className="copy-btn copy-inline" onClick={() => copy(result.description, 'desc')} title="Copy Description">
                      {copied === 'desc' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  {result.tags && (
                    <div className="tag-row">
                      {result.tags.map(tag => <span key={tag} className="tag">#{tag}</span>)}
                      <button className="copy-btn" onClick={() => copy(result.tags.map(t => '#' + t).join(' '), 'tags')} title="Copy All Tags">
                        {copied === 'tags' ? <Check size={14} /> : <Hash size={14} />}
                      </button>
                    </div>
                  )}
                  <div className="result-actions">
                    <a href={result.videoUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
                      <Video size={16} /> Watch Video
                    </a>
                    <a href={result.videoUrl} download className="btn btn-ghost">
                      <Download size={16} /> Download
                    </a>
                  </div>
                </div>
                {result.thumbnailUrl && (
                  <div className="result-thumb">
                    <p className="label">Auto-Generated Thumbnail</p>
                    <img src={result.thumbnailUrl} alt="Thumbnail" />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Video Detail Modal ─────────────────────────────────────
function VideoModal({ video, onClose }) {
  const { copied, copy } = useCopy();
  if (!video) return null;
  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal-content" initial={{ scale: 0.9, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 40 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={20} /></button>
        <div className="modal-video">
          <video src={`${BASE_URL}${video.videoUrl}`} controls poster={video.thumbnailUrl ? `${BASE_URL}${video.thumbnailUrl}` : undefined} />
        </div>
        <div className="modal-body">
          <div className="modal-title-row">
            <h2>{video.title || "Untitled"}</h2>
            <button className="copy-btn" onClick={() => copy(video.title || '', 'mtitle')}>
              {copied === 'mtitle' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          {video.description && (
            <div className="modal-desc">
              <p>{video.description}</p>
              <button className="copy-btn copy-inline" onClick={() => copy(video.description, 'mdesc')}>
                {copied === 'mdesc' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
          {video.tags && video.tags.length > 0 && (
            <div className="tag-row">
              {video.tags.map(tag => <span key={tag} className="tag">#{tag}</span>)}
              <button className="copy-btn" onClick={() => copy(video.tags.map(t => '#' + t).join(' '), 'mtags')}>
                {copied === 'mtags' ? <Check size={14} /> : <Hash size={14} />}
              </button>
            </div>
          )}
          <div className="modal-meta">
            <span className="meta-chip"><Clock size={12} /> {new Date(video.createdAt).toLocaleDateString()}</span>
            {video.mainNiche && <span className="meta-chip"><TrendingUp size={12} /> {video.mainNiche}</span>}
            {video.subNiche && <span className="meta-chip">{video.subNiche}</span>}
          </div>
          <div className="modal-actions">
            <a href={`${BASE_URL}${video.videoUrl}`} download className="btn btn-primary"><Download size={16} /> Download MP4</a>
            <button className="btn btn-ghost" onClick={() => { const all = `Title: ${video.title}\n\nDescription:\n${video.description}\n\nTags: ${(video.tags||[]).map(t=>'#'+t).join(' ')}`; copy(all, 'mall'); }}>
              {copied === 'mall' ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy All</>}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Video Library ──────────────────────────────────────────
function VideoLibrary() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterNiche, setFilterNiche] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${BASE_URL}/api/videos`);
        setVideos(res.data.filter(v => v.status !== "error"));
      } catch {
        toast('Failed to load library.', 'error');
      }
      setLoading(false);
    })();
  }, [toast]);

  const filteredVideos = useMemo(() => {
    let list = videos;
    if (filterNiche !== 'All') list = list.filter(v => v.mainNiche === filterNiche);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(v => (v.title || '').toLowerCase().includes(q) || (v.subNiche || '').toLowerCase().includes(q));
    }
    if (sortBy === 'newest') list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortBy === 'oldest') list = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sortBy === 'title') list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return list;
  }, [videos, filterNiche, searchQuery, sortBy]);

  const uniqueNiches = useMemo(() => ['All', ...new Set(videos.map(v => v.mainNiche).filter(Boolean))], [videos]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content">
      <div className="library-header">
        <div>
          <h1 className="title" style={{ fontSize: '2.5rem' }}>Video Library</h1>
          <p className="subtitle">{videos.length} videos generated</p>
        </div>
      </div>

      <div className="library-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search videos..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <div className="toolbar-selects">
          <div className="select-wrapper select-sm">
            <select className="select" value={filterNiche} onChange={e => setFilterNiche(e.target.value)}>
              {uniqueNiches.map(n => <option key={n} value={n}>{n === 'All' ? 'All Niches' : n}</option>)}
            </select>
            <ChevronDown size={14} className="select-icon" />
          </div>
          <div className="select-wrapper select-sm">
            <select className="select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title A-Z</option>
            </select>
            <ChevronDown size={14} className="select-icon" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><RefreshCw size={36} className="spin" /></div>
      ) : filteredVideos.length === 0 ? (
        <div className="empty-state">
          <Film size={48} />
          <h3>{searchQuery || filterNiche !== 'All' ? 'No videos match your filters' : 'No Videos Yet'}</h3>
          <p>Generate your first video in the Creator Studio.</p>
        </div>
      ) : (
        <div className="video-grid">
          {filteredVideos.map((video, idx) => (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx * 0.03, 0.5) }} key={video.id} className="video-card" onClick={() => setSelectedVideo(video)}>
              <div className="video-thumb-container">
                {video.thumbnailUrl ? (
                  <img src={`${BASE_URL}${video.thumbnailUrl}`} alt="" className="video-thumb" loading="lazy" />
                ) : (
                  <div className="video-thumb-placeholder"><Video size={28} /></div>
                )}
                <div className="video-badge">{video.subNiche || video.mainNiche}</div>
                <div className="video-play-overlay"><Play size={32} /></div>
              </div>
              <div className="video-info">
                <h3 className="video-title">{video.title || "Untitled"}</h3>
                <span className="video-date"><Clock size={11} /> {new Date(video.createdAt).toLocaleDateString()}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selectedVideo && <VideoModal video={selectedVideo} onClose={() => setSelectedVideo(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Analytics Page ─────────────────────────────────────────
function Analytics() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${BASE_URL}/api/videos`);
        setVideos(res.data.filter(v => v.status !== "error"));
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const nicheCount = {};
    const sourceCount = { ai_images: 0, stock_videos: 0 };
    videos.forEach(v => {
      if (v.mainNiche) nicheCount[v.mainNiche] = (nicheCount[v.mainNiche] || 0) + 1;
      if (v.visualSource) sourceCount[v.visualSource] = (sourceCount[v.visualSource] || 0) + 1;
    });
    const topNiches = Object.entries(nicheCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const totalSegments = videos.reduce((sum, v) => sum + (v.imageCount || 0), 0);
    return { total: videos.length, topNiches, totalSegments, sourceCount };
  }, [videos]);

  if (loading) return <div className="loading-center"><RefreshCw size={36} className="spin" /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content">
      <h1 className="title" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Analytics</h1>
      <p className="subtitle" style={{ marginBottom: '2rem' }}>Your generation history at a glance</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><Video size={20} /></div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Videos</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Film size={20} /></div>
          <div className="stat-value">{stats.totalSegments}</div>
          <div className="stat-label">Total Segments</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><TrendingUp size={20} /></div>
          <div className="stat-value">{stats.topNiches.length > 0 ? stats.topNiches[0][0].split(' ')[0] : '—'}</div>
          <div className="stat-label">Top Niche</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><BarChart3 size={20} /></div>
          <div className="stat-value">{Object.keys(NICHES).length}</div>
          <div className="stat-label">Available Niches</div>
        </div>
      </div>

      {stats.topNiches.length > 0 && (
        <div className="glass-card" style={{ marginTop: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', fontWeight: 700 }}>Videos by Niche</h3>
          <div className="bar-chart">
            {stats.topNiches.map(([niche, count]) => (
              <div key={niche} className="bar-row">
                <span className="bar-label">{niche}</span>
                <div className="bar-track">
                  <motion.div className="bar-fill" initial={{ width: 0 }} animate={{ width: `${(count / stats.total) * 100}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
                </div>
                <span className="bar-value">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── App Root ───────────────────────────────────────────────
function App() {
  return (
    <Router>
      <ToastProvider>
        <Navbar />
        <div className="app-container">
          <Routes>
            <Route path="/" element={<CreatorStudio />} />
            <Route path="/library" element={<VideoLibrary />} />
            <Route path="/analytics" element={<Analytics />} />
          </Routes>
        </div>
      </ToastProvider>
    </Router>
  );
}

export default App;
