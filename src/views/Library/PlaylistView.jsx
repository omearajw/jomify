import { useEffect, useState, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import MoreButton from '../../components/MoreButton';
import { fetchPlaylistDetails, playPlaylistTrack, playUris, checkTracksLiked, updatePlaylist, uploadPlaylistCoverImage, fetchUserPlaylists, spotifyFetch, reorderPlaylistTracks, addTracksToPlaylist, removeTrackFromPlaylist } from '../../services/spotify/api';
import SortIntoChips from '../../components/SortIntoChips';
import { useUnaddedSuggestions, noteTrackSorted } from './useUnaddedSuggestions';
import SortMode from './SortMode';
import { SkeletonHeader, SkeletonRows } from '../../components/Skeleton';
import { toast } from '../../store/toastStore';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, Shuffle, RefreshCw, ListFilter, Check, X, ArrowUpDown, ArrowUp, ArrowDown, Users, ExternalLink, Undo2, Pencil, Layers } from 'lucide-react';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';
import UserChip from '../../components/UserChip';
import LikeButton from '../../components/LikeButton';
import PlaylistFormDialog from '../../components/PlaylistFormDialog';
import { cleanString } from '../../utils/strings';
import { collaboratorStyleFor } from '../../utils/collaboratorStyle';
import { rowButtonProps } from '../../utils/a11y';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { artUrl } from '../../utils/images';

// Rows rendered at once; more appear as you scroll. A 1000-track playlist used to mount every
// row (25k DOM nodes) up front.
const ROW_PAGE = 150;

// How long a sorted song's row stays as an Undo strip before it leaves the list
const UNDO_MS = 8000;

// Shown instead of a blank page when Spotify refuses the playlist. Since November 2024 Spotify
// blocks its own playlists (Discover Weekly, Blend, Daily Mix, Release Radar, Your Top Songs)
// for apps in development mode, which Jomify is.
function PlaylistLoadError({ playlistId, name, status, isSpotifyOwned }) {
  const blocked = isSpotifyOwned && (status === 403 || status === 404);
  return (
    <div className="mt-8 max-w-xl rounded-3xl border border-white/10 bg-neutral-900/60 p-8 animate-fade-in">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">{blocked ? 'Made by Spotify' : 'Playlist'}</p>
      <h1 className="text-3xl font-extrabold text-white tracking-tight mb-4 break-words">{name || 'This playlist'}</h1>
      {blocked ? (
        <p className="text-neutral-300 text-sm leading-relaxed">
          Spotify blocks this one for Jomify. Since November 2024 Spotify's API refuses its own playlists
          (Discover Weekly, Blend, Daily Mix, Release Radar, Your Top Songs) to apps that haven't been
          granted extended quota, and Jomify hasn't. The playlist still works in Spotify itself.
        </p>
      ) : (
        <p className="text-neutral-300 text-sm">Couldn't load this playlist (Spotify answered {status}). Try again in a moment.</p>
      )}
      <a
        href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-black hover:bg-neutral-200 transition-colors"
      >
        <ExternalLink className="w-4 h-4" /> Open in Spotify
      </a>
    </div>
  );
}

