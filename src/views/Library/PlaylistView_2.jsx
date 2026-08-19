import { useEffect, useState, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/userStore'; 
import { usePlayerStore } from '../../store/playerStore';
import { fetchPlaylistDetails, playPlaylistTrack, fetchUserPlaylists } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Play, X, LayoutPanelLeft, ArrowRight, Loader2, Disc3 } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

const cleanString = (str) => {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
};

// Generates the subtle, grungy glass styles with a compact variant for the workspace
const getCollaboratorStyle = (userId, isCollaborative, isFirst, isLast, isCompact = false) => {
  if (!isCollaborative || !userId) return {};
  
  const hash = Math.abs(hashCode(userId));
  const hue = Math.round((hash * 137.508) % 360);

  const ambientGlow = isCompact ? `-6px 0px 12px -6px hsla(${hue}, 50%, 50%, 0.15)` : `-12px 0px 24px -12px hsla(${hue}, 50%, 50%, 0.15)`;
  const bottomGlow = isCompact ? `-6px 6px 12px -6px hsla(${hue}, 50%, 50%, 0.3)` : `-12px 12px 24px -12px hsla(${hue}, 50%, 50%, 0.4)`;

  let shadow = [ambientGlow];

  if (isFirst) {
    shadow.push(`inset 0px 1px 0px hsla(${hue}, 100%, 60%, 0.25)`);
  }
  if (isLast) {
    shadow.push(`inset 0px -1px 0px hsla(${hue}, 50%, 60%, 0.3)`);
    shadow.push(bottomGlow);
  }

  let bgGradient = '';
  
  if (isFirst && isLast) {
    bgGradient = `radial-gradient(${isCompact ? '80%' : '120%'} 150% at bottom left, hsla(${hue}, 100%, 60%, 0.12) 0%, transparent 60%)`;
  } else if (isLast) {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.18) 0%, hsla(${hue}, 100%, 60%, 0.05) 50%, transparent 100%)`;
  } else if (isFirst) {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.04) 0%, transparent 80%)`;
  } else {
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.08) 0%, transparent 90%)`;
  }

  return {
    '--track-hue': hue,
    boxShadow: shadow.join(', '),
    backgroundImage: bgGradient,
    borderLeft: `1px solid hsla(${hue}, 100%, 60%, 0.15)`
  };
};

export default function PlaylistView_2() {
  const { 
    token, activePlaylistId, playlists, profile,
    stagedSeven, addStagedTrack, removeStagedTrack, clearStagedTracks, setStagedSeven,
    navigateToArtist, navigateToAlbum
  } = useUserStore();
  
  const { deviceId, playbackState } = usePlayerStore();
  const [playlist, setPlaylist] = useState(null);
  
  // Workspace States
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [poolPlaylistId, setPoolPlaylistId] = useState(() => localStorage.getItem('jomify_pool_playlist_id') || '');
  const [poolPlaylist, setPoolPlaylist] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  
  // Drag & Drop State
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Collaborator State for Header Profiles
  const [collaborators, setCollaborators] = useState({});
  const fetchedUserIds = useRef(new Set());
  
  const horizontalScrollRef = useRef(null);

  const currentPlayingTrack = playbackState?.track_window?.current_track;
  const isCurrentTrackPaused = playbackState ? playbackState.paused : true;

  // --- FETCH MAIN PLAYLIST ---
  useEffect(() => {
    if (token && activePlaylistId) {
      fetchPlaylistDetails(token, activePlaylistId)
        .then(async (data) => {
          let allItems = [...data.tracks.items];
          let nextUrl = data.tracks.next;
          while (nextUrl) {
            const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
            const nextData = await res.json();
            allItems = [...allItems, ...nextData.items];
            nextUrl = nextData.next;
          }
          setPlaylist({ ...data, tracks: { ...data.tracks, items: allItems } });
        })
        .catch(console.error);
    }
  }, [token, activePlaylistId]);

  // --- FETCH POOL PLAYLIST ---
  useEffect(() => {
    if (token && poolPlaylistId && isWorkspaceOpen) {
      localStorage.setItem('jomify_pool_playlist_id', poolPlaylistId);
      fetchPlaylistDetails(token, poolPlaylistId)
        .then(async (data) => {
          let allItems = [...data.tracks.items];
          let nextUrl = data.tracks.next;
          while (nextUrl) {
            const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
            const nextData = await res.json();
            allItems = [...allItems, ...nextData.items];
            nextUrl = nextData.next;
          }
          setPoolPlaylist({ ...data, tracks: { ...data.tracks, items: allItems } });
        })
        .catch(console.error);
    }
  }, [token, poolPlaylistId, isWorkspaceOpen]);

  // --- COLLABORATOR HYDRATION ENGINE ---
  useEffect(() => {
    if (!token || !playlist?.tracks.items) return;

    const uniqueIds = [...new Set(playlist.tracks.items.map(i => i.added_by?.id).filter(Boolean))];
    const idsToFetch = uniqueIds.filter(id => !fetchedUserIds.current.has(id));

    if (idsToFetch.length === 0) return;

    idsToFetch.forEach(id => fetchedUserIds.current.add(id));

    const fetchCollaborators = async () => {
      try {
        const responses = await Promise.all(
          idsToFetch.map(id => fetch(`https://api.spotify.com/v1/users/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()))
        );
        
        setCollaborators(prev => {
          const next = { ...prev };
          responses.forEach(user => {
            if (user && user.id) {
              next[user.id] = user;
            }
          });
          return next;
        });
      } catch (err) {
        console.error('Failed to fetch collaborator profiles:', err);
      }
    };

    fetchCollaborators();
  }, [playlist?.tracks.items, token]);

  // --- DYNAMIC BATCH CHUNKING (GROUP BY USER) ---
  const chunks = useMemo(() => {
    if (!playlist?.tracks?.items) return [];
    const items = playlist.tracks.items.filter(i => i.track);
    if (items.length === 0) return [];

    const result = [];
    let currentChunk = [items[0]];
    let currentAdder = items[0].added_by?.id;

    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      const adder = item.added_by?.id;
      
      if (adder === currentAdder) {
        currentChunk.push(item);
      } else {
        result.push({ adderId: currentAdder, tracks: currentChunk });
        currentChunk = [item];
        currentAdder = adder;
      }
    }
    result.push({ adderId: currentAdder, tracks: currentChunk });

    // Reverse the array so the most recent batch is index 0
    return result.reverse();
  }, [playlist]);

