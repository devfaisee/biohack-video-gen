import React, { useState } from 'react';
import { Sparkles, Play, Video } from 'lucide-react';
import axios from 'axios';

function App() {
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(1);
  const [format, setFormat] = useState('horizontal');
  const [result, setResult] = useState(null);

  const generateVideo = async () => {
    setLoading(true);
    try {
      // Assuming backend runs on port 5000 locally
      const res = await axios.post('http://localhost:5000/api/generate', {
        durationMinutes: duration,
        format: format
      });
      
      setResult({
        ...res.data,
        videoUrl: \`http://localhost:5000\${res.data.videoUrl}\`
      });
    } catch (error) {
      console.error('Error generating video:', error);
      alert('Failed to generate video. Check console for details.');
    } finally {
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

        {result && (
          <div className="result-card">
            <h2 className="result-title">{result.title}</h2>
            <p className="subtitle">{result.description}</p>
            
            <div className="tags">
              {result.tags.map((tag, i) => (
                <span key={i} className="tag">#{tag}</span>
              ))}
            </div>

            <div className="video-player">
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
