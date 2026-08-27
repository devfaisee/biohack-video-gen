import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Youtube, Trash2, Check, ExternalLink, Search, ShieldCheck, AlertCircle, Plus, X, Video } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <div className="p-2 bg-brand/10 rounded-lg">
              <Youtube size={24} className="text-brand" />
            </div>
            Auto-Publish Pipelines
          </h2>
          <p className="text-gray-400 max-w-2xl text-sm leading-relaxed">
            Link your YouTube channels and map them to specific niches. When a video finishes generating, it will automatically bypass your local drive and upload directly to the mapped channel as Private.
          </p>
        </div>
        <button onClick={handleConnect} className="btn-primary flex items-center gap-2 whitespace-nowrap shadow-[0_0_20px_rgba(255,215,0,0.3)] hover:shadow-[0_0_30px_rgba(255,215,0,0.5)] transition-all">
          <Plus size={18} /> Connect Channel
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-32">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand"></div>
        </div>
      ) : channels.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative overflow-hidden rounded-2xl border border-white/10 bg-darker/50 backdrop-blur-sm p-12 text-center"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand/5 rounded-full blur-[100px] pointer-events-none" />
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 shadow-2xl">
              <Youtube size={40} className="text-gray-400" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-3">No Channels Connected</h3>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Build your automated YouTube empire. Connect your first channel to start mapping niches for hands-off publishing.
            </p>
            <button onClick={handleConnect} className="btn-primary inline-flex items-center gap-2">
              <Youtube size={18} /> Authenticate via Google
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                className="bg-darker/80 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden flex flex-col h-[600px] shadow-2xl"
              >
                <div className="p-6 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {channel.channelAvatar ? (
                        <div className="relative">
                          <img src={channel.channelAvatar} alt={channel.channelName} className="w-14 h-14 rounded-full border-2 border-brand/50 shadow-[0_0_15px_rgba(255,215,0,0.2)]" />
                          <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-0.5 border-2 border-darker">
                            <ShieldCheck size={12} className="text-darker" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-brand/20 border border-brand/50 flex items-center justify-center">
                          <Youtube size={24} className="text-brand" />
                        </div>
                      )}
                      <div>
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                          {channel.channelName}
                        </h3>
                        <a href={`https://youtube.com/channel/${channel.channelId}`} target="_blank" rel="noreferrer" className="text-sm text-gray-400 hover:text-brand transition-colors flex items-center gap-1 mt-1">
                          View on YouTube <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDisconnect(channel.channelId)} 
                      className="text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all p-2 rounded-lg" 
                      title="Disconnect Channel"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <div className="mt-5 flex items-center gap-3 bg-black/30 rounded-lg p-3 border border-white/5">
                    {mappedClean.length > 0 ? (
                      <>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm text-gray-300">Automating <strong>{mappedClean.length}</strong> niches</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={14} className="text-amber-500" />
                        <span className="text-sm text-amber-500/80">No niches mapped. Auto-upload paused.</span>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col p-6 overflow-hidden">
                  <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input 
                      type="text" 
                      placeholder="Search niches to map..." 
                      value={searchQueries[channel.channelId] || ''}
                      onChange={(e) => setSearchQueries({...searchQueries, [channel.channelId]: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:border-brand focus:outline-none transition-colors placeholder:text-gray-600"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                    {mappedFiltered.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-brand" />
                          Active Automations
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {mappedFiltered.map(niche => (
                            <button
                              key={niche}
                              onClick={() => toggleNiche(channel.channelId, niche, rawMapped)}
                              className="group text-sm px-3 py-1.5 rounded-full bg-brand/10 border border-brand/50 text-brand hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400 transition-all flex items-center gap-2 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                            >
                              {niche}
                              <X size={14} className="opacity-50 group-hover:opacity-100" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {unmappedFiltered.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Available Niches</h4>
                        <div className="flex flex-wrap gap-2">
                          {unmappedFiltered.map(niche => (
                            <button
                              key={niche}
                              onClick={() => toggleNiche(channel.channelId, niche, rawMapped)}
                              className="text-sm px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white hover:border-white/30 transition-all flex items-center gap-1"
                            >
                              <Plus size={14} className="opacity-50" />
                              {niche}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {filteredNiches.length === 0 && (
                      <div className="text-center py-10 text-gray-500 text-sm">
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
