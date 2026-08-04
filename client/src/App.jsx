import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { Sparkles, Play, Video, Terminal, LayoutDashboard, Film, Search, Clock, CheckCircle2, RefreshCw, Eye, Download, X, Copy, Check, ChevronDown, Zap, TrendingUp, XCircle, BarChart3, Hash, Globe, Cpu, Calendar, Activity, Layers, PieChart } from 'lucide-react';
import axios from 'axios';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import NICHES from './niches.json';

const RAILWAY_URL = 'https://biohack-video-gen-server-production.up.railway.app';
const LOCAL_URL = 'http://localhost:5001';
const MAX_LOGS = 80;

// ─── Server URL Context (Desktop Mode Switcher) ──────────────
const ServerCtx = createContext({ baseUrl: RAILWAY_URL, mode: 'railway', setMode: () => {} });
function useServer() { return useContext(ServerCtx); }

function ServerProvider({ children }) {
  const isElectron = typeof window !== 'undefined' && window.desktopAPI?.isElectron;
  const [mode, setModeState] = useState('railway');
  const [switching, setSwitching] = useState(false);
  const [serverReady, setServerReady] = useState(true);
  const baseUrl = mode === 'local' ? LOCAL_URL : RAILWAY_URL;

  const setMode = useCallback(async (newMode) => {
    if (!isElectron) return;
    setSwitching(true);
    setServerReady(false);
    try {
      const result = await window.desktopAPI.switchMode(newMode);
      if (result.success) {
        setModeState(newMode);
        setServerReady(true);
      } else {
        console.error('Mode switch failed:', result.error);
      }
    } catch (e) {
      console.error('Mode switch error:', e);
    }
    setSwitching(false);
  }, [isElectron]);

  return (
    <ServerCtx.Provider value={{ baseUrl, mode, setMode, switching, serverReady, isElectron }}>
      {children}
    </ServerCtx.Provider>
  );
}

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
  const { mode, setMode, switching, serverReady, isElectron } = useServer();
  return (
    <>
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
      {isElectron && (
        <div className="mode-switcher" title={mode === 'railway' ? 'Using Railway Cloud Server' : 'Using Local PC Server (localhost:5001)'}>
          <button
            className={`mode-btn ${mode === 'railway' ? 'mode-active' : ''}`}
            onClick={() => setMode('railway')}
            disabled={switching || mode === 'railway'}
          >
            <Globe size={13} /> Railway
          </button>
          <button
            className={`mode-btn ${mode === 'local' ? 'mode-active mode-local' : ''}`}
            onClick={() => setMode('local')}
            disabled={switching || mode === 'local'}
          >
            <Cpu size={13} /> {switching && mode !== 'local' ? 'Starting...' : 'Local PC'}
          </button>
          <div className={`mode-indicator ${serverReady ? 'mode-ok' : 'mode-wait'}`} />
        </div>
      )}
    </nav>
    {isElectron && mode === 'local' && serverReady && (
      <div className="desktop-banner">
        <Cpu size={13} /> Running on <strong>Local PC</strong> — Output saved to <code>server/output/</code>
        <button className="open-folder-btn" onClick={() => window.desktopAPI?.openOutputFolder()}>📁 Open Output Folder</button>
      </div>
    )}
    </>
  );
}

