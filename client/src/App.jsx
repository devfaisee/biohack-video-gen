import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Video, Terminal } from 'lucide-react';
import axios from 'axios';

const NICHES = {
  "Health & Science": ["Neuroscience & Biohacking", "Dopamine Detox", "Fitness & Diet", "Mental Health"],
  "Stories & Fiction": ["True Crime", "Senior Revenge", "Horror / Paranormal", "Sci-Fi Short Stories"],
  "Finance & Business": ["Crypto & Web3", "Personal Finance", "Entrepreneurship", "Real Estate", "Tech Startups"],
  "Mystery & History": ["Unsolved Mysteries", "Ancient History", "Conspiracy Theories", "Lost Civilizations"]
};

function App() {
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

  const [libraryVideos, setLibraryVideos] = useState([]);

  const fetchLibrary = async () => {
    try {
      const res = await axios.get('https://biohack-video-gen-server-production.up.railway.app/api/videos');
      setLibraryVideos(res.data);
    } catch (e) {
      console.error("Failed to fetch library", e);
    }
  };

  useEffect(() => {
    fetchLibrary();
    
    // Check if a job is currently running on the server
    axios.get('https://biohack-video-gen-server-production.up.railway.app/api/status')
      .then(res => {
        if (res.data.isRunning) setLoading(true);
      })
      .catch(e => console.error("Failed to fetch status", e));

    const sse = new EventSource('https://biohack-video-gen-server-production.up.railway.app/api/logs');
    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      try {
        const parsedLog = JSON.parse(data.log);
        if (parsedLog.event === "complete") {
           setResult({
              title: parsedLog.title,
              description: parsedLog.description,
              tags: parsedLog.tags,
              videoUrl: `https://biohack-video-gen-server-production.up.railway.app${parsedLog.videoUrl}`
           });
           setLoading(false);
           fetchLibrary(); // Refresh library when a new video finishes!
           return;
        }
        if (parsedLog.event === "error") {
           alert("Generation failed: " + parsedLog.message);
           setLoading(false);
           fetchLibrary(); // Refresh library to show the failed job in history
           return;
        }
      } catch(err) {
        setLogs(prev => [...prev, data.log]);
      }
    };
    return () => sse.close();
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const generateIdea = async () => {
    setIdeaLoading(true);
    try {
      const res = await axios.post('https://biohack-video-gen-server-production.up.railway.app/api/idea', { 
        topic: topic,
        mainNiche: mainNiche,
        subNiche: subNiche
      });
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
    setLogs([]); // Clear previous logs
    setResult(null);
    try {
      await axios.post('https://biohack-video-gen-server-production.up.railway.app/api/generate', {
        durationMinutes: duration,
        format: format,
        topic: topic,
        mainNiche: mainNiche,
        subNiche: subNiche,
        visualSource: visualSource,
        customTitle: customTitle,
        customDescription: customDescription
      });
      // Generation continues in the background. Result is set via SSE 'complete' event.
    } catch (error) {
      console.error('Error generating video:', error);
      alert('Failed to start video generation. Check console for details.');
      setLoading(false);
    }
  };

  const cancelGeneration = async () => {
    try {
      await axios.post('https://biohack-video-gen-server-production.up.railway.app/api/cancel');
      setLoading(false);
    } catch (error) {
      console.error('Error cancelling video:', error);
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', gap: '2rem', maxWidth: '1400px', margin: '0 auto', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 70%', minWidth: 0 }}>
        <div className="glass-card">
          <div className="header">
            <h1 className="title">NeuroGen Studio</h1>
            <p className="subtitle">AI Biohacking & Neuroscience Video Creator</p>
          </div>

        <div className="form-group">
          <label className="label">Visual Source</label>
          <select 
            className="select" 
            value={visualSource} 
            onChange={(e) => setVisualSource(e.target.value)}
          >
            <option value="ai_images">AI Generated Cinematic Images (Replicate Flux)</option>
            <option value="stock_videos">Real Stock Footage (Pexels / Pixabay)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="label">Main Content Category</label>
          <select 
            className="select" 
            value={mainNiche} 
            onChange={(e) => {
              setMainNiche(e.target.value);
              setSubNiche(NICHES[e.target.value][0]); // Auto-update sub-niche
            }}
          >
            {Object.keys(NICHES).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="label">Specific Sub-Niche (Top 50 Worldwide Niches)</label>
          <select 
            className="select" 
            value={subNiche} 
            onChange={(e) => setSubNiche(e.target.value)}
          >
            {NICHES[mainNiche].map(sub => <option key={sub} value={sub}>{sub}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="label">Custom Topic / Specific Idea (Optional)</label>
          <input 
            className="input" 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={`e.g. A highly specific idea within ${subNiche} (or leave blank to brainstorm)`}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <button 
            className="btn" 
            onClick={generateIdea} 
            disabled={ideaLoading || loading}
            style={{ flex: 1, background: 'linear-gradient(135deg, #1e3a8a, #312e81)', padding: '0.8rem' }}
          >
            {ideaLoading ? <div className="loader"></div> : <Sparkles size={18} />}
            {ideaLoading ? ' Brainstorming...' : ' Generate Viral Idea First'}
          </button>
        </div>

        {(customTitle || customDescription) && (
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: '#cbd5e1', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Generated Idea (You can edit this)</h3>
            <div className="form-group">
              <label className="label">Viral Title</label>
              <input 
                className="input" 
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="label">Description / Concept</label>
              <textarea 
                className="input" 
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="label">Video Format</label>
          <select 
            className="select" 
            value={format} 
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="horizontal">YouTube Horizontal (Long Form)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="label">Target Duration (Minutes)</label>
          <input 
            type="number" 
            className="input" 
            min="1" 
            max="10" 
            value={duration} 
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
            <button 
            className="btn" 
            onClick={generateVideo} 
            disabled={loading}
            style={{ flex: 1 }}
            >
            {loading ? (
                <><div className="loader"></div> Generating Masterpiece...</>
            ) : (
                <><Play size={20} /> Generate Full Video</>
            )}
            </button>

            {loading && (
            <button 
                className="btn" 
                onClick={cancelGeneration}
                style={{ background: '#ef4444', color: '#fff', padding: '0 2rem' }}
            >
                Stop
            </button>
            )}
        </div>

        {/* Live Logs Terminal */}
        <div className="terminal-container" style={{ marginTop: '2rem', background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid #333' }}>
          <div className="terminal-header" style={{ background: '#111', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#888' }}>
            <Terminal size={14} /> Server Logs Live
          </div>
          <div className="terminal-body" style={{ padding: '1rem', height: '200px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem', color: '#0f0' }}>
            {logs.map((log, i) => (
              <div key={i} className="log-line" style={{ marginBottom: '0.25rem' }}>{`> ${log}`}</div>
            ))}
            {logs.length === 0 && <div style={{ color: '#555' }}>Waiting for logs...</div>}
            <div ref={logsEndRef} />
          </div>
        </div>

        {result && (
          <div className="result-card">
            <h2 className="result-title">{result.title}</h2>
            <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: '1.6' }}>{result.description}</p>
            
            <div className="tags">
              {result.tags.map((tag, i) => (
                <span key={i} className="tag">#{tag}</span>
              ))}
            </div>

            <div className="video-player" style={{ marginTop: '2rem', borderRadius: '16px', overflow: 'hidden', background: '#000', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <video 
                controls 
                width="100%" 
                src={result.videoUrl}
                style={{ display: 'block', maxHeight: '500px', width: '100%', objectFit: 'contain' }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
            
            <a 
              href={result.videoUrl} 
              download={`NeuroGen_${(result.title || 'Video').substring(0,20).replace(/[^a-z0-9]/gi, '_')}.mp4`}
              className="btn"
              style={{ marginTop: '2rem', padding: '1.25rem', fontSize: '1.1rem', background: 'linear-gradient(135deg, #10b981, #059669)', textDecoration: 'none' }}
              target="_blank"
              rel="noreferrer"
            >
              📥 Download Final Masterpiece (.mp4)
            </a>
          </div>
        )}
      </div>

      {/* Library Section */}
      <div style={{ marginTop: '4rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: '800', marginBottom: '2rem', textAlign: 'center', background: 'linear-gradient(135deg, #60a5fa, #c084fc)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          Saved & Generated Videos
        </h2>
        {libraryVideos.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {libraryVideos.map((video) => (
              <div key={video.id} className="result-card" style={{ marginTop: 0, border: video.status === 'error' ? '1px solid rgba(239, 68, 68, 0.3)' : undefined, background: video.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : undefined }}>
                <h2 className="result-title">
                  {video.status === 'error' ? '❌ ' : ''}{video.title}
                </h2>
                <p style={{ color: video.status === 'error' ? '#fca5a5' : '#cbd5e1', fontSize: '0.95rem', lineHeight: '1.6' }}>
                  {video.description}
                </p>
                
                {video.status !== 'error' && (
                  <>
                    <div className="tags" style={{ marginBottom: '1rem' }}>
                      {video.tags && video.tags.map((tag, i) => (
                        <span key={i} className="tag">#{tag}</span>
                      ))}
                    </div>

                    <div style={{ display: 'inline-block', background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 'bold', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                      🖼️ {video.imageCount || 'Multiple'} Unique AI Images Generated
                    </div>

                    <div className="video-player" style={{ marginTop: '2rem', borderRadius: '16px', overflow: 'hidden', background: '#000', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <video 
                        controls 
                        width="100%" 
                        src={`https://biohack-video-gen-server-production.up.railway.app${video.videoUrl}`}
                        style={{ display: 'block', maxHeight: '500px', width: '100%', objectFit: 'contain' }}
                      >
                      </video>
                    </div>
                    
                    <a 
                      href={`https://biohack-video-gen-server-production.up.railway.app${video.videoUrl}`} 
                      download={`NeuroGen_${(video.title || 'Video').substring(0,20).replace(/[^a-z0-9]/gi, '_')}.mp4`}
                      className="btn"
                      style={{ marginTop: '2rem', padding: '1.25rem', fontSize: '1.1rem', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', textDecoration: 'none' }}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📥 Download Video (.mp4)
                    </a>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#888', padding: '3rem', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.1)' }}>
            <Video size={48} style={{ margin: '0 auto 1rem', opacity: 0.5, display: 'block' }} />
            <p style={{ fontSize: '1.1rem' }}>No videos generated yet.</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.7 }}>Create your first masterpiece above, and it will appear here!</p>
          </div>
        )}
      </div>
      </div>

      {/* Analytics Sidebar */}
      <div style={{ flex: '1 1 30%', minWidth: '300px', position: 'sticky', top: '2rem' }}>
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', color: '#a855f7', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📊 Generation Stats
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem', maxHeight: '500px', overflowY: 'auto', paddingRight: '0.5rem' }}>
            {libraryVideos.map(vid => (
              <div key={vid.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {vid.status === 'error' ? '❌ ' : ''}{vid.title || 'Untitled Video'}
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: vid.status === 'error' ? '#ef4444' : '#10b981' }}>
                  {vid.status === 'error' ? 'Failed Generation' : `🖼️ ${vid.imageCount || '?'} Images`}
                </div>
              </div>
            ))}
            {libraryVideos.length === 0 && (
              <div style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>
                No stats available yet.
              </div>
            )}
          </div>

          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>Total AI Images Made</div>
            <div style={{ fontSize: '3rem', fontWeight: '900', color: '#fff', textShadow: '0 0 20px rgba(168, 85, 247, 0.4)' }}>
              {libraryVideos.reduce((acc, v) => acc + (v.imageCount || 0), 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
