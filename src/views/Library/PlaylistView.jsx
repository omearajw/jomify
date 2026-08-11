import { useEffect, useState, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/userStore'; 
import { usePlayerStore } from '../../store/playerStore';
import { fetchPlaylistDetails, playPlaylistTrack, checkTracksLiked, updatePlaylist, uploadPlaylistCoverImage, fetchUserPlaylists } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, RefreshCw, ListFilter, Check, X, ArrowUpDown, ArrowUp, ArrowDown, Users } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import PlaylistFormDialog from '../../components/PlaylistFormDialog';

// Robust string cleaner to bypass Spotify's meta mismatches
const cleanString = (str) => {
  if (!str) return '';
  return str
    .split(/[-(]/)[0] 
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') 
    .trim();
};

// String hashing function
const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
};

// Generates the subtle, grungy glass styles based on group adjacency
const getCollaboratorStyle = (userId, isCollaborative, isFirst, isLast) => {
  if (!isCollaborative || !userId) return {};
  
  // Multiply by the golden angle (137.508) to guarantee perfectly distinct colors for every user
  const hash = Math.abs(hashCode(userId));
  const hue = Math.round((hash * 137.508) % 360);

  let shadow = [
    `-12px 0px 24px -12px hsla(${hue}, 50%, 50%, 0.15)` // Very soft ambient left glow
  ];

  if (isFirst) {
    shadow.push(`inset 0px 1px 0px hsla(${hue}, 100%, 60%, 0.25)`); // Barely-there top glass edge
  }
  if (isLast) {
    shadow.push(`inset 0px -1px 0px hsla(${hue}, 50%, 60%, 0.3)`); // Barely-there bottom glass edge
    shadow.push(`-12px 12px 24px -12px hsla(${hue}, 50%, 50%, 0.4)`); // Pooled bottom-left glow
  }

  // Calculate the continuous overlay glow that spreads THROUGH the group
  let bgGradient = '';
  
  if (isFirst && isLast) {
    // Standalone track
    bgGradient = `radial-gradient(120% 150% at bottom left, hsla(${hue}, 100%, 60%, 0.12) 0%, transparent 60%)`;
  } else if (isLast) {
    // Source of the glow (strongest at the bottom of the group)
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.18) 0%, hsla(${hue}, 100%, 60%, 0.05) 50%, transparent 100%)`;
  } else if (isFirst) {
    // Farthest from the source (fading out at the top of the group)
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.04) 0%, transparent 80%)`;
  } else {
    // Middle of the group (light passing through)
    bgGradient = `radial-gradient(150% 200% at bottom left, hsla(${hue}, 100%, 60%, 0.08) 0%, transparent 90%)`;
  }

  return {
    '--track-hue': hue,
    boxShadow: shadow.join(', '),
    // backgroundImage renders over background-color, preserving your Tailwind hover effects
    backgroundImage: bgGradient,
    borderLeft: `1px solid hsla(${hue}, 100%, 60%, 0.15)`
  };
};