export default function PlaylistView() {
  const {
    token, updatePlaylistImage, playlists, activePlaylistId,
    setLikedTracks, setContextMenu, setDraggedItem, setPlaylists,
    navigateToArtist, navigateToAlbum,
    playlistSortSettings, setPlaylistSortSettings
  } = useSlice(useUserStore, [
    'token', 'updatePlaylistImage', 'playlists', 'activePlaylistId',
    'setLikedTracks', 'setContextMenu', 'setDraggedItem', 'setPlaylists',
    'navigateToArtist', 'navigateToAlbum',
    'playlistSortSettings', 'setPlaylistSortSettings'
  ]);

  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const [playlist, setPlaylist] = useState(null);
  // What the header shows: the loaded playlist, or the library's entry for it while that loads,
  // so the name, art and play controls are up before the tracks arrive
  const summary = playlists.find((p) => p.id === activePlaylistId);
  const view = playlist || (summary ? {
    ...summary,
    description: summary.description || '',
    owner: summary.owner || { display_name: '' },
    images: summary.images || [],
    tracks: { items: [], total: summary.tracks?.total ?? 0, next: null }
  } : null);
  // Keyed by playlist id so switching playlists needs no reset; { id, status }
  const [loadError, setLoadError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ROW_PAGE);
  const sentinelRef = useRef(null);

  // Collaborator profiles come from the shared cache (PlaylistView_2 and the Sevens page read
  // the same people)
  const collaborators = useUserProfilesStore((s) => s.profiles);

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortMenuRef = useRef(null);

  // The sort menu used to close only via its own button; click anywhere else or press Escape
  useEffect(() => {
    if (!sortDropdownOpen) return;
    const onClick = (e) => { if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) setSortDropdownOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setSortDropdownOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [sortDropdownOpen]);

  // Get current sort settings safely from Zustand (default to custom / asc)
  const currentSort = playlistSortSettings?.[activePlaylistId] || { sortBy: 'custom', sortOrder: 'asc' };
  const sortBy = currentSort.sortBy;
  const sortOrder = currentSort.sortOrder;

  const updateSortSettings = (newSortBy, newSortOrder) => {
    if (!activePlaylistId) return;
    setVisibleCount(ROW_PAGE);
    setPlaylistSortSettings(activePlaylistId, { sortBy: newSortBy, sortOrder: newSortOrder });
  };

  const isFetchingMore = useRef(false);
  // Mirrors isFetchingMore for rendering; the ref is what the loader checks
  const [fetchingMore, setFetchingMore] = useState(false);
  // Set when something needs every page (Sort mode); a one-page scroll load then keeps going
  const wantAllPages = useRef(false);

  // Computed once per render, not once per row
  const currentPlayingKey = currentPlayingTrack ? cleanString(currentPlayingTrack.name) : '';
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isUpdatingPlaylist, setIsUpdatingPlaylist] = useState(false);

  // --- "UNADDED SONGS" SYNC LOGIC STATES ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState([]);
  // This list used to live in its own localStorage key, which made it the one piece of real user
  // config that cross-device sync would have missed. It now rides along in the store like
  // everything else.
  const selectedCheckPlaylistIds = useUserStore((s) => s.unaddedCheckPlaylists);
  const setUnaddedCheckPlaylists = useUserStore((s) => s.setUnaddedCheckPlaylists);

  const isUnaddedSongsPlaylist = (view?.name || '').toLowerCase() === 'unadded songs';

  // Sort mode works from a snapshot of the list, and the suggestions are computed over that
  // snapshot while it is open so a filed song keeps its tiles after leaving the list
  const [sortQueue, setSortQueue] = useState(null);
  // --- "SORT INTO" CHIPS (Unadded Songs only) ---
  const { suggestionsByTrack, targets: sortTargets, status: suggestionStatus } = useUnaddedSuggestions({
    token,
    enabled: isUnaddedSongsPlaylist,
    checkPlaylistIds: selectedCheckPlaylistIds,
    items: sortQueue || playlist?.tracks?.items
  });
  // Every check playlist is a target from the start; the profiles only decide which are suggested
  const sortModeTargets = selectedCheckPlaylistIds.map((id) => ({
    id,
    name: sortTargets.find((t) => t.id === id)?.name || playlists.find((p) => p.id === id)?.name || 'Playlist'
  }));
  const openSortMode = () => {
    if (!playlist) return;
    setSortQueue(playlist.tracks.items.filter((i) => i?.track?.uri));
    wantAllPages.current = true;
    if (playlist.tracks.next && !isFetchingMore.current) loadRestOfTracks(playlist.tracks.next);
  };
  const [sortingUri, setSortingUri] = useState(null);

  // Sort mode files songs itself; the list here just follows
  const removeRow = (uri) => setPlaylist((prev) => {
    if (!prev) return prev;
    const items = prev.tracks.items.filter((i) => i?.track?.uri !== uri);
    return { ...prev, tracks: { ...prev.tracks, items, total: Math.max(0, (prev.tracks.total || items.length + 1) - 1) } };
  });
  const restoreRow = (item) => setPlaylist((prev) => {
    if (!prev || prev.tracks.items.some((i) => i?.track?.uri === item?.track?.uri)) return prev;
    const items = [...prev.tracks.items, item];
    return { ...prev, tracks: { ...prev.tracks, items, total: (prev.tracks.total || items.length - 1) + 1 } };
  });
  // uri -> { playlistId, playlistName, expiresAt }: songs moved out but still undoable
  const [sortedAway, setSortedAway] = useState({});
  const undoTimers = useRef({});

  const dropSortedRow = (uri) => {
    clearTimeout(undoTimers.current[uri]);
    delete undoTimers.current[uri];
    setSortedAway((prev) => { const next = { ...prev }; delete next[uri]; return next; });
    setPlaylist((prev) => {
      if (!prev) return prev;
      const items = prev.tracks.items.filter((i) => i?.track?.uri !== uri);
      return { ...prev, tracks: { ...prev.tracks, items, total: Math.max(0, (prev.tracks.total || items.length + 1) - 1) } };
    });
  };

  const sortTrackInto = async (item, playlistId) => {
    const track = item?.track;
    if (!token || !track?.uri || sortingUri) return;
    const playlistName = sortTargets.find((t) => t.id === playlistId)?.name || playlists.find((p) => p.id === playlistId)?.name || 'playlist';
    setSortingUri(track.uri);
    try {
      await addTracksToPlaylist(token, playlistId, [track.uri]);
      await removeTrackFromPlaylist(token, activePlaylistId, track.uri);
    } catch (err) {
      console.error('Sorting the track failed:', err);
      toast(`Couldn't move "${track.name}" to ${playlistName}`, { tone: 'error' });
      setSortingUri(null);
      return;
    }
    setSortingUri(null);
    noteTrackSorted(playlistId, track);
    clearTimeout(undoTimers.current[track.uri]);
    undoTimers.current[track.uri] = setTimeout(() => dropSortedRow(track.uri), UNDO_MS);
    setSortedAway((prev) => ({ ...prev, [track.uri]: { playlistId, playlistName, expiresAt: Date.now() + UNDO_MS } }));
  };

  const undoSort = async (item) => {
    const track = item?.track;
    const away = track?.uri ? sortedAway[track.uri] : null;
    if (!token || !away) return;
    clearTimeout(undoTimers.current[track.uri]);
    try {
      await removeTrackFromPlaylist(token, away.playlistId, track.uri);
      // Spotify appends on re-add, so after a reload the song sits at the bottom of this list
      await addTracksToPlaylist(token, activePlaylistId, [track.uri]);
    } catch (err) {
      console.error('Undo failed:', err);
      toast(`Couldn't bring "${track.name}" back`, { tone: 'error' });
      undoTimers.current[track.uri] = setTimeout(() => dropSortedRow(track.uri), UNDO_MS);
      return;
    }
    delete undoTimers.current[track.uri];
    setSortedAway((prev) => { const next = { ...prev }; delete next[track.uri]; return next; });
    toast(`"${track.name}" is back in Unadded Songs`, { tone: 'success' });
  };

  useEffect(() => {
    const timers = undoTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (configModalOpen && token) {
      fetchUserPlaylists(token).then((data) => {
        setUserPlaylists(data.items || []);
      }).catch(console.error);
    }
  }, [configModalOpen, token]);

  const togglePlaylistSelection = (id) => {
    setUnaddedCheckPlaylists(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Every page must load or the whole sync aborts. This function feeds a destructive
  // reconciliation: if the liked-songs fetch quietly returned [] on a 429, every track in the
  // playlist would read as "not liked" and be deleted. Throwing here is what prevents that.
  const fetchAllPages = async (initialUrl, label) => {
    let items = [];
    let url = initialUrl;
    while (url) {
      const res = await spotifyFetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`Couldn't load ${label} (Spotify returned ${res.status}). Nothing was changed.`);
      }
      const data = await res.json();
      if (!Array.isArray(data.items)) {
        throw new Error(`Unexpected response while loading ${label}. Nothing was changed.`);
      }
      items.push(...data.items);
      url = data.next;
    }
    return items;
  };

  const runUnaddedSongsSync = async () => {
    if (!token || !playlist || isSyncing) return;
    setIsSyncing(true);
    setSyncStatusText('Fetching all liked songs...');

    try {
      const allLikedSongs = await fetchAllPages('https://api.spotify.com/v1/me/tracks?limit=50', 'your liked songs');

      setSyncStatusText('Scanning check playlists...');

      const playlistTrackIds = new Set();
      for (const checkId of selectedCheckPlaylistIds) {
        const checkTracks = await fetchAllPages(`https://api.spotify.com/v1/playlists/${checkId}/tracks?limit=100`, 'a check playlist');
        for (const item of checkTracks) {
          if (item.track && item.track.id) {
            const cleanedName = cleanString(item.track.name);
            playlistTrackIds.add(item.track.id);
            playlistTrackIds.add(`${cleanedName}_${item.track.artists?.[0]?.name ? cleanString(item.track.artists[0].name) : ''}`);
          }
        }
      }

      setSyncStatusText('Scanning current Unadded Songs playlist...');

      const currentUnaddedTracks = await fetchAllPages(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`, 'this playlist');

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
          const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tracks: chunk })
          });
          if (!res.ok) {
            throw new Error(`Removing tracks failed partway (Spotify returned ${res.status}). Re-run the check to finish.`);
          }
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
          const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: batch })
          });
          if (!res.ok) {
            throw new Error(`Adding tracks failed partway (Spotify returned ${res.status}). Re-run the check to finish.`);
          }
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
      // The thrown messages say what failed and whether anything changed -- show them, and
      // leave them up long enough to actually read.
      setSyncStatusText(err?.message || 'Sync failed. Nothing was changed.');
      setTimeout(() => {
        setIsSyncing(false);
        setSyncStatusText('');
      }, 6000);
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
      setVisibleCount(ROW_PAGE);
      isFetchingMore.current = false;
      wantAllPages.current = false;

      const requestedId = activePlaylistId;
      spotifyFetch(`https://api.spotify.com/v1/playlists/${activePlaylistId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(async (res) => {
          // Spotify-owned playlists come back 403/404 for apps in development mode; say so
          // instead of spinning forever
          if (!res.ok) { setLoadError({ id: requestedId, status: res.status }); return null; }
          return res.json();
        })
        .then(async (data) => {
          if (!data) return;
          setPlaylist(data);
          checkLikesForChunk(data.tracks.items);

          // Custom order pages in as you scroll (see the sentinel below); a sorted view needs
          // every track to sort honestly, so it still loads the lot
          if (data.tracks.next && !isFetchingMore.current && sortBy !== 'custom') {
            loadRestOfTracks(data.tracks.next);
          }
        })
        .catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activePlaylistId]); 

  // --- BACKGROUND STREAMING ---
  // A declaration so the load effect above can call it: declarations hoist, and it only runs
  // after mount anyway
  async function loadRestOfTracks(initialNextUrl, maxPages = Infinity) {
    isFetchingMore.current = true;
    setFetchingMore(true);
    let nextUrl = initialNextUrl;
    let pagesLoaded = 0;

    while (nextUrl) {
      try {
        const res = await spotifyFetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
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
        
        // Sort mode's pile grows as pages land; it never shrinks
        setSortQueue((prev) => {
          if (!prev) return prev;
          const seen = new Set(prev.map((i) => i?.track?.uri));
          return [...prev, ...nextData.items.filter((i) => i?.track?.uri && !seen.has(i.track.uri))];
        });
        checkLikesForChunk(nextData.items);
        nextUrl = nextData.next;
        if (++pagesLoaded >= maxPages && !wantAllPages.current) break;
      } catch {
        break;
      }
    }
    isFetchingMore.current = false;
    setFetchingMore(false);
  };

  // --- DYNAMIC COLLABORATIVE DETECTOR ---
  const isCollaborative = useMemo(() => {
    if (!playlist) return false;
    if (playlist.collaborative) return true;
    
    return playlist.tracks?.items?.some(
      (item) => item.added_by?.id && item.added_by.id !== playlist.owner.id
    );
  }, [playlist]);

  // --- COLLABORATOR HYDRATION ---
  useEffect(() => {
    if (!token || !isCollaborative || !playlist?.tracks?.items) return;
    ensureUserProfiles(token, playlist.tracks.items.map(i => i.added_by?.id));
  }, [playlist?.tracks?.items, isCollaborative, token]);

  // The play request for a row, run on whichever device playOn settles on
  const startTrack = (deviceId, originalIndex) => {
    // A sorted view plays in the order on screen. That means sending explicit URIs (Spotify caps
    // the list at ~100, so it's a window from the clicked row) rather than the playlist context,
    // which would continue in Spotify's stored order regardless of what's displayed.
    if (sortBy !== 'custom') {
      const uris = sortedTracks.slice(originalIndex, originalIndex + 100).map(item => item.track?.uri).filter(Boolean);
      return uris.length > 0 ? playUris(token, deviceId, uris, 0) : Promise.resolve();
    }

    // Custom order keeps the playlist context so Spotify shows "playing from <playlist>". Match
    // the row by identity, not by track id: a playlist with the same song twice used to start
    // at the first copy whichever one you clicked.
    const targetTrack = sortedTracks[originalIndex];
    let realIndex = playlist.tracks.items.indexOf(targetTrack);
    if (realIndex === -1) realIndex = playlist.tracks.items.findIndex(item => item.track?.uri === targetTrack.track?.uri);
    return realIndex !== -1 ? playPlaylistTrack(token, deviceId, activePlaylistId, realIndex) : Promise.resolve();
  };

  const handleTrackSelect = (originalIndex) => {
    if (!token) return;
    // Before the tracks arrive, Play still works: the playlist context starts from the top
    if (!playlist) {
      if (originalIndex === 0 && activePlaylistId) playOn((deviceId) => playPlaylistTrack(token, deviceId, activePlaylistId, 0));
      return;
    }
    playOn((deviceId) => startTrack(deviceId, originalIndex));
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

  // One-step moves for your own playlists in custom order, through the track menu. Spotify's
  // reorder call moves the track at rangeStart to sit before insertBefore; the list is updated
  // first and put back if Spotify refuses.
  const moveTrack = (index, delta) => {
    const items = playlist?.tracks?.items || [];
    const to = index + delta;
    if (!token || !activePlaylistId || to < 0 || to >= items.length) return;
    setPlaylist((prev) => {
      if (!prev) return prev;
      const next = [...prev.tracks.items];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved);
      return { ...prev, tracks: { ...prev.tracks, items: next } };
    });
    reorderPlaylistTracks(token, activePlaylistId, index, delta < 0 ? to : to + 1).catch((err) => {
      console.error(err);
      toast("Spotify wouldn't move that track", { tone: 'error' });
      setPlaylist((prev) => {
        if (!prev) return prev;
        const next = [...prev.tracks.items];
        const [moved] = next.splice(to, 1);
        next.splice(index, 0, moved);
        return { ...prev, tracks: { ...prev.tracks, items: next } };
      });
    });
  };

  const handleRightClick = (e, track, item = null) => {
    e.preventDefault();
    const items = playlist?.tracks?.items || [];
    const index = item ? items.indexOf(item) : -1;
    const isMine = playlist?.owner?.id && playlist.owner.id === useUserStore.getState().profile?.id;
    const reorder = isMine && sortBy === 'custom' && index !== -1
      ? { index, count: items.length, move: (delta) => moveTrack(index, delta) }
      : null;
    setContextMenu({
      type: 'track',
      x: e.clientX,
      y: e.clientY,
      track: track,
      sourcePlaylistId: activePlaylistId,
      reorder
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

  // Reveal the next page of rows when the sentinel below the list scrolls near the viewport
  const totalRows = sortedTracks.length;
  const nextPageUrl = playlist?.tracks?.next || null;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || (visibleCount >= totalRows && !nextPageUrl)) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      if (visibleCount < totalRows) setVisibleCount(n => Math.min(n + ROW_PAGE, totalRows));
      else if (nextPageUrl && !isFetchingMore.current) loadRestOfTracks(nextPageUrl, 1);
    }, { rootMargin: '800px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  // loadRestOfTracks is a hoisted declaration that only reads the token; listing it would re-run this every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount, totalRows, nextPageUrl]);

  // Switching to a sorted view while pages are still unloaded: fetch the rest now
  useEffect(() => {
    if (sortBy !== 'custom' && nextPageUrl && !isFetchingMore.current) loadRestOfTracks(nextPageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, nextPageUrl]);

  // Shuffle play: switch shuffle on, then start somewhere random so it doesn't always open on
  // the first track like a plain Play with shuffle would
  const handleShufflePlay = () => {
    // Custom order plays by position in Spotify's order, so it can land on a page that hasn't
    // loaded yet (or before any page has); a sorted view can only pick from what is on screen
    const custom = sortBy === 'custom';
    const total = custom ? (view?.tracks?.total || sortedTracks.length) : sortedTracks.length;
    if (!token || total === 0 || (!custom && !playlist)) return;
    const index = Math.floor(Math.random() * total);
    playOn(async (deviceId) => {
      await setShuffle(true, deviceId);
      if (custom) await playPlaylistTrack(token, deviceId, activePlaylistId, index);
      else await startTrack(deviceId, index);
    });
  };

  if (!playlist) {
    if (loadError?.id === activePlaylistId) {
      const summary = playlists.find(p => p.id === activePlaylistId);
      return (
        <PlaylistLoadError
          playlistId={activePlaylistId}
          name={summary?.name}
          status={loadError.status}
          isSpotifyOwned={summary?.owner?.id === 'spotify'}
        />
      );
    }
    if (!view) {
      return (
        <div className="flex flex-col pb-8 mt-2 md:mt-4">
          <SkeletonHeader />
          <SkeletonRows count={8} />
        </div>
      );
    }
  }

  // Phone: art, title/artists, like + duration + menu. Desktop keeps the full table.
  const gridColumns = isCollaborative
    ? "grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_120px_140px_80px]"
    : "grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px]";

  return (
    <div className="flex flex-col pb-8">
      {/* Playlist Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-4 md:mb-8 mt-2 md:mt-4 select-none gap-4 md:gap-6">
        <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 min-w-0">
          {view.images?.length > 0 ? (
            <img src={view.images[0].url} alt={view.name} className="w-24 h-24 md:w-48 md:h-48 shadow-2xl shadow-black/50 rounded shrink-0" />
          ) : (
            <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded shrink-0"> 🎵 </div>
          )}
          <div className="min-w-0">
            <p className="hidden md:flex text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2 items-center gap-2">
              Playlist
              {isCollaborative && (
                <span className="bg-[var(--brand-mid)]/20 text-[var(--brand-mid)] border border-[var(--brand-mid)]/30 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                  <Users className="w-3 h-3" />
                  Collaborative
                </span>
              )}
            </p>
            <h1 className="text-2xl md:text-5xl lg:text-7xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{view.name}</h1>
            <p className="text-neutral-400 text-sm font-medium">
              {view.description && <span className="mr-2 hidden md:inline">{view.description} •</span>}
              {isCollaborative && <span className="md:hidden">Collaborative • </span>}
              {view.owner.display_name} • {playlist || view.tracks.total > 0 ? view.tracks.total : '…'} songs
            </p>
            {view.description && <p className="md:hidden text-neutral-500 text-xs mt-1 line-clamp-1">{view.description}</p>}
          </div>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-3">
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
                // With no check playlists selected, every liked song would count as "unadded"
                // and be pushed into this playlist.
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                title={selectedCheckPlaylistIds.length === 0 ? 'Select at least one playlist to check against first' : undefined}
                className="flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-brand-glow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? (syncStatusText || 'Syncing...') : 'Run Unadded Check'}
              </button>
              <button
                type="button"
                onClick={openSortMode}
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                title={selectedCheckPlaylistIds.length === 0 ? 'Select at least one playlist to check against first' : 'Sort songs one at a time'}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                <Layers className="w-4 h-4" />
                Sort songs
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

      {sortQueue && (
        <SortMode
          items={sortQueue}
          total={playlist.tracks.total}
          loadingMore={Boolean(nextPageUrl) && fetchingMore}
          suggestionsByTrack={suggestionsByTrack}
          suggestionsReady={suggestionStatus === 'ready' || suggestionStatus === 'error'}
          targets={sortModeTargets}
          sourcePlaylistId={activePlaylistId}
          onRemovedFromSource={removeRow}
          onRestoredToSource={restoreRow}
          onClose={() => setSortQueue(null)}
        />
      )}

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
      {/* Play / Shuffle: same on desktop and phone */}
      <div ref={sortMenuRef} className="relative mb-4 md:mb-6 px-1 md:px-4 select-none">
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          onClick={() => handleTrackSelect(0)}
          aria-label={`Play ${view.name}`}
          className="w-12 h-12 md:w-14 md:h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
        >
          <Play className="w-6 h-6 fill-current ml-1" />
        </button>
        <button
          type="button"
          onClick={handleShufflePlay}
          aria-label="Shuffle play"
          title="Shuffle play"
          className={`w-11 h-11 flex items-center justify-center rounded-full hover:scale-110 active:scale-95 transition-all ${isShuffled ? 'text-brand-gradient' : 'text-neutral-400 hover:text-white'}`}
        >
          <Shuffle className="w-6 h-6" />
        </button>
        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          {isUnaddedSongsPlaylist && (
            <>
              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                disabled={isSyncing}
                aria-label={`Select playlists to check against (${selectedCheckPlaylistIds.length} selected)`}
                className="relative w-11 h-11 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-white disabled:opacity-50"
              >
                <ListFilter className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand-mid)] text-[10px] font-bold text-white flex items-center justify-center">{selectedCheckPlaylistIds.length}</span>
              </button>
              <button
                type="button"
                onClick={runUnaddedSongsSync}
                disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-brand-gradient px-3 h-11 text-xs font-semibold text-white whitespace-nowrap shadow-brand-glow disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing' : 'Run check'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            aria-haspopup="menu"
            aria-expanded={sortDropdownOpen}
            aria-label={`Sort by ${sortBy.replace('_', ' ')}, ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${sortBy !== 'custom' ? 'border-[var(--brand-mid)]/50 bg-[var(--brand-mid)]/15 text-white' : 'border-white/10 bg-neutral-900 text-neutral-300'}`}
          >
            <ArrowUpDown className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setEditDialogOpen(true)}
            aria-label="Edit playlist"
            className="w-11 h-11 rounded-full border border-white/10 bg-neutral-900 flex items-center justify-center text-neutral-300"
          >
            <Pencil className="w-5 h-5" />
          </button>
        </div>
      </div>
      {isUnaddedSongsPlaylist && isSyncing && syncStatusText && (
        <p className="md:hidden text-xs text-neutral-400 mt-2 px-1">{syncStatusText}</p>
      )}
      {isUnaddedSongsPlaylist && (
        <button
          type="button"
          onClick={openSortMode}
          disabled={isSyncing || selectedCheckPlaylistIds.length === 0}
          className="md:hidden mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-white text-black h-11 text-sm font-bold disabled:opacity-50"
        >
          <Layers className="w-4 h-4" /> Sort songs one by one
        </button>
      )}

      <div className="hidden md:flex items-center justify-end mt-6">
        <div>
          <button
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            aria-haspopup="menu"
            aria-expanded={sortDropdownOpen}
            className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
          >
            <ArrowUpDown className="w-4 h-4 text-neutral-400" />
            <span>Sort by: <strong className="text-white capitalize">{sortBy.replace('_', ' ')}</strong> ({sortOrder.toUpperCase()})</span>
          </button>

        </div>
      </div>
      {sortDropdownOpen && (
        <div className="absolute right-1 md:right-4 top-full mt-2 w-56 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl z-30 p-2 flex flex-col space-y-1">
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

      {/* Tracklist Header */}
      <div className={`hidden md:grid ${gridColumns} gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none`}>
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
          initialName={view.name}
          initialDescription={view.description || ''}
          initialImageUrl={view.images?.[0]?.url || ''}
          onSubmit={handleUpdatePlaylist}
          onCancel={() => setEditDialogOpen(false)}
          isSubmitting={isUpdatingPlaylist}
        />
        {!playlist && <SkeletonRows count={8} />}
        {sortedTracks.slice(0, visibleCount).map((item, index) => {
          if (!item || !item.track) return null;
          const track = item.track;

          const isCurrentTrack = currentPlayingTrack && (
            track.id === currentPlayingTrack.id ||
            track.uri === currentPlayingTrack.uri ||
            (track.linked_from && track.linked_from.id === currentPlayingTrack.id) ||
            (cleanString(track.name) === currentPlayingKey &&
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
            ? 'bg-[hsla(var(--track-hue),40%,40%,0.02)] hover:bg-[hsla(var(--track-hue),40%,40%,0.06)]'
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

          const away = isUnaddedSongsPlaylist ? sortedAway[track.uri] : null;
          if (away) {
            return (
              <div key={`${track.id}-${index}-away`} className="relative overflow-hidden rounded-md bg-white/5 px-4 py-3 my-0.5 flex items-center gap-4 text-sm animate-fade-in">
                <div className="flex-1 min-w-0 text-neutral-300 truncate">
                  <span className="text-white font-medium">{track.name}</span> moved to <span className="text-white font-medium">{away.playlistName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => undoSort(item)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 shrink-0"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
                <div
                  key={away.expiresAt}
                  className="absolute left-0 bottom-0 h-0.5 bg-[var(--brand-mid)] animate-[undo-drain_linear_forwards]"
                  style={{ animationDuration: `${UNDO_MS}ms` }}
                />
              </div>
            );
          }

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={() => handleTrackSelect(index)}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => handleRightClick(e, track, item)}
              style={collaboratorStyleFor(adderId, isCollaborative, isFirstInGroup, isLastInGroup)}
              className={`grid ${gridColumns} gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3 group text-sm items-center transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${bgHoverClass} ${radiusClass} ${marginClass}`}
            >
              <div className="text-neutral-400 w-4 h-4 hidden md:flex items-center justify-center">
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
              
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-md overflow-hidden flex-shrink-0">
                {track.album?.images?.[0]?.url ? (
                  <img src={artUrl(track.album.images, 48)} alt={track.name} width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
                        className="hover:underline hover:text-white transition-colors text-left truncate pointer-coarse:pointer-events-none"
                      >
                        {artist.name}
                      </button>
                      {aIdx < track.artists.length - 1 && <span className="mr-1">,</span>}
                    </span>
                  ))}
                </div>
                {isUnaddedSongsPlaylist && (
                  <SortIntoChips
                    suggestions={suggestionsByTrack.get(track.id) || []}
                    targets={sortTargets}
                    busy={sortingUri === track.uri}
                    onPick={(playlistId) => sortTrackInto(item, playlistId)}
                  />
                )}
              </div>
              
              <div className="hidden md:block truncate pr-4">
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

              <div className="hidden md:block text-neutral-400 text-xs truncate">
                {formatDateAdded(item.added_at)}
              </div>

              {/* Collborator Tag Column */}
              {isCollaborative && (
                <div className="hidden md:flex items-center truncate pr-4">
                  <UserChip userId={adderId} fallbackName={collaboratorProfile?.display_name || adderId} size="sm" />
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
                className="flex items-center justify-between gap-2 md:gap-4 w-full h-full"
              >
                <LikeButton trackId={track.id} />
                <span className="hidden md:inline text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
                <MoreButton onOpen={(e) => handleRightClick(e, track, item)} />
              </div>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && (
          <div ref={sentinelRef} className="py-6 text-center text-xs text-neutral-500">
            {Math.max(0, (playlist.tracks.total || totalRows) - Math.min(visibleCount, totalRows))} more…
          </div>
        )}
      </div>
    </div>
  );
}