// ─── Creator Studio ─────────────────────────────────────────
function CreatorStudio() {
  const { baseUrl } = useServer();
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
  const toast = useToast();
  const { copied, copy } = useCopy();
  const sseRef = useRef(null);

  // SSE connection - re-connects when baseUrl changes (mode switch)
  useEffect(() => {
    if (sseRef.current) sseRef.current.close();
    axios.get(`${baseUrl}/api/status`)
      .then(res => { if (res.data.isRunning) setLoading(true); })
      .catch(() => {});

    const sse = new EventSource(`${baseUrl}/api/logs`);
    sseRef.current = sse;
    sse.onerror = () => {
      sse.close();
      setTimeout(() => {
        if (sseRef.current) sseRef.current.close();
        // Reconnect logic - the useEffect will handle it on next re-render
      }, 3000);
      console.log('SSE connection lost, reconnecting...');
    };
    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      try {
        const parsedLog = JSON.parse(data.log);
        if (parsedLog.event === "complete") {
          setResult({
            title: parsedLog.title,
            description: parsedLog.description,
            tags: parsedLog.tags,
            videoUrl: `${baseUrl}${parsedLog.videoUrl}`,
            thumbnailUrl: parsedLog.thumbnailUrl ? `${baseUrl}${parsedLog.thumbnailUrl}` : null
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
  }, [baseUrl]);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const generateIdea = useCallback(async () => {
    setIdeaLoading(true);
    try {
      const res = await axios.post(`${baseUrl}/api/idea`, { topic, mainNiche, subNiche });
      setCustomTitle(res.data.title);
      setCustomDescription(res.data.description);
      toast('Viral idea generated!', 'success');
    } catch {
      toast('Failed to generate idea. Try again.', 'error');
    }
    setIdeaLoading(false);
  }, [baseUrl, topic, mainNiche, subNiche, toast]);

  const generateVideo = useCallback(async () => {
    setLoading(true);
    setLogs([]);
    setResult(null);
    try {
      // Ensure server is online before posting generation
      let attempts = 0;
      let ok = false;
      while (attempts < 5 && !ok) {
        try {
          await axios.get(`${baseUrl}/api/health`, { timeout: 2000 });
          ok = true;
        } catch {
          attempts++;
          await new Promise(r => setTimeout(r, 800));
        }
      }
      await axios.post(`${baseUrl}/api/generate`, {
        durationMinutes: duration, format, topic, mainNiche, subNiche, visualSource, customTitle, customDescription
      });
      toast('Pipeline started! Generating your masterpiece...', 'info');
    } catch {
      toast('Failed to start generation. Server may be starting, try again in 3 seconds.', 'error');
      setLoading(false);
    }
  }, [baseUrl, duration, format, topic, mainNiche, subNiche, visualSource, customTitle, customDescription, toast]);

  const cancelGeneration = useCallback(async () => {
    try {
      // In Electron Local PC mode: use the IPC bridge so main process sends cancel to local server
      if (typeof window !== 'undefined' && window.desktopAPI?.isElectron) {
        await window.desktopAPI.cancelGeneration();
      } else {
        await axios.post(`${baseUrl}/api/cancel`);
      }
      setLoading(false);
      toast('Generation cancelled.', 'info');
    } catch {
      toast('Failed to cancel.', 'error');
    }
  }, [baseUrl, toast]);

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

        <div className="form-group">
          <label className="label">Visual Engine</label>
          <div className="select-wrapper">
            <select className="select" value={visualSource} onChange={(e) => setVisualSource(e.target.value)}>
              <option value="ai_images">✨ AI Cinematic Visuals (Flux) — 100% Unique (Zero Reused Content Risk)</option>
              <option value="stock_videos">🎬 Transformed Stock Footage (Color Graded & Vignetted)</option>
            </select>
            <ChevronDown size={16} className="select-icon" />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="label">Video Format</label>
            <div className="select-wrapper">
              <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="horizontal">🖥️ Horizontal (16:9) — YouTube, Desktop</option>
                <option value="vertical">📱 Vertical (9:16) — YouTube Shorts, TikTok, Reels</option>
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
            {loading && logs.length > 0 && (() => {
              const lastLog = logs[logs.length - 1]?.text || '';
              const encMatch = lastLog.match(/(\d+)% complete/);
              const segMatch = lastLog.match(/Segment (\d+)\/(\d+)/);
              let pct = 0;
              if (encMatch) pct = parseInt(encMatch[1]);
              else if (segMatch) pct = Math.round((parseInt(segMatch[1]) / parseInt(segMatch[2])) * 50);
              return pct > 0 ? (
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  <span className="progress-bar-text">{pct}%</span>
                </div>
              ) : null;
            })()}
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
                  <div className="result-video-preview" style={{ marginBottom: '1.25rem' }}>
                    <video src={result.videoUrl} controls autoPlay poster={result.thumbnailUrl || undefined} style={{ width: '100%', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', background: '#000' }} />
                  </div>
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
                  <div className="result-actions" style={{ flexWrap: 'wrap', gap: '8px', marginTop: '1rem' }}>
                    <a href={result.videoUrl} download className="btn btn-primary">
                      <Download size={16} /> Download MP4
                    </a>
                    {result.thumbnailUrl && (
                      <a href={result.thumbnailUrl} download className="btn btn-secondary">
                        <Download size={16} /> Download Thumbnail
                      </a>
                    )}
                    {typeof window !== 'undefined' && window.desktopAPI?.isElectron && (
                      <button className="btn btn-ghost" onClick={() => window.desktopAPI.openOutputFolder()}>
                        📁 Open Folder
                      </button>
                    )}
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
  const { baseUrl } = useServer();
  const { copied, copy } = useCopy();
  if (!video) return null;
  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal-content" initial={{ scale: 0.9, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 40 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={20} /></button>
        <div className="modal-video">
          <video src={`${baseUrl}${video.videoUrl}`} controls poster={video.thumbnailUrl ? `${baseUrl}${video.thumbnailUrl}` : undefined} />
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
            {video.thumbnailQA && video.thumbnailQA !== "N/A" && (
              <span className="meta-chip" style={{background: 'rgba(255, 215, 0, 0.1)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)'}}>
                <Zap size={12} /> AI QA: {video.thumbnailQA}
              </span>
            )}
          </div>
          <div className="modal-actions">
            <a href={`${baseUrl}${video.videoUrl}`} download className="btn btn-primary"><Download size={16} /> Download MP4</a>
            {video.thumbnailUrl && <a href={`${baseUrl}${video.thumbnailUrl}`} download className="btn btn-secondary"><Download size={16} /> Thumbnail</a>}
            {typeof window !== 'undefined' && window.desktopAPI?.isElectron && (
              <button className="btn btn-secondary" onClick={() => window.desktopAPI.openOutputFolder()}>📁 Open Folder</button>
            )}
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
  const { baseUrl } = useServer();
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
        const res = await axios.get(`${baseUrl}/api/videos`);
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
                  <img src={`${baseUrl}${video.thumbnailUrl}`} alt="" className="video-thumb" loading="lazy" />
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
  const { baseUrl } = useServer();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${baseUrl}/api/videos`);
        setVideos(res.data.filter(v => v.status !== "error"));
      } catch (err) {
        console.warn('Analytics fetch failed:', err.message);
      }
      setLoading(false);
    })();
  }, [baseUrl]);

  const stats = useMemo(() => {
    const nicheCount = {};
    const sourceCount = { ai_images: 0, stock_videos: 0 };
    const dates = {};
    const subNicheCount = {};

    videos.forEach(v => {
      if (v.mainNiche) nicheCount[v.mainNiche] = (nicheCount[v.mainNiche] || 0) + 1;
      if (v.visualSource) sourceCount[v.visualSource] = (sourceCount[v.visualSource] || 0) + 1;
      
      const date = new Date(v.createdAt).toLocaleDateString();
      dates[date] = (dates[date] || 0) + 1;

      if (v.subNiche && v.mainNiche) {
        const key = `${v.mainNiche}::${v.subNiche}`;
        subNicheCount[key] = (subNicheCount[key] || 0) + 1;
      }
    });

    const topNiches = Object.entries(nicheCount).sort((a, b) => b[1] - a[1]);
    const totalSegments = videos.reduce((sum, v) => sum + (v.imageCount || 0), 0);
    
    const uniqueDays = Object.keys(dates).length || 1;
    const avgPerDay = (videos.length / uniqueDays).toFixed(1);

    const timelineData = Object.entries(dates).sort((a, b) => new Date(a[0]) - new Date(b[0])).slice(-14);
    
    const topSubNiches = Object.entries(subNicheCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [main, sub] = key.split('::');
        return { main, sub, count };
      });

    return { 
      total: videos.length, 
      topNiches, 
      totalSegments, 
      sourceCount,
      uniqueNiches: Object.keys(nicheCount).length,
      avgPerDay,
      timelineData,
      topSubNiches
    };
  }, [videos]);

  if (loading) return <div className="loading-center"><RefreshCw size={36} className="spin" /></div>;

  const totalSources = stats.sourceCount.ai_images + stats.sourceCount.stock_videos || 1;
  const aiPercentage = Math.round((stats.sourceCount.ai_images / totalSources) * 100);
  const stockPercentage = Math.round((stats.sourceCount.stock_videos / totalSources) * 100);
  const maxTimelineCount = Math.max(...stats.timelineData.map(d => d[1]), 1);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content analytics-dashboard">
      <div className="analytics-header">
        <div>
          <h1 className="title" style={{ fontSize: '2.5rem', marginBottom: '0.2rem' }}>Analytics Dashboard</h1>
          <p className="subtitle">Comprehensive insights into your generation history</p>
        </div>
      </div>

      {/* 1. Summary Stats Row */}
      <div className="analytics-stats-grid">
        <div className="stat-card premium-card">
          <div className="stat-icon-wrapper"><Video size={20} className="text-violet" /></div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Videos</div>
          </div>
        </div>
        <div className="stat-card premium-card">
          <div className="stat-icon-wrapper"><Film size={20} className="text-blue" /></div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalSegments}</div>
            <div className="stat-label">Segments Processed</div>
          </div>
        </div>
        <div className="stat-card premium-card">
          <div className="stat-icon-wrapper"><TrendingUp size={20} className="text-emerald" /></div>
          <div className="stat-content">
            <div className="stat-value">{stats.topNiches.length > 0 ? stats.topNiches[0][0].split(' ')[0] : '—'}</div>
            <div className="stat-label">Top Niche</div>
          </div>
        </div>
        <div className="stat-card premium-card">
          <div className="stat-icon-wrapper"><Layers size={20} className="text-amber" /></div>
          <div className="stat-content">
            <div className="stat-value">{stats.uniqueNiches}</div>
            <div className="stat-label">Unique Niches</div>
          </div>
        </div>
        <div className="stat-card premium-card">
          <div className="stat-icon-wrapper"><Activity size={20} className="text-rose" /></div>
          <div className="stat-content">
            <div className="stat-value">{stats.avgPerDay}</div>
            <div className="stat-label">Avg Videos / Day</div>
          </div>
        </div>
      </div>

      <div className="analytics-bento-grid">
        {/* 2. Generation Timeline Chart */}
        <div className="glass-card bento-card col-span-2">
          <div className="card-header">
            <h3 className="card-title"><Calendar size={18} /> Generation Timeline</h3>
          </div>
          <div className="timeline-chart">
            {stats.timelineData.map(([date, count], i) => (
              <div key={date} className="timeline-bar-wrapper" title={`${date}: ${count} videos`}>
                <div className="timeline-bar-value">{count}</div>
                <div className="timeline-bar-track">
                  <motion.div 
                    className="timeline-bar-fill" 
                    initial={{ height: 0 }} 
                    animate={{ height: `${(count / maxTimelineCount) * 100}%` }} 
                    transition={{ duration: 0.8, delay: i * 0.05, ease: 'easeOut' }} 
                  />
                </div>
                <div className="timeline-bar-label">{date.split('/')[0]}/{date.split('/')[1]}</div>
              </div>
            ))}
            {stats.timelineData.length === 0 && <div className="empty-state">No timeline data available</div>}
          </div>
        </div>

        {/* 5. Visual Source Breakdown */}
        <div className="glass-card bento-card">
          <div className="card-header">
            <h3 className="card-title"><PieChart size={18} /> Visual Sources</h3>
          </div>
          <div className="source-breakdown">
            <div className="source-item">
              <div className="source-info">
                <span>AI Images</span>
                <span className="source-count">{stats.sourceCount.ai_images}</span>
              </div>
              <div className="progress-track">
                <motion.div className="progress-fill ai-fill" initial={{ width: 0 }} animate={{ width: `${aiPercentage}%` }} transition={{ duration: 1 }} />
              </div>
              <div className="source-pct">{aiPercentage}%</div>
            </div>
            <div className="source-item">
              <div className="source-info">
                <span>Stock Videos</span>
                <span className="source-count">{stats.sourceCount.stock_videos}</span>
              </div>
              <div className="progress-track">
                <motion.div className="progress-fill stock-fill" initial={{ width: 0 }} animate={{ width: `${stockPercentage}%` }} transition={{ duration: 1 }} />
              </div>
              <div className="source-pct">{stockPercentage}%</div>
            </div>
          </div>
        </div>

        {/* 3. Niche Distribution */}
        <div className="glass-card bento-card col-span-2">
          <div className="card-header">
            <h3 className="card-title"><BarChart3 size={18} /> Niche Distribution</h3>
          </div>
          <div className="niche-chart">
            {stats.topNiches.slice(0, 5).map(([niche, count], i) => (
              <div key={niche} className="niche-row">
                <span className="niche-label">{niche}</span>
                <div className="niche-track">
                  <motion.div 
                    className="niche-fill" 
                    initial={{ width: 0 }} 
                    animate={{ width: `${(count / stats.total) * 100}%` }} 
                    transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }} 
                  />
                </div>
                <span className="niche-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 6. Sub-Niche Leaderboard */}
        <div className="glass-card bento-card col-span-2">
          <div className="card-header">
            <h3 className="card-title"><LayoutDashboard size={18} /> Sub-Niche Leaderboard</h3>
          </div>
          <div className="leaderboard-table-container">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Sub-Niche</th>
                  <th>Parent Niche</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {stats.topSubNiches.map((item, i) => (
                  <motion.tr 
                    key={`${item.main}-${item.sub}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <td><span className="rank-badge">#{i + 1}</span></td>
                    <td className="font-medium">{item.sub}</td>
                    <td className="text-muted">{item.main}</td>
                    <td className="text-right font-bold">{item.count}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Recent Activity Feed */}
        <div className="glass-card bento-card col-span-full">
          <div className="card-header">
            <h3 className="card-title"><Clock size={18} /> Recent Activity</h3>
          </div>
          <div className="activity-feed">
            {videos.slice(0, 10).map((v, i) => (
              <motion.div 
                key={v.id} 
                className="activity-item"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="activity-thumb">
                  {v.thumbnailUrl ? <img src={`${baseUrl}${v.thumbnailUrl}`} alt="" /> : <Video size={20} />}
                </div>
                <div className="activity-details">
                  <h4>{v.title || 'Untitled Generation'}</h4>
                  <div className="activity-meta">
                    <span className="badge">{v.mainNiche}</span>
                    <span className="time">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <Link to="/library" className="activity-link">View</Link>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}


// ─── App Root ───────────────────────────────────────────────
function App() {
  return (
    <Router>
      <ServerProvider>
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
      </ServerProvider>
    </Router>
  );
}

export default App;
