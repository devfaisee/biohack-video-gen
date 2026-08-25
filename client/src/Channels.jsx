import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Youtube, Trash2, Check, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import nichesData from './niches.json';

const allNiches = Object.keys(nichesData);

export default function Channels({ baseUrl, toast }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChannels();
    // Check url for success/error from OAuth redirect
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
    if (!window.confirm("Are you sure you want to disconnect this channel?")) return;
    try {
      await axios.delete(`${baseUrl}/api/youtube/channels/${id}`);
      setChannels(channels.filter(c => c.channelId !== id));
      toast('Channel disconnected.', 'success');
    } catch {
      toast('Failed to disconnect channel.', 'error');
    }
  };

  const toggleNiche = async (channelId, niche, currentMapped) => {
    const newMapped = currentMapped.includes(niche)
      ? currentMapped.filter(n => n !== niche)
      : [...currentMapped, niche];
    
    try {
      await axios.post(`${baseUrl}/api/youtube/channels/${channelId}/niches`, { niches: newMapped });
      setChannels(channels.map(c => c.channelId === channelId ? { ...c, mappedNiches: newMapped } : c));
    } catch {
      toast('Failed to update mapped niches.', 'error');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="page-content">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">YouTube Channels</h2>
          <p className="text-gray-400">Map different niches to specific YouTube channels for automatic uploading.</p>
        </div>
        <button onClick={handleConnect} className="btn-primary flex items-center gap-2">
          <Youtube size={18} /> Connect Channel
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Loading channels...</div>
      ) : channels.length === 0 ? (
        <div className="text-center py-20 bg-darker rounded-xl border border-white/5">
          <Youtube size={48} className="mx-auto text-gray-600 mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No Channels Connected</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">Connect your YouTube channels here to enable automatic uploading. You can map different niches to different channels.</p>
          <button onClick={handleConnect} className="btn-primary inline-flex items-center gap-2 mx-auto">
            <Youtube size={18} /> Connect Your First Channel
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {channels.map(channel => (
            <div key={channel.channelId} className="bg-darker rounded-xl border border-white/10 p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-4">
                  {channel.channelAvatar ? (
                    <img src={channel.channelAvatar} alt={channel.channelName} className="w-12 h-12 rounded-full" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center">
                      <Youtube size={24} className="text-white" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      {channel.channelName} <Check size={16} className="text-green-500" />
                    </h3>
                    <a href={`https://youtube.com/channel/${channel.channelId}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline flex items-center gap-1">
                      View Channel <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
                <button onClick={() => handleDisconnect(channel.channelId)} className="text-gray-500 hover:text-red-500 transition-colors p-2" title="Disconnect">
                  <Trash2 size={18} />
                </button>
              </div>
              
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Mapped Niches</h4>
                <div className="flex flex-wrap gap-2">
                  {allNiches.map(niche => {
                    const isMapped = (channel.mappedNiches || []).includes(niche);
                    return (
                      <button
                        key={niche}
                        onClick={() => toggleNiche(channel.channelId, niche, channel.mappedNiches || [])}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${isMapped ? 'bg-brand/20 border-brand text-brand shadow-[0_0_10px_rgba(255,215,0,0.2)]' : 'bg-dark border-white/10 text-gray-500 hover:border-white/30 hover:text-gray-300'}`}
                      >
                        {niche.replace('⭐ ', '')}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
