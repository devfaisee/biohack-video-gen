import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Youtube, Trash2, Check, ExternalLink, Search, ShieldCheck, AlertCircle, Plus, X } from 'lucide-react';
import { motion } from 'framer-motion';
import nichesData from './niches.json';

const allNiches = Object.keys(nichesData).map(n => n.replace('⭐ ', ''));

export default function Channels({ baseUrl, toast }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQueries, setSearchQueries] = useState({}); 

  useEffect(() => {
    fetchChannels();
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      toast('YouTube Channel connected successfully!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname + '#/channels');
    }
    if (params.get('error')) {
      toast('Failed to connect YouTube channel.', 'error');
      window.history.replaceState({}, document.title, window.location.pathname + '#/channels');
    }
  }, [baseUrl, toast]);

  const fetchChannels = async () => {
    try {
      const res = await axios.get(`${baseUrl}/api/youtube/channels`);
      setChannels(res.data);
    } catch {
      toast('Failed to load channels.', 'error');
    }
    setLoading(false);
  };

  const handleConnect = async () => {
    try {
      const res = await axios.get(`${baseUrl}/api/youtube/auth`);
      window.location.href = res.data.url;
    } catch {
      toast('Failed to get auth URL.', 'error');
    }
  };

  const handleDisconnect = async (id) => {
    if (!window.confirm("Are you sure you want to disconnect this channel? Auto-uploads for mapped niches will stop.")) return;
    try {
      await axios.delete(`${baseUrl}/api/youtube/channels/${id}`);
      setChannels(channels.filter(c => c.channelId !== id));
      toast('Channel disconnected.', 'success');
    } catch {
      toast('Failed to disconnect channel.', 'error');
    }
  };

  const toggleNiche = async (channelId, niche, currentMapped) => {
    const rawNiche = Object.keys(nichesData).find(n => n.replace('⭐ ', '') === niche) || niche;
    const newMapped = currentMapped.includes(rawNiche)
      ? currentMapped.filter(n => n !== rawNiche)
      : [...currentMapped, rawNiche];
    
    setChannels(channels.map(c => c.channelId === channelId ? { ...c, mappedNiches: newMapped } : c));
    
    try {
      await axios.post(`${baseUrl}/api/youtube/channels/${channelId}/niches`, { niches: newMapped });
    } catch {
      toast('Failed to update mapped niches.', 'error');
      setChannels(channels.map(c => c.channelId === channelId ? { ...c, mappedNiches: currentMapped } : c));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content channels-page">
      <div className="channels-header">
        <div className="channels-header-text">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.8rem', marginBottom: '8px' }}>
            <div className="icon-wrap" style={{ background: 'var(--primary-soft)', padding: '8px', borderRadius: '8px', display: 'flex' }}>
              <Youtube size={24} style={{ color: 'var(--primary)' }} />
            </div>
            Auto-Publish Pipelines
          </h2>
          <p className="text-muted" style={{ maxWidth: '700px', lineHeight: '1.6' }}>
            Link your YouTube channels and map them to specific niches. When a video finishes generating, it will automatically bypass your local drive and upload directly to the mapped channel as Private.
          </p>
        </div>
        <button onClick={handleConnect} className="btn-primary channels-connect-btn" style={{ padding: '10px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Plus size={18} /> Connect Channel
        </button>
      </div>

      {loading ? (
        <div className="loading-spinner" style={{ margin: '100px auto', width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      ) : channels.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card empty-channels"
          style={{ textAlign: 'center', padding: '60px 20px', maxWidth: '600px', margin: '40px auto' }}
        >
          <div className="empty-icon-wrap" style={{ display: 'inline-flex', background: 'var(--bg-surface)', padding: '20px', borderRadius: '20px', marginBottom: '24px' }}>
            <Youtube size={48} style={{ color: 'var(--text-secondary)' }} />
          </div>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>No Channels Connected</h3>
          <p className="text-muted" style={{ marginBottom: '32px' }}>Build your automated YouTube empire. Connect your first channel to start mapping niches for hands-off publishing.</p>
          <button onClick={handleConnect} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Youtube size={18} /> Authenticate via Google
          </button>
        </motion.div>
      ) : (
        <div className="channels-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))', gap: '24px', marginTop: '32px' }}>
          {channels.map((channel, i) => {
            const sq = (searchQueries[channel.channelId] || '').toLowerCase();
            const rawMapped = channel.mappedNiches || [];
            const mappedClean = rawMapped.map(n => n.replace('⭐ ', ''));
            
            const filteredNiches = allNiches.filter(n => n.toLowerCase().includes(sq));
            const mappedFiltered = filteredNiches.filter(n => mappedClean.includes(n));
            const unmappedFiltered = filteredNiches.filter(n => !mappedClean.includes(n));

            return (
              <motion.div 
                key={channel.channelId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card channel-card"
                style={{ display: 'flex', flexDirection: 'col', height: '600px', padding: 0, overflow: 'hidden' }}
              >
                <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      {channel.channelAvatar ? (
                        <div style={{ position: 'relative' }}>
                          <img src={channel.channelAvatar} alt={channel.channelName} style={{ width: '56px', height: '56px', borderRadius: '50%', border: '2px solid var(--primary-glow)' }} />
                          <div style={{ position: 'absolute', bottom: '-4px', right: '-4px', background: 'var(--success)', borderRadius: '50%', padding: '2px', border: '2px solid var(--bg-elevated)' }}>
                            <ShieldCheck size={12} color="#000" />
                          </div>
                        </div>
                      ) : (
                        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Youtube size={24} style={{ color: 'var(--primary)' }} />
                        </div>
                      )}
                      <div>
                        <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {channel.channelName}
                        </h3>
                        <a href={`https://youtube.com/channel/${channel.channelId}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                          View on YouTube <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                    <button onClick={() => handleDisconnect(channel.channelId)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '8px', borderRadius: '8px' }} title="Disconnect Channel">
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    {mappedClean.length > 0 ? (
                      <>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 10px var(--success)' }}></div>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Automating <strong>{mappedClean.length}</strong> niches</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
                        <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>No niches mapped. Auto-upload paused.</span>
                      </>
                    )}
                  </div>
                </div>
                
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
                  <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input 
                      type="text" 
                      placeholder="Search niches to map..." 
                      value={searchQueries[channel.channelId] || ''}
                      onChange={(e) => setSearchQueries({...searchQueries, [channel.channelId]: e.target.value})}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 10px 10px 36px', color: 'var(--text)', outline: 'none' }}
                    />
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }} className="custom-scrollbar">
                    {mappedFiltered.length > 0 && (
                      <div style={{ marginBottom: '24px' }}>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)' }}></div> Active Automations
                        </h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {mappedFiltered.map(niche => (
                            <button
                              key={niche}
                              onClick={() => toggleNiche(channel.channelId, niche, rawMapped)}
                              style={{ fontSize: '0.85rem', padding: '6px 12px', borderRadius: '20px', background: 'var(--primary-soft)', border: '1px solid var(--primary-glow)', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                            >
                              {niche} <X size={14} style={{ opacity: 0.6 }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {unmappedFiltered.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Available Niches</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {unmappedFiltered.map(niche => (
                            <button
                              key={niche}
                              onClick={() => toggleNiche(channel.channelId, niche, rawMapped)}
                              style={{ fontSize: '0.85rem', padding: '6px 12px', borderRadius: '20px', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                            >
                              <Plus size={14} style={{ opacity: 0.5 }} /> {niche}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {filteredNiches.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        No niches found matching "{sq}"
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
