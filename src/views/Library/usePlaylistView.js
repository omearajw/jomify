import { useEffect, useState, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { setShuffle } from '../../services/spotify/playbackController';
import { startPlaying } from '../../queue/play';
import { fetchPlaylistDetails, playPlaylistTrack, playUris, checkTracksLiked, updatePlaylist, uploadPlaylistCoverImage, fetchUserPlaylists, spotifyFetch, reorderPlaylistTracks, addTracksToPlaylist, removeTrackFromPlaylist, removeTracksFromPlaylist, fetchMoreTracks, followPlaylist, unfollowPlaylist, searchSpotify } from '../../services/spotify/api';
import { playlistItemsUrl, normalizePlaylist } from '../../services/spotify/compat';
import { useUnaddedSuggestions, noteTrackSorted } from './useUnaddedSuggestions';
import { toast } from '../../store/toastStore';
import { fromSpotifyText } from '../../utils/strings';
import { formatDuration } from '../../utils/formatTime';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';
import { cleanString } from '../../utils/strings';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { scrollParent } from '../../utils/dom';
import { isUnplayable, unplayableWhy, applyPlayability } from '../../utils/spotifyUri';
import { confirmPlayability } from '../../services/playability';
import { useSelection } from '../../hooks/useSelection';

// Rows rendered at once; more appear as you scroll. A 1000-track playlist used to mount every
// row (25k DOM nodes) up front.
export const ROW_PAGE = 150;

// How long a sorted song's row stays as an Undo strip before it leaves the list
export const UNDO_MS = 8000;

// Everything the playlist page does, with no markup: loading and paging, sort and find, play,
// selection, reorder, likes, playability, collaborators, edit, save, add-songs and the unadded
// check. The old page (PlaylistView.jsx) and the room's surface (src/room/RoomPlaylist.jsx) are
// two faces on this one hook, so a fix here reaches both.
export function usePlaylistView() {
  const {
    token, updatePlaylistImage, playlists, activePlaylistId,
    setLikedTracks, setContextMenu, setDraggedItem, setPlaylists,
    navigateToArtist, navigateToAlbum, setCurrentView,
    playlistSortSettings, setPlaylistSortSettings
  } = useSlice(useUserStore, [
    'token', 'updatePlaylistImage', 'playlists', 'activePlaylistId',
    'setLikedTracks', 'setContextMenu', 'setDraggedItem', 'setPlaylists',
    'navigateToArtist', 'navigateToAlbum', 'setCurrentView',
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
  const [reloadNonce, setReloadNonce] = useState(0);
  const retryLoad = () => { setLoadError(null); setReloadNonce((n) => n + 1); };
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
  // The playlist this view has already loaded. The effect below needs the token to fetch at
  // all, but the token rotates about once an hour, and re-running on that used to blank the
  // playlist under whatever was on screen.
  const loadedPlaylistId = useRef(null);
  // Mirrors isFetchingMore for rendering; the ref is what the loader checks
  const [fetchingMore, setFetchingMore] = useState(false);
  // Set when something needs every page (Sort mode); a one-page scroll load then keeps going
  const wantAllPages = useRef(false);

  const [editDialogOpen, setEditDialogOpen] = useState(() => useUserStore.getState().editPlaylistRequest === activePlaylistId);
  useEffect(() => {
    if (useUserStore.getState().editPlaylistRequest) useUserStore.getState().clearEditPlaylistRequest();
  }, [activePlaylistId]);

  // Someone else's playlist: in the library (followed) or not; saving follows it
  const inLibrary = playlists.some((p) => p.id === activePlaylistId);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const toggleSaved = async () => {
    if (!token || !view || savingPlaylist) return;
    setSavingPlaylist(true);
    try {
      if (inLibrary) {
        await unfollowPlaylist(token, activePlaylistId);
        setPlaylists(playlists.filter((p) => p.id !== activePlaylistId));
        toast(`Removed "${view.name}" from your library`, { tone: 'info' });
      } else {
        await followPlaylist(token, activePlaylistId);
        setPlaylists([...playlists, { id: view.id, name: view.name, images: view.images, owner: view.owner, tracks: { total: view.tracks?.total ?? 0 }, collaborative: Boolean(view.collaborative), type: 'playlist' }]);
        toast(`Saved "${view.name}" to your library`, { tone: 'success' });
      }
    } catch (err) {
      console.error(err);
      toast(inLibrary ? "Couldn't remove the playlist" : "Couldn't save the playlist", { tone: 'error' });
    } finally {
      setSavingPlaylist(false);
    }
  };
  const [isUpdatingPlaylist, setIsUpdatingPlaylist] = useState(false);

  // --- "UNADDED SONGS" SYNC LOGIC STATES ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  // null until the list arrives, so the picker can show it is loading rather than empty
  const [userPlaylists, setUserPlaylists] = useState(null);
  const [pickerError, setPickerError] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
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

  // A song removed through its menu takes the same undo strip as one sorted away, with nothing
  // to take it back out of. The row used to stay on screen until a reload, with no way back.
  const markRemoved = (track) => {
    if (!track?.uri) return;
    clearTimeout(undoTimers.current[track.uri]);
    undoTimers.current[track.uri] = setTimeout(() => dropSortedRow(track.uri), UNDO_MS);
    setSortedAway((prev) => ({ ...prev, [track.uri]: { removed: true, expiresAt: Date.now() + UNDO_MS } }));
  };
  const markRemovedMany = (tracks) => tracks.forEach(markRemoved);

  const undoSort = async (item) => {
    const track = item?.track;
    const away = track?.uri ? sortedAway[track.uri] : null;
    if (!token || !away) return;
    clearTimeout(undoTimers.current[track.uri]);
    try {
      if (!away.removed) await removeTrackFromPlaylist(token, away.playlistId, track.uri);
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
    toast(away.removed ? `"${track.name}" is back` : `"${track.name}" is back in Unadded Songs`, { tone: 'success' });
  };

  useEffect(() => {
    const timers = undoTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (!configModalOpen || !token) return undefined;
    let cancelled = false;
    // Start from the library's own list so the picker is never blank; the fetch fills in the rest
    fetchUserPlaylists(token).then((data) => {
      if (!cancelled) setUserPlaylists(data.items || []);
    }).catch((err) => {
      console.error(err);
      if (!cancelled) setPickerError("Couldn't load your playlists. Showing what the library already has.");
    });
    const onKey = (e) => { if (e.key === 'Escape') setConfigModalOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { cancelled = true; document.removeEventListener('keydown', onKey); };
  }, [configModalOpen, token]);
  const pickerNeedle = pickerQuery.trim().toLowerCase();
  const pickerList = (userPlaylists || playlists).filter((p) => p && (!pickerNeedle || (p.name || '').toLowerCase().includes(pickerNeedle)));

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
      let data;
      // fetchMoreTracks knows the new and old names for a playlist's pages and throws on a bad one
      try { data = await fetchMoreTracks(token, url); }
      catch (err) { throw new Error(`Couldn't load ${label} (${err?.status ? `Spotify returned ${err.status}` : err?.message || 'no answer'}). Nothing was changed.`, { cause: err }); }
      if (!Array.isArray(data.items)) {
        throw new Error(`Unexpected response while loading ${label}. Nothing was changed.`);
      }
      items.push(...data.items);
      url = data.next;
    }
    return items;
  };

  // Step 1: work out what the check would change, and show it before anything is touched
  const [unaddedPlan, setUnaddedPlan] = useState(null);
  const runUnaddedSongsSync = async () => {
    if (!token || !playlist || isSyncing) return;
    setIsSyncing(true);
    setSyncStatusText('Fetching all liked songs...');

    try {
      const allLikedSongs = await fetchAllPages('https://api.spotify.com/v1/me/tracks?limit=50', 'your liked songs');

      setSyncStatusText('Scanning check playlists...');

      const playlistTrackIds = new Set();
      for (const checkId of selectedCheckPlaylistIds) {
        const checkTracks = await fetchAllPages(playlistItemsUrl(checkId, 'limit=100'), 'a check playlist');
        for (const item of checkTracks) {
          if (item.track && item.track.id) {
            const cleanedName = cleanString(item.track.name);
            playlistTrackIds.add(item.track.id);
            playlistTrackIds.add(`${cleanedName}_${item.track.artists?.[0]?.name ? cleanString(item.track.artists[0].name) : ''}`);
          }
        }
      }

      setSyncStatusText('Scanning current Unadded Songs playlist...');

      const currentUnaddedTracks = await fetchAllPages(playlistItemsUrl(playlist.id, 'limit=100'), 'this playlist');

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
          tracksToRemove.push({ uri: tr.uri, name: tr.name, artist: tr.artists?.[0]?.name || '', reason: !isLiked ? 'unliked' : 'sorted' });
        }
      }

      const newUnaddedUris = [];
      for (const item of allLikedSongs) {
        const tr = item.track;
        if (!tr || !tr.id) continue;
        const cleanedName = cleanString(tr.name);
        const artistKey = `${cleanedName}_${tr.artists?.[0]?.name ? cleanString(tr.artists[0].name) : ''}`;

        const isPresentInPlaylists = playlistTrackIds.has(tr.id) || playlistTrackIds.has(artistKey);
        const isAlreadyInUnadded = currentUnaddedTrackIds.has(tr.id);

        if (!isPresentInPlaylists && !isAlreadyInUnadded) {
          newUnaddedUris.push({ uri: `spotify:track:${tr.id}`, name: tr.name, artist: tr.artists?.[0]?.name || '' });
        }
      }

      setIsSyncing(false);
      setSyncStatusText('');
      if (tracksToRemove.length === 0 && newUnaddedUris.length === 0) {
        toast('Already up to date: nothing to add or remove.');
        return;
      }
      setUnaddedPlan({ remove: tracksToRemove, add: newUnaddedUris });
    } catch (err) {
      console.error('Error planning the unadded check:', err);
      setSyncStatusText(err?.message || 'Check failed. Nothing was changed.');
      setTimeout(() => {
        setIsSyncing(false);
        setSyncStatusText('');
      }, 6000);
    }
  };

  // Step 2: the changes the dialog showed, and only those
  const applyUnaddedPlan = async () => {
    const plan = unaddedPlan;
    setUnaddedPlan(null);
    if (!plan || !token || !playlist) return;
    setIsSyncing(true);
    try {
      const tracksToRemove = plan.remove.map(({ uri }) => ({ uri }));
      if (tracksToRemove.length > 0) {
        setSyncStatusText(`Removing ${tracksToRemove.length} sorted/unliked tracks...`);
        for (let i = 0; i < tracksToRemove.length; i += 100) {
          const chunk = tracksToRemove.slice(i, i + 100);
          try { await removeTracksFromPlaylist(token, playlist.id, chunk.map((t) => t.uri)); }
          catch (err) { throw new Error(`Removing tracks failed partway (Spotify returned ${err?.status || '?'}). Re-run the check to finish.`, { cause: err }); }
        }
      }

      const newUnaddedUris = plan.add.map(({ uri }) => uri);
      if (newUnaddedUris.length > 0) {
        setSyncStatusText(`Adding ${newUnaddedUris.length} new unadded songs...`);
        for (let i = 0; i < newUnaddedUris.length; i += 100) {
          const batch = newUnaddedUris.slice(i, i + 100);
          try { await addTracksToPlaylist(token, playlist.id, batch); }
          catch (err) { throw new Error(`Adding tracks failed partway (${err?.message || 'Spotify refused'}). Re-run the check to finish.`, { cause: err }); }
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
      if (loadedPlaylistId.current === activePlaylistId) return;
      loadedPlaylistId.current = activePlaylistId;

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
          // Forget the load so a later attempt (a token refresh, coming back to the page) retries
          if (!res.ok) { loadedPlaylistId.current = null; setLoadError({ id: requestedId, status: res.status }); return null; }
          // The songs sit under `items` now and `tracks` before; the page reads `tracks`
          return normalizePlaylist(await res.json());
        })
        .then(async (data) => {
          if (!data) return;
          setPlaylist(data);
          checkLikesForChunk(data.tracks.items);
          confirmRows(data.tracks.items);

          // Custom order pages in as you scroll (see the sentinel below); a sorted view needs
          // every track to sort honestly, so it still loads the lot
          if (data.tracks.next && !isFetchingMore.current && sortBy !== 'custom') {
            loadRestOfTracks(data.tracks.next);
          }
        })
        .catch((err) => {
          // A dropped connection used to leave the skeleton up for good; it gets the same card
          // as an HTTP failure, with a way to try again
          loadedPlaylistId.current = null;
          console.error(err);
          setLoadError({ id: requestedId, status: 0, reason: err?.message === 'RATE_LIMITED' ? 'rate-limited' : 'network' });
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activePlaylistId, reloadNonce]); 

  // --- BACKGROUND STREAMING ---
  // A declaration so the load effect above can call it: declarations hoist, and it only runs
  // after mount anyway
  // Rows the page greyed on a market list alone are confirmed with Spotify and patched
  function confirmRows(items) {
    confirmPlayability(token, items, country).then((answers) => {
      if (!Object.keys(answers).length) return;
      setPlaylist((prev) => (prev ? { ...prev, tracks: { ...prev.tracks, items: applyPlayability(prev.tracks.items, answers) } } : prev));
    });
  }

  async function loadRestOfTracks(initialNextUrl, maxPages = Infinity) {
    isFetchingMore.current = true;
    setFetchingMore(true);
    let nextUrl = initialNextUrl;
    let pagesLoaded = 0;

    while (nextUrl) {
      try {
        const nextData = await fetchMoreTracks(token, nextUrl);
        
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
        confirmRows(nextData.items);
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
    const realIndex = realIndexOf(originalIndex);
    return realIndex !== -1 ? playPlaylistTrack(token, deviceId, activePlaylistId, realIndex) : Promise.resolve();
  };
  const realIndexOf = (originalIndex) => {
    const targetTrack = sortedTracks[originalIndex];
    const at = playlist.tracks.items.indexOf(targetTrack);
    return at !== -1 ? at : playlist.tracks.items.findIndex(item => item.track?.uri === targetTrack?.track?.uri);
  };

  // For the queue (src/queue): the playlist itself in its own order (the queue loads whatever has
  // not loaded yet); a sorted view is the list on screen, in that order
  const playlistSource = (extra) => {
    const name = playlist?.name || view?.name || '';
    if (sortBy !== 'custom') return { kind: 'list', name, tracks: sortedTracks.map((i) => i.track), ...extra };
    const complete = playlist && !playlist.tracks?.next;
    return { uri: `spotify:playlist:${activePlaylistId}`, kind: 'playlist', name, ...(complete ? { tracks: playlist.tracks.items.map((i) => i.track) } : {}), ...extra };
  };

  const handleTrackSelect = (originalIndex) => {
    if (!token) return;
    if (playlist && isUnplayable(sortedTracks[originalIndex]?.track, country)) { toast(`${unplayableWhy(sortedTracks[originalIndex]?.track, country)}.`); return; }
    // Before the tracks arrive, Play still works: the playlist context starts from the top
    if (!playlist) {
      if (originalIndex === 0 && activePlaylistId) startPlaying(playlistSource({ start: 0 }), (deviceId) => playPlaylistTrack(token, deviceId, activePlaylistId, 0));
      return;
    }
    const start = sortBy === 'custom' ? realIndexOf(originalIndex) : originalIndex;
    if (start === -1) return;
    startPlaying(playlistSource({ start, track: sortedTracks[originalIndex]?.track }), (deviceId) => startTrack(deviceId, originalIndex));
  };

  const handleUpdatePlaylist = async ({ name, description, imageFile, isPublic, collaborative }) => {
    if (!token || !activePlaylistId) return;
    setIsUpdatingPlaylist(true);

    try {
      // The description goes only when it changed. It used to go every time, so renaming a
      // playlist with no description sent an empty one, which Spotify refuses with a 400.
      const changes = { name };
      if (description !== fromSpotifyText(view.description)) changes.description = description;
      if (isPublic !== undefined && isPublic !== Boolean(view.public)) changes.public = isPublic;
      if (collaborative !== undefined && collaborative !== Boolean(view.collaborative)) changes.collaborative = collaborative;
      const updated = await updatePlaylist(token, activePlaylistId, changes);
      
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
      
      const nextDescription = updated.description ?? view.description;
      if (changes.public !== undefined || changes.collaborative !== undefined) {
        const flags = { ...(changes.public !== undefined ? { public: changes.public } : {}), ...(changes.collaborative !== undefined ? { collaborative: changes.collaborative } : {}) };
        setPlaylist((prev) => (prev ? { ...prev, ...flags } : prev));
        setPlaylists(playlists.map((p) => (p.id === activePlaylistId ? { ...p, ...flags } : p)));
      }
      setPlaylist((prev) => prev ? { ...prev, name: updated.name, description: nextDescription } : prev);
      setPlaylists(playlists.map((p) => p.id === activePlaylistId ? { ...p, name: updated.name, description: nextDescription } : p));
      
      setEditDialogOpen(false);
    } catch (err) {
      console.error('Failed to update playlist:', err);
      toast("Couldn't save the changes to this playlist", { tone: 'error' });
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
    // Right-click on one of several selected rows acts on all of them
    const inSelection = track?.uri && selection.has(track.uri) && selectedTracks.length > 1;
    setContextMenu({
      type: 'track',
      x: e.clientX,
      y: e.clientY,
      track: track,
      tracks: inSelection ? selectedTracks : undefined,
      sourcePlaylistId: activePlaylistId,
      onRemoved: markRemoved,
      onRemovedMany: markRemovedMany,
      onDone: inSelection ? selection.clear : undefined,
      onSelect: track?.uri && !inSelection ? () => selection.toggle(track.uri) : undefined,
      reorder: inSelection ? null : reorder
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
      } else if (sortBy === 'duration') {
        comparison = (trackA.duration_ms || 0) - (trackB.duration_ms || 0);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [playlist, sortBy, sortOrder]);

  // Reveal the next page of rows when the sentinel below the list scrolls near the viewport
  const myId = useUserStore((s) => s.profile?.id);
  const ownsPlaylist = Boolean(myId && (playlist?.owner?.id === myId || playlist?.collaborative));
  // Who has added to a collaborative playlist, most songs first
  const collaboratorIds = useMemo(() => {
    const counts = new Map();
    for (const item of playlist?.tracks?.items || []) {
      const id = item?.added_by?.id;
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [playlist]);

  // Find in playlist: rows keep their index into sortedTracks, which play and reorder rely on
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = sortedTracks.map((item, i) => ({ item, i }));
    if (!needle) return all;
    return all.filter(({ item }) => {
      const t = item?.track;
      return t && [t.name, t.album?.name, ...(t.artists || []).map((a) => a.name)].some((x) => (x || '').toLowerCase().includes(needle));
    });
  }, [sortedTracks, needle]);
  const totalRows = rows.length;

  // Several rows at once (Shift/Ctrl-click, or "Select" from the row menu), keyed by uri in
  // display order so Shift extends through what is on screen
  const rowKeys = useMemo(() => rows.map(({ item }) => item?.track?.uri).filter(Boolean), [rows]);
  const selection = useSelection(rowKeys);
  const selectedTracks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const { item } of rows) {
      const t = item?.track;
      if (t?.uri && selection.selected.has(t.uri) && !seen.has(t.uri)) { seen.add(t.uri); out.push(t); }
    }
    return out;
  }, [rows, selection.selected]);
  const removeSelected = async (tracks) => {
    if (!token || !activePlaylistId || tracks.length === 0) return;
    try {
      await removeTracksFromPlaylist(token, activePlaylistId, tracks.map((t) => t.uri));
      markRemovedMany(tracks);
      selection.clear();
    } catch (err) {
      console.error(err);
      toast(`Couldn't remove ${tracks.length} songs`, { tone: 'error' });
    }
  };

  // Drag a row to reorder, in your own playlist's custom order (desktop; the phone has the menu)
  const dragRow = useRef(null);
  const [dropAt, setDropAt] = useState(null); // index of the row the dragged one would land before
  const canReorder = ownsPlaylist && sortBy === 'custom' && !needle;
  const reorderTo = (from, to) => {
    if (!token || !activePlaylistId || from === to || from === to - 1) return;
    const items = playlist?.tracks?.items || [];
    if (from < 0 || from >= items.length || to < 0 || to > items.length) return;
    const landing = to > from ? to - 1 : to;
    setPlaylist((prev) => {
      if (!prev) return prev;
      const next = [...prev.tracks.items];
      const [moved] = next.splice(from, 1);
      next.splice(landing, 0, moved);
      return { ...prev, tracks: { ...prev.tracks, items: next } };
    });
    reorderPlaylistTracks(token, activePlaylistId, from, to).catch((err) => {
      console.error(err);
      toast("Spotify wouldn't move that track", { tone: 'error' });
      setPlaylist((prev) => {
        if (!prev) return prev;
        const next = [...prev.tracks.items];
        const [moved] = next.splice(landing, 1);
        next.splice(from, 0, moved);
        return { ...prev, tracks: { ...prev.tracks, items: next } };
      });
    });
  };

  // "Find something to add": a search that adds straight into this playlist
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState(null);
  const [addSearching, setAddSearching] = useState(false);
  useEffect(() => {
    const q = addQuery.trim();
    if (!ownsPlaylist || !token || !q) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setAddSearching(true);
      searchSpotify(token, q)
        .then((data) => { if (!cancelled) setAddResults((data?.tracks?.items || []).filter(Boolean)); })
        .catch(() => { if (!cancelled) setAddResults([]); })
        .finally(() => { if (!cancelled) setAddSearching(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [addQuery, token, ownsPlaylist]);
  // Results belong to the query typed; an emptied box shows none
  const shownAddResults = addQuery.trim() ? addResults : null;
  const addFound = async (track) => {
    if (!token || !activePlaylistId) return;
    try {
      await addTracksToPlaylist(token, activePlaylistId, [track.uri]);
      const entry = { added_at: new Date().toISOString(), added_by: { id: myId }, track };
      setPlaylist((prev) => (prev ? { ...prev, tracks: { ...prev.tracks, items: [...prev.tracks.items, entry], total: (prev.tracks.total || prev.tracks.items.length) + 1 } } : prev));
      toast(`Added "${track.name}"`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Couldn't add "${track.name}"`, { tone: 'error' });
    }
  };
  const nextPageUrl = playlist?.tracks?.next || null;
  // Only once every page is in; a partial total would read as the whole playlist's
  const totalLength = useMemo(() => {
    if (!playlist || playlist.tracks?.next || !playlist.tracks?.items?.length) return '';
    return formatDuration(playlist.tracks.items.reduce((sum, item) => sum + (item.track?.duration_ms || 0), 0));
  }, [playlist]);
  const country = useUserStore((s) => s.profile?.country);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || (visibleCount >= totalRows && !nextPageUrl)) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      if (visibleCount < totalRows) setVisibleCount(n => Math.min(n + ROW_PAGE, totalRows));
      else if (nextPageUrl && !isFetchingMore.current) loadRestOfTracks(nextPageUrl, 1);
    }, { root: scrollParent(el), rootMargin: '800px 0px' });
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
    startPlaying(playlistSource({ shuffle: true }), async (deviceId) => {
      await setShuffle(true, deviceId);
      if (custom) await playPlaylistTrack(token, deviceId, activePlaylistId, index);
      else await startTrack(deviceId, index);
    });
  };

  return {
    token, updatePlaylistImage, playlists, activePlaylistId, setLikedTracks, setContextMenu, setDraggedItem, setPlaylists, navigateToArtist, navigateToAlbum, setCurrentView, playlistSortSettings, setPlaylistSortSettings, currentPlayingTrack, isCurrentTrackPaused, isShuffled, playlist, setPlaylist, summary, view, loadError, setLoadError, reloadNonce, setReloadNonce, retryLoad, visibleCount, setVisibleCount, sentinelRef, collaborators, sortDropdownOpen, setSortDropdownOpen, sortMenuRef, currentSort, sortBy, sortOrder, updateSortSettings, isFetchingMore, loadedPlaylistId, fetchingMore, setFetchingMore, wantAllPages, editDialogOpen, setEditDialogOpen, inLibrary, savingPlaylist, setSavingPlaylist, toggleSaved, isUpdatingPlaylist, setIsUpdatingPlaylist, isSyncing, setIsSyncing, syncStatusText, setSyncStatusText, configModalOpen, setConfigModalOpen, userPlaylists, setUserPlaylists, pickerError, setPickerError, pickerQuery, setPickerQuery, selectedCheckPlaylistIds, setUnaddedCheckPlaylists, isUnaddedSongsPlaylist, sortQueue, setSortQueue, suggestionsByTrack, sortTargets, suggestionStatus, sortModeTargets, openSortMode, sortingUri, setSortingUri, removeRow, restoreRow, sortedAway, setSortedAway, undoTimers, dropSortedRow, sortTrackInto, markRemoved, markRemovedMany, undoSort, pickerNeedle, pickerList, togglePlaylistSelection, fetchAllPages, unaddedPlan, setUnaddedPlan, runUnaddedSongsSync, applyUnaddedPlan, checkLikesForChunk, isCollaborative, startTrack, handleTrackSelect, handleUpdatePlaylist, moveTrack, handleRightClick, formatDateAdded, sortedTracks, myId, ownsPlaylist, collaboratorIds, find, setFind, needle, rows, totalRows, rowKeys, selection, selectedTracks, removeSelected, dragRow, dropAt, setDropAt, canReorder, reorderTo, addQuery, setAddQuery, addResults, setAddResults, addSearching, setAddSearching, shownAddResults, addFound, nextPageUrl, totalLength, country, handleShufflePlay, confirmRows, loadRestOfTracks
  };
}
