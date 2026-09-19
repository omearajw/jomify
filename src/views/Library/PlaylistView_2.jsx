import { useEffect, useState, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/userStore'; 
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { artUrl } from '../../utils/images';
import { resolvePlaybackDeviceId, handlePlaybackError, setShuffle } from '../../services/spotify/playbackController';
import { ChevronUp as StageUpIcon, ChevronDown as StageDownIcon, Shuffle as ShuffleIcon } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { collaboratorStyleFor } from '../../utils/collaboratorStyle';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';

const formatBatchDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
import { fetchPlaylistDetails, fetchMoreTracks, addTracksToPlaylist, playPlaylistTrack, fetchSevenTrackMeta } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Play, X, LayoutPanelLeft, ArrowRight, Loader2, Disc3 } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { getCollaboratorStyle } from '../../utils/collaboratorStyle';

// A playlist with every page of tracks, not just the first 100. fetchMoreTracks goes through
// the rate-limit interceptor and throws on a bad page, so a failure surfaces instead of
// silently truncating the list.
async function fetchEntirePlaylist(token, playlistId) {
  const data = await fetchPlaylistDetails(token, playlistId);
  let allItems = [...data.tracks.items];
  let nextUrl = data.tracks.next;
  while (nextUrl) {
    const nextData = await fetchMoreTracks(token, nextUrl);
    allItems = [...allItems, ...(nextData.items || [])];
    nextUrl = nextData.next;
  }
  return { ...data, tracks: { ...data.tracks, items: allItems } };
}

