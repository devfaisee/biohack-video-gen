import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  BookOpen, Search, Sparkles, Check, ChevronDown, ChevronUp, 
  ExternalLink, Layers, Target, ShieldCheck, Zap, Youtube, 
  ArrowRight, Info, Award, HelpCircle, SlidersHorizontal,
  Mic, Film, X, Cpu, Clock, RefreshCw, Eye
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
  'History & Civilization',
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
  const [inspectingArchetype, setInspectingArchetype] = useState(null);

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

  const getNicheEngineDetails = (masterNiche) => {
    const n = (masterNiche || '').toLowerCase();
    if (n.includes('crime') || n.includes('scam')) {
      return {
        voiceId: 'Algenib',
        voiceRole: 'Seasoned Financial Crime Investigator',
        voiceTone: 'Grave, measured, highly authoritative. Methodical suspense.',
        visualStyle: 'Moody chiaroscuro lighting, dark office archives, high-contrast evidence tables, volumetric light beams',
        pacing: '130 WPM documentary cadence, 5.0s dramatic cuts, tension build-up',
        titleFormula: 'THE INVESTIGATIVE FORENSIC: "The Math Behind [Famous Collapse / Ponzi Scheme]"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('military') || n.includes('defense')) {
      return {
        voiceId: 'Orus',
        voiceRole: 'Military Analyst & Strategic Defense Officer',
        voiceTone: 'Tactical, authoritative, precise, no-nonsense delivery.',
        visualStyle: 'High-speed 4K defense hardware, aerospace flight lines, carrier decks, tactical telemetry radar',
        pacing: '140 WPM briefing cadence, 2.2s cuts for Shorts, 5.0s tactical analysis for Longs',
        titleFormula: 'THE CRITICAL MOMENT: "Why the [Weapon/Unit] Is Still Undefeated in Modern Combat"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('space') || n.includes('astronomy') || n.includes('cosmos')) {
      return {
        voiceId: 'Charon',
        voiceRole: 'Epic Astronomical Documentary Narrator',
        voiceTone: 'Expansive, awe-inspiring, cosmic mystery and existential scale.',
        visualStyle: 'Deep black cosmic void, glowing nebulae, event horizons, Webb infrared imagery, photorealistic planetary surfaces',
        pacing: '130 WPM deliberate awe cadence, cosmic scale comparisons, sound design drones',
        titleFormula: 'THE SCIENTIFIC PARADOX: "What Scientists Found at the Edge of [Cosmic Entity]"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('ancient') || n.includes('history') || n.includes('civiliz')) {
      return {
        voiceId: 'Rasalgethi',
        voiceRole: 'Epic Historical Chronicler',
        voiceTone: 'Dramatic, grand, painting vast historical canvases.',
        visualStyle: 'Ancient stone ruins at dusk, torch-lit corridors, crumbling marble columns, cinematic historical maps',
        pacing: '135 WPM storytelling cadence, deep dramatic pauses, cause-and-effect narrative arc',
        titleFormula: 'THE CRITICAL MOMENT: "The [Specific Decision/Day] That Sacked [Empire]"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('engineering') || n.includes('architecture') || n.includes('geography')) {
      return {
        voiceId: 'Rasalgethi',
        voiceRole: 'Architectural & Megaproject Explorer',
        voiceTone: 'Cultured, reverent of design, deeply knowledgeable about colossal feats.',
        visualStyle: 'Mega-structures, high-angle drone sweeps, industrial construction cranes, subterranean tunnel boring machines',
        pacing: '135 WPM informative pace, engineering schematics, physical forces breakdown',
        titleFormula: 'THE INVESTIGATIVE FORENSIC: "The Insane Engineering Behind [Megaproject]"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('mystery') || n.includes('unsolved')) {
      return {
        voiceId: 'Charon',
        voiceRole: 'Enigmatic Cold-Case Investigator',
        voiceTone: 'Suspenseful, measured, deliberate pauses, conspiratorial undertone.',
        visualStyle: 'Foggy liminal landscapes, dark archives, flickering streetlamps, vintage microfilm files',
        pacing: '125 WPM suspense pacing, open loops, rhetorical cliffhangers',
        titleFormula: 'THE INVESTIGATIVE FORENSIC: "The Forensic Clues That Turn [Mystery] On Its Head"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('finance') || n.includes('wealth') || n.includes('real estate') || n.includes('corporate') || n.includes('rise')) {
      return {
        voiceId: 'Charon',
        voiceRole: 'Wall Street Insider & Corporate Historian',
        voiceTone: 'Sharp, authoritative, high-stakes financial insider delivery.',
        visualStyle: 'Skyscraper boardrooms at twilight, Wall Street trading terminals, luxury property estates, currency vaults',
        pacing: '135 WPM fast-paced insider pace, mathematical breakdowns, cognitive bias analysis',
        titleFormula: 'THE INFORMATION GAP: "How [Company/Entity] Quietly Monopolized [Market]"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('business') || n.includes('startup') || n.includes('fitness') || n.includes('self-improvement') || n.includes('productivity') || n.includes('luxury')) {
      return {
        voiceId: 'Puck',
        voiceRole: 'High-Performance Veteran Coach & Founder',
        voiceTone: 'Direct, commanding, battle-hardened, zero fluff.',
        visualStyle: 'Clean minimalist aesthetics, high-intensity athletic mechanics, glass startup penthouses, deep work setups',
        pacing: '150 WPM high-energy command, actionable mental models, immediate protocol delivery',
        titleFormula: 'THE SCIENTIFIC PARADOX: "Why 90% of [Audience] Fail at [Goal] (And How to Fix It)"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    if (n.includes('animal') || n.includes('pet') || n.includes('dog') || n.includes('nature') || n.includes('wildlife')) {
      return {
        voiceId: 'Achird',
        voiceRole: 'Warm BBC Earth Broadcaster & Animal Behaviorist',
        voiceTone: 'Warm, awestruck, deeply respectful of nature, David Attenborough style.',
        visualStyle: 'Golden-hour wildlife cinematography, macro predator close-ups, lush natural habitats, domestic pet warmth',
        pacing: '130 WPM warm cadence, biological adaptations, wonder facts at segment climaxes',
        titleFormula: 'THE BIOLOGICAL PARADOX: "The Hidden Animal Instinct That Mainstream Science Missed"',
        model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
        dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
      };
    }
    return {
      voiceId: 'Charon',
      voiceRole: 'Broadcast-Grade Documentary Narrator',
      voiceTone: 'Factual, authoritative, highly engaging investigative delivery.',
      visualStyle: 'Cinematic 35mm photography, volumetric lighting, deep shadows, 4K film still aesthetics',
      pacing: '130–155 WPM format-aware pace, rapid cuts on Shorts, rich story chapters on Longs',
      titleFormula: 'THE INFORMATION GAP: "The Real Story Behind [Subject] That Was Hidden for Years"',
      model: 'Google Gemini 3.1 Flash TTS + GPT-5.6-Luna + Flux 1.1 Pro 4K',
      dedupGuarantee: '50-Video Negative Title Memory + 14-Day Sub-Niche Rotational Pool'
    };
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
              <Sparkles size={16} /> 26 Channel Blueprints & Formulas
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
              <BookOpen size={16} /> 25 Master Niches Directory (375 Topics)
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

                {/* Action Buttons: 1-Click Launch + Inspect Engine */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={() => handleApplyArchetype(item)}
                    disabled={launchingId === item.id || channels.length === 0}
                    className="btn-primary"
                    style={{
                      flex: '1',
                      padding: '11px 14px',
                      borderRadius: '10px',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      cursor: channels.length === 0 ? 'not-allowed' : 'pointer',
                      opacity: channels.length === 0 ? 0.6 : 1
                    }}
                  >
                    {launchingId === item.id ? (
                      'Configuring Channel...'
                    ) : (
                      <>
                        <Zap size={15} /> Launch on {channels.find(c => c.channelId === selectedChannelId)?.channelName || 'Channel'}
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setInspectingArchetype(item)}
                    title="Inspect exact prompt rules, voice persona, and stock footage keywords"
                    style={{
                      padding: '11px 14px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.15s'
                    }}
                  >
                    <SlidersHorizontal size={14} /> AI Engine
                  </button>
                </div>
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
              The 25 Verified YouTube Automation Master Niches (375 Topics)
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
              Every master niche below contains 15 curated, 100% Pexels/Pixabay stock-safe sub-topics (375 total). 
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
      {/* ── INSPECT PROMPTING & AI ENGINE MODAL ────────────────── */}
      <AnimatePresence>
        {inspectingArchetype && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.82)',
              backdropFilter: 'blur(10px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}
            onClick={() => setInspectingArchetype(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card"
              style={{
                width: '100%',
                maxWidth: '820px',
                maxHeight: '90vh',
                overflowY: 'auto',
                borderRadius: '20px',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                background: '#0d1117',
                boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9)',
                padding: '32px'
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ fontSize: '2.4rem', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '14px' }}>
                    {inspectingArchetype.icon}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: 'var(--primary-soft)', color: 'var(--primary)', textTransform: 'uppercase' }}>
                        {inspectingArchetype.category}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(74, 222, 128, 0.25)' }}>
                        CPM: {inspectingArchetype.cpm}
                      </span>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>{inspectingArchetype.channelName}</h2>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Base Niche: <strong style={{ color: 'var(--primary)' }}>{inspectingArchetype.masterNiche}</strong>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setInspectingArchetype(null)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px' }}
                >
                  <X size={22} />
                </button>
              </div>

              {/* Engine Details Grid */}
              {(() => {
                const eng = getNicheEngineDetails(inspectingArchetype.masterNiche);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Voice Narrator Section */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <Mic size={16} style={{ color: '#818cf8' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                          AI Voice Narrator & TTS Persona:
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}>
                          Persona: {eng.voiceRole}
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.4)', fontWeight: 700 }}>
                          Voice ID: {eng.voiceId}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 6px', lineHeight: '1.4' }}>
                        {eng.voiceTone}
                      </p>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        Engine: <strong>Google Gemini 3.1 Flash TTS</strong> (en-US, 24kHz studio audio)
                      </div>
                    </div>

                    {/* Visual Style & Pexels Footage */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <Film size={16} style={{ color: '#38bdf8' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                          Visual Aesthetics & Stock Footage Engine:
                        </span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: '0 0 8px', lineHeight: '1.5' }}>
                        {eng.visualStyle}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                          Keywords: {inspectingArchetype.stockFootageKeywords}
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.25)' }}>
                          ✓ 100% Pexels & Pixabay Stock-Safe (YPP Approved)
                        </span>
                      </div>
                    </div>

                    {/* Title Formulas & Anti-Filler */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <Target size={16} style={{ color: '#f59e0b' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                          High-CTR Title Psychology & Anti-Filler Mandate:
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24', marginBottom: '6px' }}>
                        {eng.titleFormula}
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                        Scriptwriting powered by <strong>openai/gpt-5.6-luna</strong> with strict anti-filler enforcement: teaser phrases are banned, and every segment delivers concrete names, verified dates, and high-stakes facts.
                      </p>
                    </div>

                    {/* Lifetime Deduplication & Rotation */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <RefreshCw size={16} style={{ color: '#a855f7' }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                          Lifetime "Run For Years" Deduplication Architecture:
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c084fc', marginBottom: '6px' }}>
                        {eng.dedupGuarantee}
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>
                        Before writing, the model queries the last 50 video titles from this channel to strictly forbid repeats. Sub-niches rotate through a 14-day exhaustion pool so you can run the channel completely hands-free for years.
                      </p>
                    </div>

                    {/* Launch CTA */}
                    <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Target Channel:
                        </div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
                          {channels.find(c => c.channelId === selectedChannelId)?.channelName || 'No Channel Selected'}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          handleApplyArchetype(inspectingArchetype);
                          setInspectingArchetype(null);
                        }}
                        disabled={launchingId === inspectingArchetype.id || channels.length === 0}
                        className="btn-primary"
                        style={{ padding: '12px 24px', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <Zap size={18} /> Apply Blueprint & Activate Auto-Pilot
                      </button>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
