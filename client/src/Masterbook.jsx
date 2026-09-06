import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  BookOpen, Search, Sparkles, Check, ChevronDown, ChevronUp, 
  ExternalLink, Layers, Target, ShieldCheck, Zap, Youtube, 
  ArrowRight, Info, Award, HelpCircle, SlidersHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import archetypes from './channelArchetypes.json';
import nichesData from './niches.json';

const CATEGORIES = [
  'All',
  'Health & Longevity',
  'Finance & Wealth',
  'Business & Crime',
  'Disasters & Engineering',
  'Science & Nature',
  'Mindset & Psychology',
  'Animals & Pets',
  'Lifestyle & Travel',
  'Tech & Future'
];

export default function Masterbook({ baseUrl, toast }) {
  const [channels, setChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeTab, setActiveTab] = useState('archetypes'); // 'archetypes' | 'encyclopedia'
  const [expandedNiches, setExpandedNiches] = useState({});
  const [launchingId, setLaunchingId] = useState(null);

  useEffect(() => {
    fetchChannels();
  }, [baseUrl]);

  const fetchChannels = async () => {
    try {
      const res = await axios.get(`${baseUrl}/api/youtube/channels`);
      setChannels(res.data);
      if (res.data.length > 0) {
        setSelectedChannelId(res.data[0].channelId);
      }
    } catch {
      // Non-blocking if channels endpoint fails
    }
  };

  const toggleNicheAccordion = (nicheName) => {
    setExpandedNiches(prev => ({
      ...prev,
      [nicheName]: !prev[nicheName]
    }));
  };

  const handleApplyArchetype = async (archetype) => {
    if (!selectedChannelId) {
      toast('Please connect a YouTube channel on the Channels tab first!', 'error');
      return;
    }

    const channel = channels.find(c => c.channelId === selectedChannelId);
    setLaunchingId(archetype.id);

    try {
      await axios.post(`${baseUrl}/api/youtube/channels/${selectedChannelId}/niches`, {
        niches: [archetype.masterNiche],
        subNiches: { [archetype.masterNiche]: archetype.subNiches },
        preferredFormat: archetype.format
      });

      toast(`🎉 Configured ${channel?.channelName || 'channel'} for "${archetype.channelName}"!`, 'success');
      fetchChannels();
    } catch {
      toast('Failed to apply channel configuration.', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleApplyFullNiche = async (nicheName, subNiches) => {
    if (!selectedChannelId) {
      toast('Please connect a YouTube channel on the Channels tab first!', 'error');
      return;
    }

    const channel = channels.find(c => c.channelId === selectedChannelId);
    setLaunchingId(nicheName);

    try {
      await axios.post(`${baseUrl}/api/youtube/channels/${selectedChannelId}/niches`, {
        niches: [nicheName],
        subNiches: { [nicheName]: [] }, // empty = auto-rotate all 15
        preferredFormat: 'both'
      });

      toast(`🎉 Mapped "${nicheName}" to ${channel?.channelName || 'channel'} with full 15-topic auto-rotation!`, 'success');
      fetchChannels();
    } catch {
      toast('Failed to apply master niche.', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  // Filter Archetypes
  const filteredArchetypes = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return archetypes.filter(item => {
      const matchesCat = selectedCategory === 'All' || item.category === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;

      const inName = item.channelName.toLowerCase().includes(q);
      const inTagline = item.tagline.toLowerCase().includes(q);
      const inAudience = item.targetAudience.toLowerCase().includes(q);
      const inModels = item.modelChannels.toLowerCase().includes(q);
      const inSubNiches = item.subNiches.some(s => s.toLowerCase().includes(q));
      const inNiche = item.masterNiche.toLowerCase().includes(q);
      const inNames = item.nameIdeas.some(n => n.toLowerCase().includes(q));
      const inTitles = item.sampleTitles.some(t => t.toLowerCase().includes(q));

      return inName || inTagline || inAudience || inModels || inSubNiches || inNiche || inNames || inTitles;
    });
  }, [searchQuery, selectedCategory]);

  // Filter Encyclopedia Master Niches
  const allMasterNiches = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return Object.entries(nichesData)
      .filter(([key]) => !key.startsWith('_'))
      .map(([name, data]) => ({
        name,
        cleanName: name.replace('⭐ ', ''),
        isStar: name.startsWith('⭐'),
        description: data.description || '',
        subNiches: data.subNiches || []
      }))
      .filter(item => {
        if (!q) return true;
        const inName = item.name.toLowerCase().includes(q);
        const inDesc = item.description.toLowerCase().includes(q);
        const inSub = item.subNiches.some(s => s.toLowerCase().includes(q));
        return inName || inDesc || inSub;
      });
  }, [searchQuery]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="page-content masterbook-page"
      style={{ maxWidth: '1400px', margin: '0 auto', paddingBottom: '60px' }}
    >
      {/* ── HEADER BANNER ────────────────────────────────────────── */}
      <div 
        className="glass-card" 
        style={{ 
          padding: '32px', 
          borderRadius: '20px', 
          marginBottom: '28px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.05) 50%, rgba(0, 0, 0, 0.4) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ maxWidth: '850px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', color: '#818cf8', fontSize: '0.85rem', fontWeight: 600, marginBottom: '14px' }}>
              <BookOpen size={16} /> Definitive Niche & Channel Masterbook
            </div>
            <h1 style={{ fontSize: '2.4rem', fontWeight: 800, margin: '0 0 12px', letterSpacing: '-0.5px' }}>
              How to Build Any Faceless YouTube Channel
            </h1>
            <p style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0 }}>
              Never wonder what kind of channel you can build again. 
              Discover <strong>proven channel archetypes</strong>, exact micro-niche formulas, demographic breakdowns, and CPM benchmarks—then launch any channel on your connected YouTube account with <strong>1 click</strong>.
            </p>
          </div>

          {/* Connected Channel Quick Selector */}
          {channels.length > 0 ? (
            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '16px 20px', borderRadius: '14px', border: '1px solid var(--border)', minWidth: '280px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Youtube size={16} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Target Channel for 1-Click Launch:
                </span>
              </div>
              <select 
                value={selectedChannelId} 
                onChange={(e) => setSelectedChannelId(e.target.value)}
                style={{ 
                  width: '100%', 
                  background: 'var(--bg-surface)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px', 
                  color: 'var(--text)', 
                  padding: '8px 12px', 
                  fontSize: '0.9rem', 
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {channels.map(c => (
                  <option key={c.channelId} value={c.channelId}>{c.channelName}</option>
                ))}
              </select>
              <div style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={12} /> Connected & ready to auto-configure
              </div>
            </div>
          ) : (
            <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', padding: '14px 18px', borderRadius: '12px', maxWidth: '300px' }}>
              <span style={{ fontSize: '0.85rem', color: '#facc15', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Info size={16} /> No Channels Connected
              </span>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Connect a channel in the <strong>Channels</strong> tab to launch these blueprints with 1 click.
              </p>
            </div>
          )}
        </div>

        {/* Search & Tabs Controls */}
        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px' }}>
          {/* Main View Toggle */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setActiveTab('archetypes')}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'archetypes' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'archetypes' ? '#fff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
            >
              <Sparkles size={16} /> 20+ Channel Blueprints & Formulas
            </button>
            <button
              onClick={() => setActiveTab('encyclopedia')}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'encyclopedia' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'encyclopedia' ? '#fff' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
            >
              <BookOpen size={16} /> 20 Master Niches Directory (300 Topics)
            </button>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', minWidth: '320px', flex: '1', maxWidth: '450px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search e.g. elderly, scam, luxury, ocean, stoic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px 10px 40px',
                borderRadius: '10px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Category Pills (Archetypes tab only) */}
        {activeTab === 'archetypes' && (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingTop: '16px', paddingBottom: '4px' }} className="custom-scrollbar">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: selectedCategory === cat ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: selectedCategory === cat ? 'var(--primary-soft)' : 'rgba(0,0,0,0.2)',
                  color: selectedCategory === cat ? 'var(--primary)' : 'var(--text-secondary)',
                  transition: 'all 0.15s'
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── TAB 1: CHANNEL ARCHETYPES & FORMULAS ─────────────────── */}
      {activeTab === 'archetypes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Showing <strong>{filteredArchetypes.length}</strong> channel blueprints
              {selectedCategory !== 'All' && ` in "${selectedCategory}"`}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: '24px' }}>
            {filteredArchetypes.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '24px',
                  borderRadius: '16px',
                  border: '1px solid var(--border)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div>
                  {/* Card Header: Icon, Name & CPM */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{ fontSize: '2rem', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '12px', display: 'flex' }}>
                        {item.icon}
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 4px' }}>{item.channelName}</h3>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 600 }}>
                          {item.category}
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '4px 10px', borderRadius: '12px', border: '1px solid rgba(74, 222, 128, 0.25)', display: 'inline-block' }}>
                        CPM: {item.cpm}
                      </span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: '0 0 16px' }}>
                    {item.tagline}
                  </p>

                  {/* Benchmark Channel & Format Mode */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '0.78rem' }}>
                    <span style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)', color: 'var(--text)' }}>
                      👀 <strong>Like:</strong> {item.modelChannels}
                    </span>
                    <span style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)', color: 'var(--text)' }}>
                      {item.formatLabel}
                    </span>
                  </div>

                  {/* Master Niche & Sub-Niches Formula */}
                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Layers size={14} style={{ color: 'var(--primary)' }} />
                      The Exact Topic Formula:
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
                      Base Niche: <span style={{ color: 'var(--primary)' }}>{item.masterNiche}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {item.subNiches.map(sub => (
                        <span 
                          key={sub}
                          style={{
                            fontSize: '0.75rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)'
                          }}
                        >
                          ✓ {sub}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Audience Breakdown */}
                  <div style={{ marginBottom: '14px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Target Demographic:
                    </span>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: '1.4' }}>
                      {item.targetAudience}
                    </p>
                  </div>

                  {/* Sample Video Titles */}
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Viral Video Formulas:
                    </span>
                    <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '0.8rem', color: 'var(--text)', lineHeight: '1.5' }}>
                      {item.sampleTitles.map(t => (
                        <li key={t} style={{ margin: '3px 0' }}>"{t}"</li>
                      ))}
                    </ul>
                  </div>

                  {/* Suggested Channel Names */}
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Ready-to-Use Channel Names:
                    </span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {item.nameIdeas.map(name => (
                        <span key={name} style={{ fontSize: '0.75rem', background: 'var(--primary-soft)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--primary-glow)', fontWeight: 600 }}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 1-Click Launch Button */}
                <button
                  onClick={() => handleApplyArchetype(item)}
                  disabled={launchingId === item.id || channels.length === 0}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: channels.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: channels.length === 0 ? 0.6 : 1
                  }}
                >
                  {launchingId === item.id ? (
                    'Configuring Channel...'
                  ) : (
                    <>
                      <Zap size={16} /> Launch on {channels.find(c => c.channelId === selectedChannelId)?.channelName || 'Channel'}
                    </>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 2: MASTER NICHES ENCYCLOPEDIA ─────────────────────── */}
      {activeTab === 'encyclopedia' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.3rem', margin: '0 0 6px' }}>
              The 20 Verified YouTube Automation Master Niches
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
              Every master niche below contains 15 curated, 100% Pexels/Pixabay stock-safe sub-topics (300 total). 
              Click any niche to inspect its full topic suite and apply it to your channel.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {allMasterNiches.map(niche => {
              const isExpanded = !!expandedNiches[niche.name];

              return (
                <div 
                  key={niche.name}
                  className="glass-card"
                  style={{
                    padding: '20px 24px',
                    borderRadius: '14px',
                    border: '1px solid var(--border)',
                    background: 'rgba(255, 255, 255, 0.02)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ flex: '1', minWidth: '280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <h4 style={{ fontSize: '1.2rem', margin: 0, fontWeight: 700 }}>{niche.name}</h4>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.25)', fontWeight: 600 }}>
                          100% Stock-Safe
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                          15 Sub-Topics
                        </span>
                      </div>
                      <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                        {niche.description}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        onClick={() => handleApplyFullNiche(niche.name, niche.subNiches)}
                        disabled={launchingId === niche.name || channels.length === 0}
                        className="btn-secondary"
                        style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Zap size={14} style={{ color: '#facc15' }} /> 
                        Auto-Rotate All 15 on {channels.find(c => c.channelId === selectedChannelId)?.channelName || 'Channel'}
                      </button>

                      <button
                        onClick={() => toggleNicheAccordion(niche.name)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: 'var(--text)',
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.85rem'
                        }}
                      >
                        {isExpanded ? (
                          <>Hide Topics <ChevronUp size={16} /></>
                        ) : (
                          <>View 15 Topics <ChevronDown size={16} /></>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Accordion Topics */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}
                      >
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px' }}>
                          Verified Sub-Topics for this Niche:
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                          {niche.subNiches.map((topic, idx) => (
                            <div
                              key={topic}
                              style={{
                                padding: '10px 14px',
                                background: 'rgba(0,0,0,0.3)',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.05)',
                                fontSize: '0.82rem',
                                color: 'var(--text)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                            >
                              <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.75rem', minWidth: '20px' }}>
                                #{idx + 1}
                              </span>
                              <span>{topic}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