const turnIndicator = useMemo(() => {
    if (!playlist?.tracks?.items || playlist.tracks.items.length === 0) return "Ready for Track 1";
    
    const lastTrack = playlist.tracks.items[playlist.tracks.items.length - 1];
    const lastAdderId = lastTrack?.added_by?.id;
    
    const yourUsername = profile?.display_name || profile?.id || 'You';
    
    // Scan the playlist to find the ID of the person who ISN'T you
    const otherId = playlist.tracks.items.find(item => item.added_by?.id && item.added_by.id !== profile?.id)?.added_by?.id;
    
    const otherCollaborator = otherId ? collaborators[otherId] : null;
    const otherUsername = otherCollaborator?.display_name || otherCollaborator?.id || otherId || 'Collaborator';

    // If you went last, it's their turn. If they went last, it's yours.
    if (lastAdderId === profile?.id) return `Next 7: ${otherUsername}`;
    return `Next 7: ${yourUsername}`;
  }, [playlist, profile, collaborators]);

  const mainPlaylistUris = useMemo(() => {
    if (!playlist?.tracks?.items) return new Set();
    return new Set(playlist.tracks.items.map(i => i.track?.uri).filter(Boolean));
  }, [playlist]);

  // --- PUBLISH HANDLER ---
  const handlePublishSeven = async () => {
    if (stagedSeven.length !== 7 || !token || !activePlaylistId) return;
    setIsPublishing(true);
    try {
      const uris = [...stagedSeven].reverse().map(t => t.uri);
      
      await fetch(`https://api.spotify.com/v1/playlists/${activePlaylistId}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris })
      });
      
      const updatedData = await fetchPlaylistDetails(token, activePlaylistId);
      setPlaylist(updatedData);
      clearStagedTracks();
      setIsWorkspaceOpen(false);
    } catch (err) {
      console.error("Failed to publish 7", err);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTrackSelect = (trackUri) => {
    if (!token || !deviceId || !playlist) return;
    const realIndex = playlist.tracks.items.findIndex(item => item.track?.uri === trackUri);
    if (realIndex !== -1) {
      playPlaylistTrack(token, deviceId, activePlaylistId, realIndex).catch(console.error);
    }
  };

  // --- SCROLL TRANSLATOR ---
  useEffect(() => {
    const container = horizontalScrollRef.current;
    if (!container || isWorkspaceOpen) return;

    const handleWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        container.scrollLeft += e.deltaY * 1.5;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isWorkspaceOpen, chunks]);

  if (!playlist) return <p className="text-neutral-400 animate-pulse text-lg mt-8 px-8">Loading The Seven...</p>;

  // ==========================================
  // VIEW: 3-PANE WORKSPACE
  // ==========================================
  if (isWorkspaceOpen) {
    const reversedMainItems = [...playlist.tracks.items].reverse();

    return (
      <div className="flex flex-col h-[calc(90vh-140px)] w-full px-6 pt-2 pb-6 overflow-hidden">
        <div className="flex justify-between items-end mb-6 shrink-0">
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tighter">{playlist.name} Workspace</h1>
            <p className="text-neutral-400 font-medium mt-1">{turnIndicator}</p>
          </div>
          <button 
            onClick={() => setIsWorkspaceOpen(false)}
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors"
          >
            <X className="w-4 h-4" /> Close Workspace
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0 overflow-hidden">
          
          {/* PANE 1: MAIN PLAYLIST */}
          <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl min-h-0">
            <div className="p-4 border-b border-neutral-800 bg-black/20 shrink-0">
              <h2 className="font-bold text-white tracking-wide">#{playlist.name}</h2>
              <p className="text-xs text-neutral-500">{playlist.tracks.total} total tracks</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {reversedMainItems.map((item, idx) => {
                const adderId = item.added_by?.id;
                const prevAdderId = reversedMainItems[idx - 1]?.added_by?.id;
                const nextAdderId = reversedMainItems[idx + 1]?.added_by?.id;
                
                const isFirst = adderId !== prevAdderId;
                const isLast = adderId !== nextAdderId;

                let radiusClass = 'rounded-md';
                let marginClass = '';
                
                if (isFirst && isLast) {
                  radiusClass = 'rounded-lg';
                  marginClass = 'my-1';
                } else if (isFirst) {
                  radiusClass = 'rounded-t-lg rounded-b-none';
                  marginClass = 'mt-1';
                } else if (isLast) {
                  radiusClass = 'rounded-b-lg rounded-t-none';
                  marginClass = 'mb-1';
                } else {
                  radiusClass = 'rounded-none';
                }

                return (
                  <div 
                    key={`${item.track.id}-${idx}`} 
                    style={getCollaboratorStyle(adderId, true, isFirst, isLast, true)}
                    className={`flex items-center gap-3 p-1.5 group transition-colors hover:bg-white/10 ${radiusClass} ${marginClass}`}
                  >
                    <span className="text-xs font-bold text-neutral-600 w-6 text-center shrink-0">
                      {reversedMainItems.length - idx}
                    </span>
                    <img src={item.track.album.images?.[0]?.url} className="w-8 h-8 rounded shrink-0 shadow-sm object-cover" alt="" />
                    <div className="flex flex-col truncate flex-1 pr-2">
                      <span className="text-sm font-medium text-white truncate">{item.track.name}</span>
                      <span className="text-xs text-neutral-500 truncate">{item.track.artists.map(a => a.name).join(', ')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PANE 2: 7UP STAGING AREA (DRAG & DROP, PERFECT FLEX-FIT) */}
          <div className="flex flex-col h-full bg-brand-gradient/10 border border-[var(--brand-mid)]/30 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(249,19,98,0.1)] relative min-h-0">
            <div className="p-4 border-b border-[var(--brand-mid)]/20 bg-black/40 flex justify-between items-center shrink-0">
              <div>
                <h2 className="font-bold text-white tracking-wide text-brand-gradient">7up Staging</h2>
                <p className="text-xs text-[var(--brand-light)]">{stagedSeven.length}/7 Selected</p>
              </div>
              <button 
                disabled={stagedSeven.length !== 7 || isPublishing}
                onClick={handlePublishSeven}
                className="bg-brand-gradient text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-brand-glow disabled:opacity-30 disabled:grayscale transition-all flex items-center gap-2"
              >
                {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publish Seven"}
              </button>
            </div>
            <div className="flex-1 flex flex-col gap-2 p-4 min-h-0 overflow-hidden">
              {Array.from({ length: 7 }).map((_, idx) => {
                const track = stagedSeven[idx];
                const isDraggingThis = draggedIdx === idx;
                const isDragOver = dragOverIdx === idx;

                return (
                  <div 
                    key={idx} 
                    draggable={!!track}
                    onDragStart={(e) => {
                      if (track) {
                        setDraggedIdx(idx);
                        e.dataTransfer.effectAllowed = 'move';
                      }
                    }}
                    onDragEnter={() => setDragOverIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={() => setDragOverIdx(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverIdx(null);
                      if (draggedIdx === null) return;
                      
                      let targetIdx = idx;
                      if (targetIdx >= stagedSeven.length) targetIdx = stagedSeven.length; 
                      
                      if (draggedIdx === targetIdx) {
                        setDraggedIdx(null);
                        return;
                      }
                      
                      const newStaged = [...stagedSeven];
                      const [movedItem] = newStaged.splice(draggedIdx, 1);
                      newStaged.splice(targetIdx, 0, movedItem);
                      
                      setStagedSeven(newStaged);
                      setDraggedIdx(null);
                    }}
                    className={`flex-1 min-h-0 max-h-[72px] flex items-center gap-4 px-3 py-1.5 rounded-2xl border transition-all ${
                      track 
                        ? 'bg-white/10 border-white/20 hover:bg-white/20 cursor-grab active:cursor-grabbing' 
                        : 'bg-black/20 border-dashed border-white/10'
                    } ${isDraggingThis ? 'opacity-40 scale-95' : 'opacity-100 scale-100'} ${isDragOver ? 'border-[var(--brand-mid)] bg-[var(--brand-mid)]/10' : ''}`}
                  >
                    <span className={`text-lg font-bold w-4 text-center shrink-0 ${track ? 'text-white' : 'text-neutral-700'}`}>{idx + 1}</span>
                    {track ? (
                      <>
                        <img src={track.album.images?.[0]?.url} className="w-10 h-10 rounded-md shadow-md shrink-0 pointer-events-none object-cover" alt="" />
                        <div className="flex flex-col justify-center truncate flex-1 pointer-events-none">
                          <span className="text-sm font-bold text-white truncate">{track.name}</span>
                          <span className="text-xs text-neutral-400 truncate">{track.artists.map(a => a.name).join(', ')}</span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStagedTrack(track.uri);
                          }}
                          className="p-1.5 rounded-full hover:bg-red-500/20 text-white/50 hover:text-red-500 transition-colors z-10 cursor-pointer shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-4 text-neutral-600 pointer-events-none w-full h-full py-1">
                        <div className="w-10 h-10 rounded-md border-2 border-dashed border-neutral-700 flex items-center justify-center shrink-0">
                          <Disc3 className="w-4 h-4 opacity-50" />
                        </div>
                        <span className="text-sm font-medium">Empty Slot</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* PANE 3: POOL PLAYLIST */}
          <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl min-h-0">
            <div className="p-4 border-b border-neutral-800 bg-black/20 flex flex-col gap-2 shrink-0">
              <select 
                value={poolPlaylistId} 
                onChange={(e) => setPoolPlaylistId(e.target.value)}
                className="bg-black/50 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-[var(--brand-mid)] w-full font-bold"
              >
                <option value="">-- Select your Pool Playlist --</option>
                {playlists.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {!poolPlaylistId ? (
                <div className="h-full flex items-center justify-center text-neutral-500 text-sm font-medium p-8 text-center">
                  Select your potential songs playlist above to start drafting.
                </div>
              ) : !poolPlaylist ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-neutral-500" /></div>
              ) : (
                poolPlaylist.tracks.items.map((item, idx) => {
                  if (!item.track) return null;
                  const isDuplicate = mainPlaylistUris.has(item.track.uri);
                  const isStaged = stagedSeven.some(t => t.uri === item.track.uri);
                  const isCurrentTrack = currentPlayingTrack && (item.track.uri === currentPlayingTrack.uri);
                  
                  let stateClasses = "hover:bg-white/5 cursor-pointer";
                  if (isDuplicate) stateClasses = "border border-red-500/50 bg-red-500/10 cursor-not-allowed opacity-50";
                  if (isStaged) stateClasses = "opacity-30 cursor-not-allowed bg-black/50";

                  return (
                    <div 
                      key={`${item.track.id}-${idx}`} 
                      onClick={() => {
                        if (!isDuplicate && !isStaged) addStagedTrack(item.track);
                      }}
                      className={`flex items-center gap-3 p-1.5 rounded-xl transition-all group/poolrow ${stateClasses}`}
                    >
                      <div 
                        className="relative w-8 h-8 rounded shadow-sm shrink-0 overflow-hidden cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!token || !deviceId || !poolPlaylist) return;
                          playPlaylistTrack(token, deviceId, poolPlaylistId, idx).catch(console.error);
                        }}
                      >
                        <img src={item.track.album.images?.[0]?.url} className="w-full h-full object-cover" alt="" />
                        <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity ${isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover/poolrow:opacity-100'}`}>
                          {isCurrentTrack && !isCurrentTrackPaused ? (
                            <span className="text-brand-gradient font-bold text-[10px] animate-pulse">🔊</span>
                          ) : (
                            <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col truncate flex-1">
                        <span className={`text-sm font-bold truncate ${isDuplicate ? 'text-red-400' : (isCurrentTrack ? 'text-brand-gradient' : 'text-white')}`}>
                          {item.track.name}
                        </span>
                        <span className="text-xs text-neutral-500 truncate">{item.track.artists.map(a => a.name).join(', ')}</span>
                      </div>
                      {isDuplicate && <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest px-2 shrink-0">Used</span>}
                      {isStaged && <span className="text-[10px] font-bold text-[var(--brand-mid)] uppercase tracking-widest px-2 shrink-0">Staged</span>}
                      {!isDuplicate && !isStaged && <ArrowRight className="w-4 h-4 text-white/30 shrink-0 mr-2" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: HORIZONTAL SCROLL (REVERSE CHRONOLOGICAL)
  // ==========================================
  return (
    <div className="flex flex-col h-[calc(90vh-140px)] w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-end justify-between mb-4 mt-6 px-8 select-none shrink-0">
        <div className="flex items-end space-x-6">
          {playlist.images?.length > 0 ? (
            <img src={playlist.images[0].url} alt={playlist.name} className="w-32 h-32 shadow-2xl shadow-black/50 rounded-xl object-cover" />
          ) : (
            <div className="w-32 h-32 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded-xl"> 🎵 </div>
          )}
          <div>
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              Collaborative Sequence
            </p>
            <h1 className="text-5xl font-extrabold text-white tracking-tighter mb-2">{playlist.name}</h1>
            <p className="text-neutral-400 text-sm font-medium">
              {turnIndicator} • {chunks.length} Batches
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsWorkspaceOpen(true)}
          className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-neutral-200 hover:scale-105 transition-all shadow-xl shrink-0"
        >
          <LayoutPanelLeft className="w-4 h-4" /> Open Workspace
        </button>
      </div>

      {/* Horizontal Free Scroll Container */}
      <div 
        ref={horizontalScrollRef}
        className="flex items-start overflow-x-auto overflow-y-hidden gap-8 px-8 pb-8 pt-4 flex-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {chunks.map((chunk, chunkIdx) => {
          const collaborator = collaborators[chunk.adderId];
          const displayName = collaborator?.display_name || chunk.adderId || 'Unknown';
          const profileImage = collaborator?.images?.[0]?.url;

          return (
            <div 
              key={chunkIdx} 
              // Added group/batch and responsive hover widths to expand on hover
              className="group/batch shrink-0 w-[max-content] hover:w-[max-content] transition-all duration-500 ease-out h-fit max-h-full flex flex-col bg-neutral-900/40 border border-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl min-h-0"
            >
              {/* Batch Header (User Profile) */}
              <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-black/30 shrink-0">
                <div className="flex items-center gap-4">
                  {profileImage ? (
                    <img src={profileImage} className="w-10 h-10 rounded-full object-cover shadow-md shrink-0" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-neutral-700 flex items-center justify-center text-xs font-bold text-white shadow-md shrink-0">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <h3 className="font-bold text-lg text-white tracking-tight truncate max-w-[250px]">{displayName}</h3>
                </div>
              </div>
              
              <div className="flex-1 p-4 flex flex-col gap-1 min-h-0 overflow-hidden justify-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {chunk.tracks.map((item, idx) => {
                  if (!item.track) return null;
                  const track = item.track;
                  const isCurrentTrack = currentPlayingTrack && (track.uri === currentPlayingTrack.uri);
                  
                  const isFirst = idx === 0;
                  const isLast = idx === chunk.tracks.length - 1;

                  let radiusClass = 'rounded-md';
                  let marginClass = '';
                  
                  if (isFirst && isLast) {
                    radiusClass = 'rounded-xl';
                    marginClass = 'my-1';
                  } else if (isFirst) {
                    radiusClass = 'rounded-t-xl rounded-b-none';
                    marginClass = 'mt-1';
                  } else if (isLast) {
                    radiusClass = 'rounded-b-xl rounded-t-none';
                    marginClass = 'mb-1';
                  } else {
                    radiusClass = 'rounded-none';
                  }

                  return (
                    <div 
                      key={track.id + idx}
                      onClick={() => handleTrackSelect(track.uri)}
                      style={getCollaboratorStyle(chunk.adderId, true, isFirst, isLast, false)}
                      // Converted to flex row to allow for smooth width transitioning
                      className={`flex-1 min-h-0 flex items-center gap-3 px-3 py-1.5 group/track text-sm cursor-pointer hover:bg-white/10 transition-colors shrink ${radiusClass} ${marginClass}`}
                    >
                      {/* 1. Play / Number Indicator */}
                      <div className="text-neutral-400 w-5 h-5 flex items-center justify-center shrink-0">
                        {isCurrentTrack && !isCurrentTrackPaused ? (
                          <span className="text-brand-gradient font-bold animate-pulse">🔊</span>
                        ) : (
                          <>
                            <span className={`group-hover/track:hidden text-xs ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>
                              {idx + 1}
                            </span>
                            <Play className="w-3.5 h-3.5 text-white hidden group-hover/track:block fill-current" />
                          </>
                        )}
                      </div>
                      
                      {/* 2. Album Art - Locked to fixed dimensions to prevent clipping */}
                      <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 shadow-sm relative">
                        {track.album?.images?.[0]?.url ? (
                          <img src={track.album.images[0].url} alt={track.name} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 w-full h-full bg-neutral-800 flex items-center justify-center">🎵</div>
                        )}
                      </div>

                      {/* 3. Title & Artist */}
                      <div className="flex flex-col justify-center truncate flex-1 min-w-0 pr-2">
                        <span className={`font-bold text-sm truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                          {track.name}
                        </span>
                        <div className="text-neutral-400 text-xs truncate flex items-center gap-1">
                          {track.artists.map((artist, aIdx) => (
                            <span key={artist.id || aIdx} className="inline-flex items-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (artist.id) navigateToArtist(artist.id);
                                }}
                                className="hover:underline hover:text-white transition-colors text-left truncate"
                              >
                                {artist.name}
                              </button>
                              {aIdx < track.artists.length - 1 && <span className="mr-1">,</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      {/* 4. Album Name (EXPANDS ON BATCH HOVER) */}
                      <div className="flex flex-col justify-center w-0 opacity-0 group-hover/batch:w-[max-content] group-hover/batch:opacity-100 group-hover/batch:ml-2 overflow-hidden transition-all duration-500 ease-out shrink-0">
                        {track.album?.id ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToAlbum(track.album.id);
                            }}
                            className="text-neutral-400 text-xs hover:text-white hover:underline transition-colors text-left truncate block w-full"
                          >
                            {track.album.name}
                          </button>
                        ) : (
                          <span className="text-neutral-400 text-xs truncate">{track.album?.name}</span>
                        )}
                      </div>

                      {/* 5. Like Button */}
                      <div className="flex justify-center items-center h-full w-8 shrink-0" onClick={e => e.stopPropagation()}>
                         <LikeButton trackId={track.id} />
                      </div>

                      {/* 6. Runtime */}
                      <span className="flex items-center justify-end text-neutral-500 text-xs font-medium pr-1 h-full w-10 shrink-0">
                        {formatTime(track.duration_ms)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="shrink-0 w-8"></div>
      </div>
    </div>
  );
}