export default function PlaylistView_2() {
  const {
    token, activePlaylistId, playlists, profile,
    stagedSeven, addStagedTrack, removeStagedTrack, clearStagedTracks, setStagedSeven,
    navigateToArtist, navigateToAlbum, sevens, updateSeven
  } = useSlice(useUserStore, [
    'token', 'activePlaylistId', 'playlists', 'profile',
    'stagedSeven', 'addStagedTrack', 'removeStagedTrack', 'clearStagedTracks', 'setStagedSeven',
    'navigateToArtist', 'navigateToAlbum', 'sevens', 'updateSeven'
  ]);
  
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const isShuffled = usePlayerStore((s) => s.isShuffled);

  const playFromTop = () => {
    if (!token || !playlist) return;
    const deviceId = resolvePlaybackDeviceId();
    if (!deviceId) return;
    playPlaylistTrack(token, deviceId, activePlaylistId, 0).catch(handlePlaybackError);
  };

  const shufflePlay = async () => {
    if (!token || !playlist) return;
    const deviceId = resolvePlaybackDeviceId();
    if (!deviceId) return;
    try { await setShuffle(true, deviceId); } catch { return; }
    const count = playlist.tracks?.items?.length || 1;
    playPlaylistTrack(token, deviceId, activePlaylistId, Math.floor(Math.random() * count)).catch(handlePlaybackError);
  };
  const [playlist, setPlaylist] = useState(null);
  
  // Workspace States
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  // Which of the three panes a narrow screen shows; wide screens show all three side by side
  const [workspacePane, setWorkspacePane] = useState('staging');
  const [poolPlaylist, setPoolPlaylist] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  // This Seven's configuration: who it's with, whether it's still running, and which
  // playlist we draft candidate tracks from. Each Seven keeps its own pool.
  const thisSeven = useMemo(
    () => sevens.find(s => s.playlistId === activePlaylistId) || null,
    [sevens, activePlaylistId]
  );
  const poolPlaylistId = thisSeven?.poolPlaylistId || '';
  const setPoolPlaylistId = (id) => {
    if (activePlaylistId) updateSeven(activePlaylistId, { poolPlaylistId: id });
  };

  // Tracks already sent to THIS partner on any of your other Sevens with them.
  // Tagged with the partner it was gathered for so it is never read against a different one.
  const [crossSevenHistory, setCrossSevenHistory] = useState({ partnerId: null, matches: {} });
  
  // Drag & Drop State
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Collaborator profiles come from the shared cache
  const collaborators = useUserProfilesStore((s) => s.profiles);
  // { id, message } keyed by playlist so switching Sevens needs no reset
  const [loadError, setLoadError] = useState(null);
  
  const horizontalScrollRef = useRef(null);


  // --- FETCH MAIN PLAYLIST ---
  useEffect(() => {
    if (token && activePlaylistId) {
      const requestedId = activePlaylistId;
      fetchEntirePlaylist(token, activePlaylistId)
        .then(setPlaylist)
        .catch((err) => {
          console.error(err);
          setLoadError({ id: requestedId, message: err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting Jomify; try again in a moment.' : "Couldn't load this Seven." });
        });
    }
  }, [token, activePlaylistId]);

  // --- FETCH POOL PLAYLIST ---
  useEffect(() => {
    if (token && poolPlaylistId && isWorkspaceOpen) {
      fetchEntirePlaylist(token, poolPlaylistId)
        .then(setPoolPlaylist)
        .catch(console.error);
    }
  }, [token, poolPlaylistId, isWorkspaceOpen]);

  // --- COLLABORATOR HYDRATION ---
  useEffect(() => {
    if (!token || !playlist?.tracks?.items) return;
    ensureUserProfiles(token, playlist.tracks.items.map(i => i.added_by?.id));
  }, [playlist?.tracks?.items, token]);

  // --- CROSS-SEVEN DUPLICATE ENGINE ---
  // Sevens with different people are completely independent: a track you gave one person is
  // fair game for another. So we only cross-reference the OTHER Sevens that share this one's
  // partner. Finished Sevens still count -- a track you sent them two years ago is still a
  // repeat -- so we deliberately do not filter on `active` here.
  const partnerSevens = useMemo(() => {
    if (!thisSeven?.partnerId) return [];
    return sevens.filter(s => s.playlistId !== activePlaylistId && s.partnerId === thisSeven.partnerId);
  }, [sevens, thisSeven, activePlaylistId]);

  useEffect(() => {
    if (!token || !isWorkspaceOpen || partnerSevens.length === 0) return;

    const partnerId = thisSeven?.partnerId || null;
    let cancelled = false;

    const knownPlaylists = useUserStore.getState().playlists;

    Promise.all(
      partnerSevens.map(async (seven) => ({
        name: knownPlaylists.find(p => p.id === seven.playlistId)?.name || 'another Seven',
        meta: await fetchSevenTrackMeta(token, seven.playlistId).catch(() => [])
      }))
    )
      .then((results) => {
        if (cancelled) return;
        const matches = {};
        results.forEach(({ name, meta }) => {
          meta.forEach(({ uri }) => {
            if (uri && !matches[uri]) matches[uri] = { playlistName: name };
          });
        });
        setCrossSevenHistory({ partnerId, matches });
      })
      .catch((err) => {
        console.error('Cross-Seven duplicate check failed:', err);
        // Still mark the check as settled so the pane stops showing a spinner forever
        if (!cancelled) setCrossSevenHistory({ partnerId, matches: {} });
      });

    return () => { cancelled = true; };
  }, [token, isWorkspaceOpen, partnerSevens, thisSeven?.partnerId]);

  const isCheckingHistory = partnerSevens.length > 0 && crossSevenHistory.partnerId !== thisSeven?.partnerId;

  const crossSevenMatches = useMemo(() => {
    if (!thisSeven?.partnerId || crossSevenHistory.partnerId !== thisSeven.partnerId) return {};
    return crossSevenHistory.matches;
  }, [crossSevenHistory, thisSeven?.partnerId]);

  const partnerDisplayName = useMemo(() => {
    if (!thisSeven?.partnerId) return null;
    return collaborators[thisSeven.partnerId]?.display_name || thisSeven.partnerName || thisSeven.partnerId;
  }, [thisSeven, collaborators]);

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
        result.push({ adderId: currentAdder, tracks: currentChunk, addedAt: currentChunk[0]?.added_at });
        currentChunk = [item];
        currentAdder = adder;
      }
    }
    result.push({ adderId: currentAdder, tracks: currentChunk, addedAt: currentChunk[0]?.added_at });

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
    if (lastAdderId === profile?.id) return `Next up: ${otherUsername}`;
    return `Next up: ${yourUsername}`;
  }, [playlist, profile, collaborators]);

  const mainPlaylistUris = useMemo(() => {
    if (!playlist?.tracks?.items) return new Set();
    return new Set(playlist.tracks.items.map(i => i.track?.uri).filter(Boolean));
  }, [playlist]);

  // --- PUBLISH HANDLER ---
  const handlePublishSeven = async () => {
    if (stagedSeven.length !== 7 || !token || !activePlaylistId) return;
    setPublishError('');
    setIsPublishing(true);
    try {
      const uris = [...stagedSeven].reverse().map(t => t.uri);

      // addTracksToPlaylist throws on a non-2xx response. The draft is only cleared once
      // Spotify has confirmed the tracks landed -- it's persisted state, and losing seven
      // carefully chosen tracks to a transient error is exactly the wrong outcome.
      await addTracksToPlaylist(token, activePlaylistId, uris);

      // Reload every page, not just the first 100, so the view doesn't lose older batches
      setPlaylist(await fetchEntirePlaylist(token, activePlaylistId));
      clearStagedTracks();
      setIsWorkspaceOpen(false);
    } catch (err) {
      console.error("Failed to publish 7", err);
      setPublishError("Couldn't publish -- Spotify rejected the request. Your seven tracks are still staged.");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTrackSelect = (trackUri) => {
    if (!token || !playlist) return;
    const deviceId = resolvePlaybackDeviceId();
    if (!deviceId) return;
    const realIndex = playlist.tracks.items.findIndex(item => item.track?.uri === trackUri);
    if (realIndex !== -1) {
      playPlaylistTrack(token, deviceId, activePlaylistId, realIndex).catch(handlePlaybackError);
    }
  };

  // --- SCROLL TRANSLATOR ---
  useEffect(() => {
    const container = horizontalScrollRef.current;
    // Below md the batches stack vertically and scroll normally; only the wide layout is horizontal
    if (!container || isWorkspaceOpen || !window.matchMedia('(min-width: 768px)').matches) return;

    const handleWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        container.scrollLeft += e.deltaY * 1.5;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isWorkspaceOpen, chunks]);

  if (!playlist) {
    if (loadError?.id === activePlaylistId) return <p className="text-neutral-400 text-lg mt-8 px-8">{loadError.message}</p>;
    return <p className="text-neutral-400 animate-pulse text-lg mt-8 px-8">Loading The Seven...</p>;
  }

  // ==========================================
  // VIEW: 3-PANE WORKSPACE
  // ==========================================
  if (isWorkspaceOpen) {
    const reversedMainItems = [...playlist.tracks.items].reverse();

    return (
      <div className="flex flex-col lg:h-[calc(90vh-140px)] w-full px-2 md:px-6 pt-2 pb-6 lg:overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-4 md:mb-6 shrink-0">
          <div>
            <h1 className="text-2xl md:text-4xl font-extrabold text-white tracking-tighter">{playlist.name} Workspace</h1>
            <p className="text-neutral-400 font-medium mt-1">{turnIndicator}</p>
          </div>
          <button 
            onClick={() => setIsWorkspaceOpen(false)}
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors"
          >
            <X className="w-4 h-4" /> Close Workspace
          </button>
        </div>

        {/* Narrow screens: one pane at a time */}
        <div role="tablist" aria-label="Workspace panes" className="lg:hidden flex rounded-full bg-neutral-900 border border-neutral-800 p-1 mb-4 shrink-0">
          {[['playlist', 'Playlist'], ['staging', `Staging ${stagedSeven.length}/7`], ['pool', 'Pool']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={workspacePane === id}
              onClick={() => setWorkspacePane(id)}
              className={`flex-1 rounded-full py-2 text-sm font-bold transition-colors ${workspacePane === id ? 'bg-white text-black' : 'text-neutral-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0 lg:overflow-hidden">

          {/* PANE 1: MAIN PLAYLIST */}
          <div className={`${workspacePane === 'playlist' ? 'flex' : 'hidden'} lg:flex flex-col h-[65dvh] lg:h-full bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl min-h-0`}>
            <div className="p-4 border-b border-neutral-800 bg-black/20 shrink-0">
              <h2 className="font-bold text-white tracking-wide">{playlist.name}</h2>
              <p className="text-xs text-neutral-500">{playlist.tracks.total} total tracks</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {reversedMainItems.map((item, idx) => {
                const adderId = item.added_by?.id;
                const prevAdderId = reversedMainItems[idx - 1]?.added_by?.id;
                const nextAdderId = reversedMainItems[idx + 1]?.added_by?.id;
                
                const isFirst = adderId !== prevAdderId;
                const isLast = adderId !== nextAdderId;

                let radiusClass;
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
                    <img src={artUrl(item.track.album.images, 32)} width="32" height="32" loading="lazy" decoding="async" className="w-8 h-8 rounded shrink-0 shadow-sm object-cover" alt="" />
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
          <div className={`${workspacePane === 'staging' ? 'flex' : 'hidden'} lg:flex flex-col h-[65dvh] lg:h-full bg-brand-gradient/10 border border-[var(--brand-mid)]/30 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(249,19,98,0.1)] relative min-h-0`}>
            <div className="p-4 border-b border-[var(--brand-mid)]/20 bg-black/40 flex justify-between items-center shrink-0">
              <div className="min-w-0">
                <h2 className="font-bold text-white tracking-wide text-brand-gradient">7up Staging</h2>
                {publishError ? (
                  <p className="text-xs text-red-400 font-medium leading-snug">{publishError}</p>
                ) : (
                  <p className="text-xs text-[var(--brand-light)]">{stagedSeven.length}/7 Selected</p>
                )}
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
                // Same splice the drop handler below performs, driven by a button instead
                const moveStaged = (from, delta) => {
                  const to = from + delta;
                  if (to < 0 || to >= stagedSeven.length) return;
                  const newStaged = [...stagedSeven];
                  const [movedItem] = newStaged.splice(from, 1);
                  newStaged.splice(to, 0, movedItem);
                  setStagedSeven(newStaged);
                };
                const isDraggingThis = draggedIdx === idx;
                const isDragOver = dragOverIdx === idx;

                return (
                  <div
                    // Keyed by the track, not the slot: this is the one list in the app that
                    // genuinely reorders, and an index key made React reuse the wrong DOM node
                    key={track?.uri || `empty-slot-${idx}`}
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
                        <img src={artUrl(track.album.images, 40)} width="40" height="40" decoding="async" className="w-10 h-10 rounded-md shadow-md shrink-0 pointer-events-none object-cover" alt="" />
                        <div className="flex flex-col justify-center truncate flex-1 pointer-events-none">
                          <span className="text-sm font-bold text-white truncate">{track.name}</span>
                          <span className="text-xs text-neutral-400 truncate">{track.artists.map(a => a.name).join(', ')}</span>
                        </div>
                        {/* Touch screens can't drag the slots; nudge one step instead */}
                        <div className="hidden pointer-coarse:flex flex-col shrink-0 -my-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            aria-label="Move up"
                            onClick={(e) => { e.stopPropagation(); moveStaged(idx, -1); }}
                            className="p-1 rounded text-white/60 active:bg-white/10 disabled:opacity-20"
                          >
                            <StageUpIcon className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={idx >= stagedSeven.length - 1}
                            aria-label="Move down"
                            onClick={(e) => { e.stopPropagation(); moveStaged(idx, 1); }}
                            className="p-1 rounded text-white/60 active:bg-white/10 disabled:opacity-20"
                          >
                            <StageDownIcon className="w-4 h-4" />
                          </button>
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
          <div className={`${workspacePane === 'pool' ? 'flex' : 'hidden'} lg:flex flex-col h-[65dvh] lg:h-full bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl min-h-0`}>
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

              {/* Why tracks below might be dimmed */}
              {!thisSeven?.partnerId ? (
                <p className="text-[11px] font-medium text-amber-400/80 leading-snug">
                  No partner set for this Seven, so tracks you've already sent them elsewhere can't be flagged. Set one in Sevens settings.
                </p>
              ) : isCheckingHistory ? (
                <p className="text-[11px] font-medium text-neutral-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking what you've already sent {partnerDisplayName}…
                </p>
              ) : partnerSevens.length > 0 ? (
                <p className="text-[11px] font-medium text-neutral-500 leading-snug">
                  Cross-checked against {partnerSevens.length} other Seven{partnerSevens.length === 1 ? '' : 's'} with {partnerDisplayName}.
                </p>
              ) : null}
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
                  // Already given to this same partner on one of your other Sevens. Not blocked --
                  // just pushed into the background, with the reason spelled out on the row.
                  const sentBefore = !isDuplicate ? crossSevenMatches[item.track.uri] : null;
                  
                  let stateClasses = "hover:bg-white/5 cursor-pointer";
                  if (sentBefore) stateClasses = "opacity-40 hover:opacity-100 hover:bg-white/5 cursor-pointer";
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
                          if (!token || !poolPlaylist) return;
                          const deviceId = resolvePlaybackDeviceId();
                          if (!deviceId) return;
                          playPlaylistTrack(token, deviceId, poolPlaylistId, idx).catch(handlePlaybackError);
                        }}
                      >
                        <img src={artUrl(item.track.album.images, 40)} width="40" height="40" loading="lazy" decoding="async" className="w-full h-full object-cover" alt="" />
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
                        {sentBefore && (
                          <span className="text-[10px] font-medium text-amber-400/90 truncate">
                            Already sent to {partnerDisplayName} in {sentBefore.playlistName}
                          </span>
                        )}
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
    <div className="flex flex-col md:h-[calc(90vh-140px)] w-full md:overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4 mt-2 md:mt-6 px-2 md:px-8 select-none shrink-0">
        <div className="flex items-end gap-4 md:gap-6 min-w-0">
          {playlist.images?.length > 0 ? (
            <img src={playlist.images[0].url} alt={playlist.name} className="w-24 h-24 md:w-32 md:h-32 shadow-2xl shadow-black/50 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="w-24 h-24 md:w-32 md:h-32 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded-xl shrink-0"> 🎵 </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              The Seven
            </p>
            <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tighter mb-2 break-words">{playlist.name}</h1>
            <p className="text-neutral-400 text-sm font-medium">
              {turnIndicator} • {chunks.length} Batches
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={playFromTop}
            aria-label={`Play ${playlist.name}`}
            className="w-12 h-12 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
          <button
            type="button"
            onClick={shufflePlay}
            aria-label="Shuffle play"
            title="Shuffle play"
            className={`w-11 h-11 flex items-center justify-center rounded-full hover:scale-110 active:scale-95 transition-all ${isShuffled ? 'text-brand-gradient' : 'text-neutral-400 hover:text-white'}`}
          >
            <ShuffleIcon className="w-6 h-6" />
          </button>
          <button
            onClick={() => setIsWorkspaceOpen(true)}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-neutral-200 hover:scale-105 transition-all shadow-xl shrink-0"
          >
            <LayoutPanelLeft className="w-4 h-4" /> Open Workspace
          </button>
        </div>
      </div>

      {/* Horizontal Free Scroll Container */}
      <div 
        ref={horizontalScrollRef}
        className="flex flex-col md:flex-row md:items-start md:overflow-x-auto md:overflow-y-hidden gap-6 md:gap-8 px-2 md:px-8 pb-8 pt-4 flex-1 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {chunks.map((chunk, chunkIdx) => {
          const collaborator = collaborators[chunk.adderId];
          const displayName = collaborator?.display_name || chunk.adderId || 'Unknown';
          const profileImage = collaborator?.images?.[0]?.url;

          return (
            <div 
              key={chunkIdx} 
              // Added group/batch and responsive hover widths to expand on hover
              // A fixed card width on wide screens: one long title no longer widens the whole
              // batch, and seven rows have room instead of being squashed to fit
              className="group/batch shrink-0 w-full md:w-[28rem] md:max-h-full flex flex-col bg-neutral-900/40 border border-white/5 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl min-h-0"
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
                  <h3 className="font-bold text-lg text-white tracking-tight truncate min-w-0">{displayName}</h3>
                </div>
                {chunk.addedAt && (
                  <span className="text-xs font-medium text-neutral-500 tabular-nums shrink-0 ml-3">{formatBatchDate(chunk.addedAt)}</span>
                )}
              </div>
              
              <div className="flex-1 p-3 flex flex-col gap-1 min-h-0 md:overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {chunk.tracks.map((item, idx) => {
                  if (!item.track) return null;
                  const track = item.track;
                  const isCurrentTrack = currentPlayingTrack && (track.uri === currentPlayingTrack.uri);
                  
                  const isFirst = idx === 0;
                  const isLast = idx === chunk.tracks.length - 1;

                  let radiusClass;
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
                      style={collaboratorStyleFor(chunk.adderId, true, isFirst, isLast, false)}
                      // Rows keep their natural height; they used to be flex-1 min-h-0 and got
                      // squashed and clipped whenever seven didn't fit the card
                      className={`min-h-[52px] shrink-0 flex items-center gap-3 px-3 py-1.5 group/track text-sm cursor-pointer hover:bg-white/10 transition-colors ${radiusClass} ${marginClass}`}
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
                          <img src={artUrl(track.album.images, 40)} alt={track.name} width="40" height="40" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
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
                                className="hover:underline hover:text-white transition-colors text-left truncate pointer-coarse:pointer-events-none"
                              >
                                {artist.name}
                              </button>
                              {aIdx < track.artists.length - 1 && <span className="mr-1">,</span>}
                            </span>
                          ))}
                          {/* Album on the same line, always visible: it used to hide in a column that only opened on hover */}
                          {track.album?.name && (
                            <>
                              <span className="mx-1 text-neutral-600 shrink-0">•</span>
                              {track.album.id ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }}
                                  className="hover:underline hover:text-white transition-colors text-left truncate min-w-0 pointer-coarse:pointer-events-none"
                                >
                                  {track.album.name}
                                </button>
                              ) : (
                                <span className="truncate min-w-0">{track.album.name}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* 4. Like Button */}
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