export default function PlaylistView() {
  const { 
    token, updatePlaylistImage, playlists, activePlaylistId, 
    setLikedTracks, setContextMenu, setDraggedItem, setPlaylists, 
    navigateToArtist, navigateToAlbum,
    playlistSortSettings, setPlaylistSortSettings // Destructured from your updated store
  } = useUserStore();
  
  const { deviceId, playbackState } = usePlayerStore();
  const [playlist, setPlaylist] = useState(null);
  
  // --- COLLABORATOR STATES ---
  const [collaborators, setCollaborators] = useState({});
  const fetchedUserIds = useRef(new Set());

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Get current sort settings safely from Zustand (default to custom / asc)
  const currentSort = playlistSortSettings?.[activePlaylistId] || { sortBy: 'custom', sortOrder: 'asc' };
  const sortBy = currentSort.sortBy;
  const sortOrder = currentSort.sortOrder;

  const updateSortSettings = (newSortBy, newSortOrder) => {
    if (!activePlaylistId) return;
    setPlaylistSortSettings(activePlaylistId, { sortBy: newSortBy, sortOrder: newSortOrder });
  };

  const isFetchingMore = useRef(false);

  const currentPlayingTrack = playbackState?.track_window?.current_track;
  const isCurrentTrackPaused = playbackState ? playbackState.paused : true;
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isUpdatingPlaylist, setIsUpdatingPlaylist] = useState(false);

  // --- "UNADDED SONGS" SYNC LOGIC STATES ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [selectedCheckPlaylistIds, setSelectedCheckPlaylistIds] = useState(() => {
    try {
      const saved = localStorage.getItem('jomify_unadded_check_playlists');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const isUnaddedSongsPlaylist = playlist?.name?.toLowerCase() === 'unadded songs';

  useEffect(() => {
    if (configModalOpen && token) {
      fetchUserPlaylists(token).then((data) => {
        setUserPlaylists(data.items || []);
      }).catch(console.error);
    }
  }, [configModalOpen, token]);

  const togglePlaylistSelection = (id) => {
    setSelectedCheckPlaylistIds(prev => {
      const updated = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
      localStorage.setItem('jomify_unadded_check_playlists', JSON.stringify(updated));
      return updated;
    });
  };

  const fetchAllPages = async (initialUrl) => {
    let items = [];
    let url = initialUrl;
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.items) {
        items.push(...data.items);
      }
      url = data.next;
    }
    return items;
  };

  const runUnaddedSongsSync = async () => {
    if (!token || !playlist || isSyncing) return;
    setIsSyncing(true);
    setSyncStatusText('Fetching all liked songs...');

    try {
      const allLikedSongs = await fetchAllPages('https://api.spotify.com/v1/me/tracks?limit=50');

      setSyncStatusText('Scanning check playlists...');

      const playlistTrackIds = new Set();
      for (const checkId of selectedCheckPlaylistIds) {
        const checkTracks = await fetchAllPages(`https://api.spotify.com/v1/playlists/${checkId}/tracks?limit=100`);
        for (const item of checkTracks) {
          if (item.track && item.track.id) {
            const cleanedName = cleanString(item.track.name);
            playlistTrackIds.add(item.track.id);
            playlistTrackIds.add(`${cleanedName}_${item.track.artists?.[0]?.name ? cleanString(item.track.artists[0].name) : ''}`);
          }
        }
      }

      setSyncStatusText('Scanning current Unadded Songs playlist...');

      const currentUnaddedTracks = await fetchAllPages(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`);

      const likedSongIdsMap = new Set(allLikedSongs.map(item => item.track?.id).filter(Boolean));
      const currentUnaddedTrackIds = new Set(currentUnaddedTracks.map(item => item.track?.id).filter(Boolean));

      const tracksToRemove = [];
      for (const item of currentUnaddedTracks) {
        const tr = item.track;
        if (!tr || !tr.id) continue;
        const cleanedName = cleanString(tr.name);
        const artistKey = `${cleanedName}_${tr.artists?.[0]?.name ? cleanString(tr.artists[0].name) : ''}`;

        const isLiked = likedSongIdsMap.has(tr.id);
        const isPresentInPlaylists = playlistTrackIds.has(tr.id) || playlistTrackIds.has(artistKey);

        if (!isLiked || isPresentInPlaylists) {
          tracksToRemove.push({ uri: tr.uri });
        }
      }

      if (tracksToRemove.length > 0) {
        setSyncStatusText(`Removing ${tracksToRemove.length} sorted/unliked tracks...`);
        for (let i = 0; i < tracksToRemove.length; i += 100) {
          const chunk = tracksToRemove.slice(i, i + 100);
          await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tracks: chunk })
          });
        }
      }

      setSyncStatusText('Finding new unadded liked songs...');

      const newUnaddedUris = [];
      for (const item of allLikedSongs) {
        const tr = item.track;
        if (!tr || !tr.id) continue;
        const cleanedName = cleanString(tr.name);
        const artistKey = `${cleanedName}_${tr.artists?.[0]?.name ? cleanString(tr.artists[0].name) : ''}`;

        const isPresentInPlaylists = playlistTrackIds.has(tr.id) || playlistTrackIds.has(artistKey);
        const isAlreadyInUnadded = currentUnaddedTrackIds.has(tr.id);

        if (!isPresentInPlaylists && !isAlreadyInUnadded) {
          newUnaddedUris.push(`spotify:track:${tr.id}`);
        }
      }

      if (newUnaddedUris.length > 0) {
        setSyncStatusText(`Adding ${newUnaddedUris.length} new unadded songs...`);
        for (let i = 0; i < newUnaddedUris.length; i += 100) {
          const batch = newUnaddedUris.slice(i, i + 100);
          await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: batch })
          });
        }
      }

      setSyncStatusText('Sync complete!');
      setTimeout(async () => {
        setIsSyncing(false);
        setSyncStatusText('');
        const updatedData = await fetchPlaylistDetails(token, activePlaylistId);
        setPlaylist(updatedData);
        checkLikesForChunk(updatedData.tracks.items);
      }, 1000);

    } catch (err) {
      console.error('Error running unadded songs sync:', err);
      setSyncStatusText('Sync failed. Check console.');
      setTimeout(() => {
        setIsSyncing(false);
        setSyncStatusText('');
      }, 2000);
    }
  };

  const checkLikesForChunk = (items) => {
    const ids = items.map(item => item.track?.id).filter(Boolean);
    if (ids.length > 0) {
      checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
    }
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    if (token && activePlaylistId) {
      setPlaylist(null); 
      setCollaborators({});
      fetchedUserIds.current.clear();
      isFetchingMore.current = false;

      fetch(`https://api.spotify.com/v1/playlists/${activePlaylistId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(async (data) => {
          setPlaylist(data);
          checkLikesForChunk(data.tracks.items);

          if (data.tracks.next && !isFetchingMore.current) {
            loadRestOfTracks(data.tracks.next);
          }
        })
        .catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activePlaylistId]); 

  // --- BACKGROUND STREAMING ---
  const loadRestOfTracks = async (initialNextUrl) => {
    isFetchingMore.current = true;
    let nextUrl = initialNextUrl;

    while (nextUrl) {
      try {
        const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
        const nextData = await res.json();
        
        if (!nextData.items || nextData.items.length === 0) break;

        setPlaylist((prev) => {
          if (!prev) return prev;
          const existingIds = new Set(prev.tracks.items.map((it, idx) => `${it.track?.id}_${idx}`));
          const uniqueNewItems = nextData.items.filter((it, idx) => !existingIds.has(`${it.track?.id}_${prev.tracks.items.length + idx}`));

          return {
            ...prev,
            tracks: {
              ...prev.tracks,
              items: [...prev.tracks.items, ...uniqueNewItems],
              next: nextData.next
            }
          };
        });
        
        checkLikesForChunk(nextData.items);
        nextUrl = nextData.next; 
      } catch (err) {
        break;
      }
    }
    isFetchingMore.current = false;
  };

  // --- DYNAMIC COLLABORATIVE DETECTOR ---
  const isCollaborative = useMemo(() => {
    if (!playlist) return false;
    if (playlist.collaborative) return true;
    
    return playlist.tracks?.items?.some(
      (item) => item.added_by?.id && item.added_by.id !== playlist.owner.id
    );
  }, [playlist]);

  // --- COLLABORATOR HYDRATION ENGINE ---
  useEffect(() => {
    if (!token || !isCollaborative || !playlist.tracks.items) return;

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
  }, [playlist?.tracks.items, isCollaborative, token]);

  const handleTrackSelect = (originalIndex) => {
    if (!token || !deviceId || !playlist) return;
    const targetTrack = sortedTracks[originalIndex];
    const realIndex = playlist.tracks.items.findIndex(item => item.track?.id === targetTrack.track?.id);
    if (realIndex !== -1) {
      playPlaylistTrack(token, deviceId, activePlaylistId, realIndex).catch(console.error);
    }
  };

  const handleUpdatePlaylist = async ({ name, description, imageFile }) => {
    if (!token || !activePlaylistId) return;
    setIsUpdatingPlaylist(true);

    try {
      const updated = await updatePlaylist(token, activePlaylistId, { name, description });
      
      if (imageFile) {
        try {
          await uploadPlaylistCoverImage(token, activePlaylistId, imageFile);
          const tempLocalUrl = URL.createObjectURL(imageFile);
          updatePlaylistImage(activePlaylistId, tempLocalUrl);
          setPlaylist((prev) => prev ? { ...prev, images: [{ url: tempLocalUrl }] } : prev);
        } catch (err) {
          console.warn('Playlist metadata updated but cover image upload failed:', err);
        }
      }
      
      setPlaylist((prev) => prev ? { ...prev, name: updated.name, description: updated.description } : prev);
      setPlaylists(playlists.map((p) => p.id === activePlaylistId ? { ...p, name: updated.name, description: updated.description } : p));
      
      setEditDialogOpen(false);
    } catch (err) {
      console.error('Failed to update playlist:', err);
    } finally {
      setIsUpdatingPlaylist(false);
    }
  };

  const handleRightClick = (e, track) => {
    e.preventDefault();
    setContextMenu({
      type: 'track',
      x: e.clientX,
      y: e.clientY,
      track: track,
      sourcePlaylistId: activePlaylistId
    });
  };

  const formatDateAdded = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // --- SORTED TRACKS COMPUTATION ---
  const sortedTracks = useMemo(() => {
    if (!playlist?.tracks?.items) return [];
    const items = [...playlist.tracks.items];

    if (sortBy === 'custom') {
      return items; 
    }

    return items.sort((a, b) => {
      const trackA = a.track;
      const trackB = b.track;
      if (!trackA || !trackB) return 0;

      let comparison = 0;
      if (sortBy === 'title') {
        comparison = trackA.name.localeCompare(trackB.name);
      } else if (sortBy === 'artist') {
        const artistA = trackA.artists?.[0]?.name || '';
        const artistB = trackB.artists?.[0]?.name || '';
        comparison = artistA.localeCompare(artistB);
      } else if (sortBy === 'album') {
        const albumA = trackA.album?.name || '';
        const albumB = trackB.album?.name || '';
        comparison = albumA.localeCompare(albumB);
      } else if (sortBy === 'date_added') {
        const dateA = new Date(a.added_at || 0).getTime();
        const dateB = new Date(b.added_at || 0).getTime();
        comparison = dateA - dateB;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [playlist, sortBy, sortOrder]);

  if (!playlist) {
    return <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading playlist...</p>;
  }

  const gridColumns = isCollaborative 
    ? "grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_120px_140px_80px]" 
    : "grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px]";

  return (
    <div className="flex flex-col pb-8">
      {/* Playlist Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-8 mt-4 select-none gap-6">
        <div className="flex items-end space-x-6">
          {playlist.images?.length > 0 ? (
            <img src={playlist.images[0].url} alt={playlist.name} className="w-48 h-48 shadow-2xl shadow-black/50 rounded" />
          ) : (
            <div className="w-48 h-48 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded"> 🎵 </div>
          )}
          <div>
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              Playlist
              {isCollaborative && (
                <span className="bg-[var(--brand-mid)]/20 text-[var(--brand-mid)] border border-[var(--brand-mid)]/30 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                  <Users className="w-3 h-3" />
                  Collaborative
                </span>
              )}
            </p>
            <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter mb-4">{playlist.name}</h1>
            <p className="text-neutral-400 text-sm font-medium">
              {playlist.description && <span className="mr-2">{playlist.description} •</span>}
              {playlist.owner.display_name} • {playlist.tracks.total} songs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isUnaddedSongsPlaylist && (
            <>
              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-full bg-neutral-800 border border-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                <ListFilter className="w-4 h-4" />
                Select Playlists ({selectedCheckPlaylistIds.length})
              </button>
              <button
                type="button"
                onClick={runUnaddedSongsSync}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-brand-glow disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? (syncStatusText || 'Syncing...') : 'Run Unadded Check'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setEditDialogOpen(true)}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors"
          >
            Edit playlist
          </button>
        </div>
      </div>

      {/* Check Playlists Selection Modal */}
      {configModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
              <h3 className="text-xl font-bold text-white">Select Playlists to Check Against</h3>
              <button 
                onClick={() => setConfigModalOpen(false)}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-400 py-3">
              Choose which playlists Jomify should verify your liked songs against when running the Unadded Check.
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 my-2">
              {userPlaylists.map((p) => {
                const isSelected = selectedCheckPlaylistIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => togglePlaylistSelection(p.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-white/10 border-white/20 text-white' : 'bg-neutral-800/40 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    <div className="flex items-center space-x-3 truncate">
                      {p.images?.[0]?.url ? (
                        <img src={p.images[0].url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-neutral-800 flex items-center justify-center text-xs flex-shrink-0">🎵</div>
                      )}
                      <span className="font-medium truncate">{p.name}</span>
                    </div>
                    <div className={`w-5 h-5 rounded flex items-center justify-center border ${isSelected ? 'bg-[var(--brand-mid)] border-[var(--brand-mid)] text-white' : 'border-neutral-600'}`}>
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setConfigModalOpen(false)}
                className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER & SORT CONTROLS BAR */}
      <div className="flex items-center justify-end mb-4 px-4 select-none">
        <div className="relative">
          <button
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
          >
            <ArrowUpDown className="w-4 h-4 text-neutral-400" />
            <span>Sort by: <strong className="text-white capitalize">{sortBy.replace('_', ' ')}</strong> ({sortOrder.toUpperCase()})</span>
          </button>

          {sortDropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl z-30 p-2 flex flex-col space-y-1">
              {[
                { id: 'custom', label: 'Custom Order' },
                { id: 'title', label: 'Alphabetical (Title)' },
                { id: 'artist', label: 'Alphabetical (Artist)' },
                { id: 'album', label: 'Alphabetical (Album)' },
                { id: 'date_added', label: 'Date Added' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => {
                    updateSortSettings(option.id, sortOrder);
                    setSortDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm text-left transition-colors ${sortBy === option.id ? 'bg-white/10 text-white font-semibold' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
                >
                  <span>{option.label}</span>
                  {sortBy === option.id && <Check className="w-4 h-4 text-[var(--brand-mid)]" />}
                </button>
              ))}

              <div className="my-1 border-t border-neutral-800" />

              <button
                onClick={() => updateSortSettings(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                <span>Direction</span>
                <span className="flex items-center gap-1 text-xs font-bold uppercase text-[var(--brand-mid)]">
                  {sortOrder === 'asc' ? <><ArrowUp className="w-3.5 h-3.5" /> Ascending</> : <><ArrowDown className="w-3.5 h-3.5" /> Descending</>}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tracklist Header */}
      <div className={`grid ${gridColumns} gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none`}>
        <span>#</span>
        <span />
        <span>Title</span>
        <span>Album</span>
        <span>Date Added</span>
        {isCollaborative && <span>Added By</span>}
        <div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        <PlaylistFormDialog
          open={editDialogOpen}
          title="Edit playlist"
          submitLabel="Save changes"
          initialName={playlist.name}
          initialDescription={playlist.description || ''}
          initialImageUrl={playlist.images?.[0]?.url || ''}
          onSubmit={handleUpdatePlaylist}
          onCancel={() => setEditDialogOpen(false)}
          isSubmitting={isUpdatingPlaylist}
        />
        {sortedTracks.map((item, index) => {
          if (!item || !item.track) return null;
          const track = item.track;

          const isCurrentTrack = currentPlayingTrack && (
            track.id === currentPlayingTrack.id || 
            track.uri === currentPlayingTrack.uri ||
            (track.linked_from && track.linked_from.id === currentPlayingTrack.id) ||
            (cleanString(track.name) === cleanString(currentPlayingTrack.name) && 
             track.artists?.[0]?.name === currentPlayingTrack.artists?.[0]?.name)
          );

          // Advanced Group Adjacency Logic for the Seamless Glow Effect
          const adderId = item.added_by?.id;
          let isFirstInGroup = true;
          let isLastInGroup = true;

          if (isCollaborative) {
            const prevItem = sortedTracks[index - 1];
            const nextItem = sortedTracks[index + 1];
            
            const prevAdderId = prevItem?.track ? prevItem.added_by?.id : null;
            const nextAdderId = nextItem?.track ? nextItem.added_by?.id : null;

            isFirstInGroup = adderId !== prevAdderId;
            isLastInGroup = adderId !== nextAdderId;
          }

          const collaboratorProfile = collaborators[adderId];

          const bgHoverClass = isCollaborative 
            ? 'bg-[hsla(var(--track-hue),40%,40%,0.02)] hover:bg-[hsla(var(--track-hue),40%,40%,0.06)] backdrop-blur-sm'
            : 'hover:bg-neutral-800/50';

          let radiusClass = 'rounded-md';
          let marginClass = '';
          
          if (isCollaborative) {
            if (isFirstInGroup && isLastInGroup) {
              radiusClass = 'rounded-lg';
              marginClass = 'my-1.5';
            } else if (isFirstInGroup) {
              radiusClass = 'rounded-t-lg rounded-b-none';
              marginClass = 'mt-1.5';
            } else if (isLastInGroup) {
              radiusClass = 'rounded-b-lg rounded-t-none';
              marginClass = 'mb-1.5';
            } else {
              radiusClass = 'rounded-none';
              marginClass = '';
            }
          }

          return (
            <div 
              key={`${track.id}-${index}`} 
              onClick={() => handleTrackSelect(index)}
              onContextMenu={(e) => handleRightClick(e, track)}
              style={getCollaboratorStyle(adderId, isCollaborative, isFirstInGroup, isLastInGroup)}
              className={`grid ${gridColumns} gap-4 px-4 py-3 group text-sm items-center transition-colors cursor-pointer ${bgHoverClass} ${radiusClass} ${marginClass}`}
            >
              <div className="text-neutral-400 w-4 h-4 flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-brand-gradient font-bold animate-pulse">🔊</span>
                ) : (
                  <>
                    <span className={`group-hover:hidden ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>
                      {index + 1}
                    </span>
                    <Play className="w-4 h-4 text-white hidden group-hover:block fill-current" />
                  </>
                )}
              </div>
              
              <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
                {track.album?.images?.[0]?.url ? (
                  <img src={track.album.images[0].url} alt={track.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center">🎵</div>
                )}
              </div>

              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                  {track.name}
                </span>
                <div className="text-neutral-400 text-xs truncate flex items-center gap-1">
                  {track.artists.map((artist, aIdx) => (
                    <span key={artist.id || aIdx} className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (artist.id) {
                            navigateToArtist(artist.id);
                          }
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
              
              <div className="truncate pr-4">
                {track.album?.id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateToAlbum(track.album.id);
                    }}
                    className="text-neutral-400 hover:text-white hover:underline transition-colors text-left truncate block w-full"
                  >
                    {track.album.name}
                  </button>
                ) : (
                  <span className="text-neutral-400 truncate">{track.album?.name}</span>
                )}
              </div>

              <div className="text-neutral-400 text-xs truncate">
                {formatDateAdded(item.added_at)}
              </div>

              {/* Collborator Tag Column */}
              {isCollaborative && (
                <div className="flex items-center space-x-2 truncate pr-4" title={collaboratorProfile?.display_name || adderId}>
                  {collaboratorProfile?.images?.[0]?.url ? (
                    <img src={collaboratorProfile.images[0].url} className="w-6 h-6 rounded-full object-cover shrink-0" alt="" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-neutral-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {(collaboratorProfile?.display_name || adderId || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-neutral-400 text-xs truncate">
                    {collaboratorProfile?.display_name || adderId}
                  </span>
                </div>
              )}
              
              <div 
                key={track.id}
                draggable="true"
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = 'all'; 
                  e.dataTransfer.setData('text/plain', track.uri);
                  setTimeout(() => setDraggedItem({ type: 'track', uri: track.uri }), 0);
                }}
                onDragEnd={() => setDraggedItem(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ 
                    type: 'track',
                    x: e.pageX, 
                    y: e.pageY, 
                    track: track, 
                    sourcePlaylistId: activePlaylistId 
                  }); 
                }}
                className="flex items-center justify-between gap-4 w-full h-full"
              >
                <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                </div>
                <span className="text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}