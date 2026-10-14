import { useEffect, useState, useMemo, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import { usePlayerStore } from '../../store/playerStore';
import { useUserProfilesStore, ensureUserProfiles } from '../../store/userProfilesStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fetchPlaylistDetails, fetchMoreTracks, addTracksToPlaylist, playPlaylistTrack, playUris, reorderPlaylistTracks, fetchSevenTrackMeta } from '../../services/spotify/api';
import { toast } from '../../store/toastStore';
import { playlistItemsUrl } from '../../services/spotify/compat';









export const formatBatchDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const PAGE = 100;
const pageUrl = (playlistId, offset, limit) => playlistItemsUrl(playlistId, `offset=${offset}&limit=${limit}`);

// The newest batches sit at the end of the playlist, so after the details request (which
// brings the first page) the remaining pages are fetched from the end backwards and shown as a
// growing tail. `tracks.loadedFrom` is the offset the tail starts at; 0 means everything is in.
// fetchMoreTracks goes through the rate-limit interceptor and throws on a bad page, so a
// failure surfaces instead of silently truncating the list.
async function loadSeven(token, playlistId, onUpdate, isCancelled = () => false) {
  const data = await fetchPlaylistDetails(token, playlistId);
  const total = data.tracks.total ?? data.tracks.items.length;
  const slots = new Array(total);
  data.tracks.items.forEach((item, i) => { slots[i] = item; });
  let loadedFrom = total <= PAGE ? 0 : total;
  const publish = () => {
    if (isCancelled()) return;
    onUpdate({ ...data, tracks: { ...data.tracks, items: slots.slice(loadedFrom, total).filter(Boolean), total, loadedFrom, next: null } });
  };
  publish();
  if (loadedFrom === 0) return;

  let offset = total - PAGE;
  while (offset >= PAGE) {
    if (isCancelled()) return;
    const page = await fetchMoreTracks(token, pageUrl(playlistId, offset, PAGE));
    (page.items || []).forEach((item, i) => { slots[offset + i] = item; });
    loadedFrom = offset;
    publish();
    offset -= PAGE;
  }
  // The sliver between the first page and the tail
  if (loadedFrom > PAGE) {
    if (isCancelled()) return;
    const page = await fetchMoreTracks(token, pageUrl(playlistId, PAGE, loadedFrom - PAGE));
    (page.items || []).forEach((item, i) => { slots[PAGE + i] = item; });
  }
  loadedFrom = 0;
  publish();
}

// The pool's order doesn't matter, so it streams forwards: first page at once, the rest appended
async function loadPool(token, playlistId, onUpdate, isCancelled = () => false) {
  const data = await fetchPlaylistDetails(token, playlistId);
  let items = [...data.tracks.items];
  let next = data.tracks.next;
  if (!isCancelled()) onUpdate({ ...data, tracks: { ...data.tracks, items, next } });
  while (next && !isCancelled()) {
    const page = await fetchMoreTracks(token, next);
    items = [...items, ...(page.items || [])];
    next = page.next;
    if (!isCancelled()) onUpdate({ ...data, tracks: { ...data.tracks, items, next } });
  }
}

// Everything a Seven does, with no markup: loading its batches from the end, the draft of
// seven, the pool, the cross-Seven "sent before" check, publishing. The old page
// (PlaylistView_2.jsx) and the room's surface (src/room/RoomSeven.jsx) are two faces on it.
export function useSevenView() {
  const {
    token, activePlaylistId, playlists, profile,
    stagedSeven: allStaged, addStagedTrack, removeStagedTrack, clearStagedTracks, setStagedSeven,
    navigateToArtist, navigateToAlbum, sevens, updateSeven, setContextMenu
  } = useSlice(useUserStore, [
    'token', 'activePlaylistId', 'playlists', 'profile',
    'stagedSeven', 'addStagedTrack', 'removeStagedTrack', 'clearStagedTracks', 'setStagedSeven',
    'navigateToArtist', 'navigateToAlbum', 'sevens', 'updateSeven', 'setContextMenu'
  ]);
  // The ordinary song menu (queue, playlists, artist, album) on every row of a Seven
  const openTrackMenu = (e, track) => {
    e.preventDefault();
    setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track });
  };
  // This Seven's draft. Entries from before drafts were per Seven carry no tag and count as this
  // Seven's, so nothing already staged is lost.
  const stagedSeven = allStaged.filter(t => (t.forPlaylistId ?? activePlaylistId) === activePlaylistId);
  
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const isMobile = useIsMobile();

  const playFromTop = () => {
    if (!token || !activePlaylistId) return;
    playOn((deviceId) => playPlaylistTrack(token, deviceId, activePlaylistId, 0));
  };

  const shufflePlay = () => {
    if (!token || !activePlaylistId) return;
    const count = view?.tracks?.total || 1;
    const index = Math.floor(Math.random() * count);
    playOn(async (deviceId) => {
      await setShuffle(true, deviceId);
      await playPlaylistTrack(token, deviceId, activePlaylistId, index);
    });
  };
  const [playlist, setPlaylist] = useState(null);
  // The header draws from the library entry until the playlist itself arrives
  const summary = playlists.find((p) => p.id === activePlaylistId);
  const view = playlist || (summary ? { ...summary, images: summary.images || [], tracks: { items: [], total: summary.tracks?.total ?? 0, loadedFrom: summary.tracks?.total ?? 0 } } : null);
  const stillLoading = !playlist || playlist.tracks.loadedFrom > 0;

  // Workspace States
  // Opens straight into the workspace when Home's turn banner asked for it
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(() => useUserStore.getState().workspaceRequest === activePlaylistId);
  useEffect(() => {
    if (useUserStore.getState().workspaceRequest) useUserStore.getState().clearWorkspaceRequest();
  }, [activePlaylistId]);
  // Which of the three panes a narrow screen shows; wide screens show all three side by side
  const [workspacePane, setWorkspacePane] = useState('staging');
  const [poolPlaylist, setPoolPlaylist] = useState(null);
  const [poolError, setPoolError] = useState('');
  const [poolAttempt, setPoolAttempt] = useState(0);
  // Finding one song in a long pool
  const [poolQuery, setPoolQuery] = useState('');
  const poolNeedle = poolQuery.trim().toLowerCase();
  const poolMatches = (track) => !poolNeedle
    || (track.name || '').toLowerCase().includes(poolNeedle)
    || (track.artists || []).some((a) => (a.name || '').toLowerCase().includes(poolNeedle))
    || (track.album?.name || '').toLowerCase().includes(poolNeedle);
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
    setPoolError('');
    setPoolPlaylist(null);
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
  // The Seven already loaded: the effect needs the token, but a token refresh must not restart
  // the streaming load and reset the batches on screen
  const loadedSevenId = useRef(null);
  


  // --- FETCH MAIN PLAYLIST ---
  useEffect(() => {
    if (token && activePlaylistId) {
      if (loadedSevenId.current === activePlaylistId) return undefined;
      loadedSevenId.current = activePlaylistId;

      const requestedId = activePlaylistId;
      let cancelled = false;
      let finished = false;
      loadSeven(token, activePlaylistId, setPlaylist, () => cancelled)
        .then(() => { finished = true; })
        .catch((err) => {
          loadedSevenId.current = null; // let a later attempt retry
          if (cancelled) return;
          console.error(err);
          setLoadError({ id: requestedId, message: err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting Jomify; try again in a moment.' : "Couldn't load this Seven." });
        });
      // A load cut short (a token renewal mid-load, React's development double-run) must start
      // again on the next run: left marked as loaded, the Seven sat on "Loading…" for good
      return () => { cancelled = true; if (!finished && loadedSevenId.current === requestedId) loadedSevenId.current = null; };
    }
    return undefined;
  }, [token, activePlaylistId]);

  // --- FETCH POOL PLAYLIST ---
  useEffect(() => {
    if (token && poolPlaylistId && isWorkspaceOpen) {
      let cancelled = false;
      // A pool that failed to load used to leave the spinner for good
      loadPool(token, poolPlaylistId, setPoolPlaylist, () => cancelled).catch((err) => {
        if (cancelled) return;
        console.error('Pool playlist failed to load:', err);
        setPoolError(err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting Jomify right now.' : "Couldn't load that playlist.");
      });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [token, poolPlaylistId, isWorkspaceOpen, poolAttempt]);

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
        meta: await fetchSevenTrackMeta(token, seven.playlistId).catch(() => null)
      }))
    )
      .then((results) => {
        if (cancelled) return;
        const matches = {};
        let checked = 0;
        results.forEach(({ name, meta }) => {
          if (!meta) return; // this Seven could not be read, so it was not checked
          checked += 1;
          meta.forEach(({ uri }) => {
            if (uri && !matches[uri]) matches[uri] = { playlistName: name };
          });
        });
        setCrossSevenHistory({ partnerId, matches, checked, failed: results.length - checked });
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

    // The partner chosen in settings comes first; failing that, whoever else has added a song.
    // Naming the first other adder regardless meant this disagreed with the Home banner on a
    // Seven with more than two contributors.
    const otherId = thisSeven?.partnerId
      || playlist.tracks.items.find(item => item.added_by?.id && item.added_by.id !== profile?.id)?.added_by?.id;
    const otherUsername = (otherId === thisSeven?.partnerId && partnerDisplayName)
      || collaborators[otherId]?.display_name || otherId || 'Collaborator';

    // If you went last, it's their turn. If they went last, it's yours.
    if (lastAdderId === profile?.id) return `Next up: ${otherUsername}`;
    return `Next up: ${yourUsername}`;
  }, [playlist, profile, collaborators, thisSeven?.partnerId, partnerDisplayName]);

  const mainPlaylistUris = useMemo(() => {
    if (!playlist?.tracks?.items) return new Set();
    return new Set(playlist.tracks.items.map(i => i.track?.uri).filter(Boolean));
  }, [playlist]);

  // The pool is a real playlist: playing from it plays it as a context (Next goes on down the
  // pool), and a reorder in the pool is a reorder on Spotify, with the local copy moved first.
  const playPoolTrack = (track) => {
    if (!token || !track) return;
    const items = poolPlaylist?.tracks?.items || [];
    const index = items.findIndex((i) => i.track?.uri === track.uri);
    if (poolPlaylistId && index !== -1) playOn((deviceId) => playPlaylistTrack(token, deviceId, poolPlaylistId, index), { track });
    else playOn((deviceId) => playUris(token, deviceId, [track.uri], 0), { track });
  };
  // move the pool item at `from` so it sits before index `to` (Spotify's insert_before)
  const reorderPool = (from, to) => {
    const items = poolPlaylist?.tracks?.items || [];
    if (!token || !poolPlaylistId || from === to || from === to - 1 || from < 0 || from >= items.length || to < 0 || to > items.length) return;
    const landing = to > from ? to - 1 : to;
    const move = (list, a, b) => { const next = [...list]; const [moved] = next.splice(a, 1); next.splice(b, 0, moved); return next; };
    setPoolPlaylist((prev) => (prev ? { ...prev, tracks: { ...prev.tracks, items: move(prev.tracks.items, from, landing) } } : prev));
    reorderPlaylistTracks(token, poolPlaylistId, from, to).catch((err) => {
      console.error(err);
      toast("Spotify wouldn't move that song", { tone: 'error' });
      setPoolPlaylist((prev) => (prev ? { ...prev, tracks: { ...prev.tracks, items: move(prev.tracks.items, landing, from) } } : prev));
    });
  };

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
      loadedSevenId.current = activePlaylistId;
      await loadSeven(token, activePlaylistId, setPlaylist);
      clearStagedTracks(activePlaylistId);
      setIsWorkspaceOpen(false);
      // Home's "your turn" banner rechecks instead of waiting for the next launch
      useUserStore.getState().bumpSevensCheck();
    } catch (err) {
      console.error("Failed to publish 7", err);
      setPublishError("Couldn't publish -- Spotify rejected the request. Your seven tracks are still staged.");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTrackSelect = (trackUri) => {
    if (!token || !playlist) return;
    const realIndex = playlist.tracks.items.findIndex(item => item.track?.uri === trackUri);
    if (realIndex === -1) return;
    playOn((deviceId) => playPlaylistTrack(token, deviceId, activePlaylistId, realIndex), { track: playlist.tracks.items[realIndex].track });
  };

  return {
    playPoolTrack, reorderPool, token, activePlaylistId, playlists, profile, allStaged, addStagedTrack, removeStagedTrack, clearStagedTracks, setStagedSeven, navigateToArtist, navigateToAlbum, sevens, updateSeven, setContextMenu, openTrackMenu, stagedSeven, currentPlayingTrack, isCurrentTrackPaused, isShuffled, isMobile, playFromTop, shufflePlay, playlist, setPlaylist, summary, view, stillLoading, isWorkspaceOpen, setIsWorkspaceOpen, workspacePane, setWorkspacePane, poolPlaylist, setPoolPlaylist, poolError, setPoolError, poolAttempt, setPoolAttempt, poolQuery, setPoolQuery, poolNeedle, poolMatches, isPublishing, setIsPublishing, publishError, setPublishError, thisSeven, poolPlaylistId, setPoolPlaylistId, crossSevenHistory, setCrossSevenHistory, draggedIdx, setDraggedIdx, dragOverIdx, setDragOverIdx, collaborators, loadError, setLoadError, loadedSevenId, partnerSevens, isCheckingHistory, crossSevenMatches, partnerDisplayName, chunks, mainPlaylistUris, handlePublishSeven, handleTrackSelect, turnIndicator
  };
}
