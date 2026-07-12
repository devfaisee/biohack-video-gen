import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Video, Terminal } from 'lucide-react';
import axios from 'axios';

function App() {
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(1);
  const [format, setFormat] = useState('horizontal');
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  useEffect(() => {
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
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const generateVideo = async () => {
    setLoading(true);
    setLogs([]); // Clear previous logs
    setResult(null);
    try {
      await axios.post('https://biohack-video-gen-server-production.up.railway.app/api/generate', {
        durationMinutes: duration,
        format: format
      });
      // Generation continues in the background. Result is set via SSE 'complete' event.
    } catch (error) {
      console.error('Error generating video:', error);
      alert('Failed to start video generation. Check console for details.');
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="glass-card">
        <div className="header">
          <h1 className="title">NeuroGen Studio</h1>
          <p className="subtitle">AI Biohacking & Neuroscience Video Creator</p>
        </div>

        <div className="form-group">
          <label className="label">Content Niche</label>
          <input 
            className="input" 
            value="Psychology, Neuroscience & Biohacking" 
            disabled 
          />
        </div>

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

        <button 
          className="btn" 
          onClick={generateVideo} 
          disabled={loading}
        >
          {loading ? (
            <><div className="loader"></div> Generating Masterpiece...</>
          ) : (
            <><Sparkles size={20} /> Find Idea & Generate</>
          )}
        </button>

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
          <div className="result-card" style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h2 className="result-title" style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{result.title}</h2>
            <p className="subtitle" style={{ color: '#94a3b8' }}>{result.description}</p>
            
            <div className="tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
              {result.tags.map((tag, i) => (
                <span key={i} className="tag" style={{ background: 'rgba(59,130,246,0.2)', color: '#93c5fd', padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.75rem' }}>#{tag}</span>
              ))}
            </div>

            <div className="video-player" style={{ marginTop: '1.5rem', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
              <video 
                controls 
                width="100%" 
                src={result.videoUrl}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
