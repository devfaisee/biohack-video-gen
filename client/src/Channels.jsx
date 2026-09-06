import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Youtube, Trash2, Check, ExternalLink, Search, ShieldCheck, AlertCircle, Plus, X, ChevronDown, ChevronUp, RefreshCw, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import nichesData from './niches.json';

const allNicheEntries = Object.entries(nichesData)
  .filter(([k]) => !k.startsWith('_'))
  .map(([fullName, data]) => ({
    fullName,
    cleanName: fullName.replace('⭐ ', ''),
    description: data.description || '',
    subNiches: data.subNiches || []
  }));

export default function Channels({ baseUrl, toast }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQueries, setSearchQueries] = useState({});
  const [expandedNiche, setExpandedNiche] = useState({});

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

  const updateMapping = async (channelId, newMappedNiches, newMappedSubNiches, newPreferredFormat) => {
    const channel = channels.find(c => c.channelId === channelId);
    const format = newPreferredFormat !== undefined ? newPreferredFormat : (channel?.preferredFormat || 'both');

    setChannels(prev => prev.map(c => c.channelId === channelId ? {
      ...c,
      mappedNiches: newMappedNiches,
      mappedSubNiches: newMappedSubNiches,
      preferredFormat: format
    } : c));

    try {
      await axios.post(`${baseUrl}/api/youtube/channels/${channelId}/niches`, {
        niches: newMappedNiches,
        subNiches: newMappedSubNiches,
        preferredFormat: format
      });
      toast('Channel automation settings updated!', 'success');
    } catch {
      toast('Failed to update channel mapping.', 'error');
      fetchChannels();
    }
  };

  const toggleNiche = (channelId, rawNiche) => {
    const channel = channels.find(c => c.channelId === channelId);
    if (!channel) return;

    const currentMapped = channel.mappedNiches || [];
    const currentSubs = { ...(channel.mappedSubNiches || {}) };

    let newMapped;
    if (currentMapped.includes(rawNiche)) {
      newMapped = currentMapped.filter(n => n !== rawNiche);
      delete currentSubs[rawNiche];
    } else {
      newMapped = [...currentMapped, rawNiche];
      currentSubs[rawNiche] = [];
    }

    updateMapping(channelId, newMapped, currentSubs);
  };

  const toggleSubNiche = (channelId, nicheName, subNicheName) => {
    const channel = channels.find(c => c.channelId === channelId);
    if (!channel) return;

    const currentSubs = { ...(channel.mappedSubNiches || {}) };
    const currentList = currentSubs[nicheName] || [];

    const newList = currentList.includes(subNicheName)
      ? currentList.filter(s => s !== subNicheName)
      : [...currentList, subNicheName];

    currentSubs[nicheName] = newList;
    updateMapping(channelId, channel.mappedNiches || [], currentSubs);
  };

  const setAutoRotateAll = (channelId, nicheName) => {
    const channel = channels.find(c => c.channelId === channelId);
    if (!channel) return;

    const currentSubs = { ...(channel.mappedSubNiches || {}) };
    currentSubs[nicheName] = [];
    updateMapping(channelId, channel.mappedNiches || [], currentSubs);
  };

  const toggleAccordion = (channelId, nicheName) => {
    const key = `${channelId}_${nicheName}`;
    setExpandedNiche(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content channels-page">
      <div className="channels-header" style={{ marginBottom: '24px' }}>
        <div className="channels-header-text">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.8rem', marginBottom: '8px' }}>
            <div className="icon-wrap" style={{ background: 'var(--primary-soft)', padding: '8px', borderRadius: '8px', display: 'flex' }}>
              <Youtube size={24} style={{ color: 'var(--primary)' }} />
            </div>
            Channel Automation & Niche Mapping
          </h2>
          <p className="text-muted" style={{ maxWidth: '750px', lineHeight: '1.6', fontSize: '0.95rem' }}>
            Map your connected YouTube channels to specific master niches and sub-topics. 
            Choose whether to <strong>lock a channel to specific topics</strong> (e.g. Senior Health only) or let it <strong>auto-rotate through all topics</strong> with our 14-day de-duplication engine.
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
          <p className="text-muted" style={{ marginBottom: '32px' }}>Connect your YouTube channel to start mapping specific niches and hands-off automated publishing.</p>
          <button onClick={handleConnect} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Youtube size={18} /> Authenticate via Google
          </button>
        </motion.div>
      ) : (
        <div className="channels-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(500px, 1fr))', gap: '28px' }}>
          {channels.map((channel, i) => {
            const sq = (searchQueries[channel.channelId] || '').toLowerCase();
            const rawMapped = channel.mappedNiches || [];
            const subMap = channel.mappedSubNiches || {};

            const matchingNiches = allNicheEntries.filter(entry => {
              if (!sq) return true;
              const matchesName = entry.cleanName.toLowerCase().includes(sq);
              const matchesDesc = entry.description.toLowerCase().includes(sq);
              const matchesSub = entry.subNiches.some(s => s.toLowerCase().includes(sq));
              return matchesName || matchesDesc || matchesSub;
            });

            const mappedList = matchingNiches.filter(entry => rawMapped.includes(entry.fullName));
            const availableList = matchingNiches.filter(entry => !rawMapped.includes(entry.fullName));

            return (
              <motion.div 
                key={channel.channelId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card channel-card"
                style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRadius: '16px' }}
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
                        <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
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

                  <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    {rawMapped.length > 0 ? (
                      <>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 10px var(--success)' }}></div>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                          Auto-running <strong>{rawMapped.length}</strong> master niche{rawMapped.length > 1 ? 's' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
                        <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>No niches mapped. Auto-upload is paused.</span>
                      </>
                    )}
                  </div>

                  {/* Format Preference Selector */}
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Format Mode:
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { id: 'both', label: '🔀 Both (Balanced)' },
                        { id: 'shorts_only', label: '📱 Shorts Only' },
                        { id: 'longs_only', label: '🖥️ Longs Only' }
                      ].map(f => {
                        const active = (channel.preferredFormat || 'both') === f.id;
                        return (
                          <button
                            key={f.id}
                            onClick={() => updateMapping(channel.channelId, channel.mappedNiches || [], channel.mappedSubNiches || {}, f.id)}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              borderRadius: '6px',
                              border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                              background: active ? 'var(--primary-soft)' : 'transparent',
                              color: active ? 'var(--primary)' : 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontWeight: active ? 600 : 400,
                              transition: 'all 0.2s'
                            }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input 
                      type="text" 
                      placeholder="Search niches or sub-topics (e.g. 'elderly', 'scams', 'investing')..." 
                      value={searchQueries[channel.channelId] || ''}
                      onChange={(e) => setSearchQueries({...searchQueries, [channel.channelId]: e.target.value})}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 10px 10px 36px', color: 'var(--text)', outline: 'none', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Target size={14} /> Active Channel Niches & Topic Targeting
                    </h4>

                    {mappedList.length === 0 ? (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', margin: '8px 0' }}>
                        No niches active yet. Click an available niche below to start automating this channel.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {mappedList.map(entry => {
                          const selectedSubs = subMap[entry.fullName] || [];
                          const isCustom = selectedSubs.length > 0;
                          const isExpanded = !!expandedNiche[`${channel.channelId}_${entry.fullName}`];

                          return (
                            <div 
                              key={entry.fullName}
                              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}
                            >
                              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>
                                      {entry.fullName}
                                    </span>
                                    {isCustom ? (
                                      <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(0, 200, 255, 0.15)', color: '#00d0ff', border: '1px solid rgba(0,200,255,0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Target size={11} /> Locked to {selectedSubs.length} topic{selectedSubs.length > 1 ? 's' : ''}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(50, 205, 50, 0.15)', color: '#4ade80', border: '1px solid rgba(50,205,50,0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <RefreshCw size={11} /> Auto-Rotating All 15 Topics
                                      </span>
                                    )}
                                  </div>
                                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: '1.4' }}>
                                    {entry.description}
                                  </p>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <button
                                    onClick={() => toggleAccordion(channel.channelId, entry.fullName)}
                                    className="btn-secondary"
                                    style={{ padding: '6px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    title="Choose specific sub-topics"
                                  >
                                    Topics {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </button>
                                  <button
                                    onClick={() => toggleNiche(channel.channelId, entry.fullName)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px' }}
                                    title="Remove niche"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>

                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.25)', padding: '16px' }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        Select sub-topics to focus this channel (or leave all unselected to auto-rotate all 15):
                                      </span>
                                      {isCustom && (
                                        <button 
                                          onClick={() => setAutoRotateAll(channel.channelId, entry.fullName)}
                                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                                        >
                                          Reset to Auto-Rotate All
                                        </button>
                                      )}
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                                      {entry.subNiches.map(sub => {
                                        const isSelected = selectedSubs.includes(sub);
                                        return (
                                          <button
                                            key={sub}
                                            onClick={() => toggleSubNiche(channel.channelId, entry.fullName, sub)}
                                            style={{
                                              textAlign: 'left',
                                              padding: '8px 10px',
                                              fontSize: '0.8rem',
                                              borderRadius: '6px',
                                              cursor: 'pointer',
                                              border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                                              background: isSelected ? 'var(--primary-soft)' : 'rgba(255,255,255,0.02)',
                                              color: isSelected ? 'var(--primary)' : 'var(--text)',
                                              display: 'flex',
                                              alignItems: 'flex-start',
                                              gap: '6px',
                                              lineHeight: '1.3'
                                            }}
                                          >
                                            <div style={{ minWidth: '14px', height: '14px', borderRadius: '3px', border: isSelected ? '1px solid var(--primary)' : '1px solid var(--text-secondary)', background: isSelected ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px' }}>
                                              {isSelected && <Check size={10} color="#000" />}
                                            </div>
                                            <span>{sub}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {availableList.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                        Available Niches to Add ({availableList.length})
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }} className="custom-scrollbar">
                        {availableList.map(entry => (
                          <div
                            key={entry.fullName}
                            onClick={() => toggleNiche(channel.channelId, entry.fullName)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              transition: 'all 0.2s'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                                {entry.cleanName}
                              </span>
                              <Plus size={14} style={{ color: 'var(--primary)', opacity: 0.8 }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {entry.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {matchingNiches.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      No niches or sub-topics match "{sq}"
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
