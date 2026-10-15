import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchInitialLikedSongs, playLikedSongsQueue, fetchMoreTracks } from '../../services/spotify/api';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import { scrollParent } from '../../utils/dom';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { isUnplayable, unplayableWhy, applyPlayability } from '../../utils/spotifyUri';
import { confirmPlayability } from '../../services/playability';
import { toast } from '../../store/toastStore';
import { toggleTrackLike } from '../../services/spotify/api';
import { useSelection } from '../../hooks/useSelection';

export const ROW_PAGE = 150;
const randomIndex = (count) => Math.floor(Math.random() * count);
export const SORTS = [
  { id: 'added_desc', label: 'Recently added' },
  { id: 'added_asc', label: 'Oldest added' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'duration', label: 'Duration' }
];
const byText = (a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
function sortLiked(items, mode) {
  if (mode === 'added_desc') return items; // Spotify's own order: newest first
  const sorted = [...items];
  if (mode === 'added_asc') sorted.reverse();
  else if (mode === 'title') sorted.sort((a, b) => byText(a.track?.name, b.track?.name));
  else if (mode === 'artist') sorted.sort((a, b) => byText(a.track?.artists?.[0]?.name, b.track?.artists?.[0]?.name) || byText(a.track?.name, b.track?.name));
  else if (mode === 'album') sorted.sort((a, b) => byText(a.track?.album?.name, b.track?.album?.name) || (a.track?.track_number || 0) - (b.track?.track_number || 0));
  else if (mode === 'duration') sorted.sort((a, b) => (a.track?.duration_ms || 0) - (b.track?.duration_ms || 0));
  return sorted;
}
const matchesQuery = (track, needle) => !needle || [track?.name, track?.album?.name, ...(track?.artists || []).map((a) => a.name)].some((t) => (t || '').toLowerCase().includes(needle));
// Phone: art, title/artists, like + duration + menu. Desktop: the same table as a playlist.
export const GRID = 'grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px]';

// Everything Liked Songs does, with no markup; the old page (LikedSongsView.jsx) and the room's
// surface (src/room/RoomLikedSongs.jsx) are two faces on it.
export function useLikedSongsView() {
  const { token, setLikedTracks, setContextMenu, navigateToAlbum } = useSlice(useUserStore, ['token', 'setLikedTracks', 'setContextMenu', 'navigateToAlbum']);
  // Unliking a song here drops its row; the list only ever shows what is still liked
  const likedTracks = useUserStore((s) => s.likedTracks);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const { currentPlayingTrack: currentTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [trackData, setTrackData] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ROW_PAGE);
  const sentinelRef = useRef(null);

  const isFetchingMore = useRef(false);
  const loadedForToken = useRef(false);

  // Set when a page fails to load partway; the header then says how much is actually here
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const country = useUserStore((s) => s.profile?.country);
  // Rows greyed on a market list alone are confirmed with Spotify and patched
  const confirmRows = (items) => {
    confirmPlayability(token, items, country).then((answers) => {
      if (!Object.keys(answers).length) return;
      setTrackData((prev) => (prev ? { ...prev, items: applyPlayability(prev.items, answers) } : prev));
    });
  };

  useEffect(() => {
    if (token) {
      // Load once: the token rotates hourly and refetching here used to reset the scroll
      if (loadedForToken.current) return;
      loadedForToken.current = true;
      isFetchingMore.current = false;
      fetchInitialLikedSongs(token).then((data) => {
        setTrackData(data);
        setVisibleCount(ROW_PAGE);
        confirmRows(data.items);
        
        // Globally mark as liked
        const updates = {};
        data.items.forEach(item => { if (item.track?.id) updates[item.track.id] = true; });
        setLikedTracks(updates);

        // The rest pages in as you scroll (see the sentinel below)
      }).catch((err) => {
        loadedForToken.current = false;
        console.error(err);
        // The skeleton used to stay up for good with nothing said
        setLoadError(err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting Jomify right now.' : "Couldn't load your Liked Songs.");
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reloadNonce]);

  // A function declaration rather than a const, so the effect above can reference it without
  // a use-before-declare: declarations hoist, and it only ever runs after mount anyway.
  async function loadRestOfTracks(initialNextUrl, maxPages = Infinity) {
    isFetchingMore.current = true;
    setLoadError('');
    let nextUrl = initialNextUrl;
    let pagesLoaded = 0;

    while (nextUrl) {
      try {
        const nextData = await fetchMoreTracks(token, nextUrl);
        setTrackData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: [...prev.items, ...nextData.items],
            next: nextData.next
          };
        });
        confirmRows(nextData.items);
        
        const updates = {};
        nextData.items.forEach(item => { if (item.track?.id) updates[item.track.id] = true; });
        setLikedTracks(updates);
        
        nextUrl = nextData.next;
        if (++pagesLoaded >= maxPages) break;
      } catch (err) {
        // Previously a silent break: the list stopped partway and the header still claimed the
        // full total, with no way to tell and nothing to click.
        console.error('Liked Songs stopped loading partway:', err);
        setLoadError(
          err?.message === 'RATE_LIMITED'
            ? 'Spotify rate-limited the rest of the list.'
            : "Couldn't load the rest of the list."
        );
        break;
      }
    }
    isFetchingMore.current = false;
  }

  // Rows whose song was unliked since loading are gone, as Spotify's own list does
  const liveItems = (trackData?.items || []).filter((item) => item.track && likedTracks[item.track.id] !== false);
  const removedCount = (trackData?.items.length ?? 0) - liveItems.length;
  // Sort and find, over what has loaded
  const [sortMode, setSortMode] = useState('added_desc');
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const items = sortLiked(liveItems, sortMode).filter((item) => matchesQuery(item.track, needle));


  // Several rows at once, keyed by uri in display order
  const rowKeys = items.map((item) => item.track?.uri).filter(Boolean);
  const selection = useSelection(rowKeys);
  const selectedTracks = items.map((item) => item.track).filter((t) => t?.uri && selection.selected.has(t.uri));
  const unlikeSelected = async (tracks) => {
    if (!token || tracks.length === 0) return;
    const results = await Promise.allSettled(tracks.map((t) => toggleTrackLike(token, t.id, true)));
    const done = {};
    tracks.forEach((t, i) => { if (results[i].status === 'fulfilled') done[t.id] = false; });
    setLikedTracks(done);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast(`Couldn't remove ${failed} of ${tracks.length}`, { tone: 'error' });
    else toast(`Removed ${tracks.length} songs from Liked Songs`, { tone: 'info' });
    selection.clear();
  };
  const openRowMenu = (e, track) => {
    const inSelection = track?.uri && selection.has(track.uri) && selectedTracks.length > 1;
    setContextMenu({
      type: 'track', x: e.pageX, y: e.pageY, track,
      tracks: inSelection ? selectedTracks : undefined,
      onDone: inSelection ? selection.clear : undefined,
      onSelect: track?.uri && !inSelection ? () => selection.toggle(track.uri) : undefined
    });
  };

  const handleTrackSelect = (index) => {
    if (!token || !trackData) return;
    if (isUnplayable(items[index]?.track, country)) { toast(`${unplayableWhy(items[index]?.track, country)}.`); return; }

    const allUris = items
      .map(item => item.track?.uri)
      .filter(Boolean);

    if (!allUris.length) return;
    const userId = useUserStore.getState().profile?.id;
    playOn((deviceId) => playLikedSongsQueue(token, deviceId, allUris, index, userId), { track: items[index]?.track });
  };

  // Shuffle on, then start somewhere random, the same as a playlist's Shuffle button
  const handleShufflePlay = () => {
    if (!token || !trackData || items.length === 0) return;
    const allUris = items.map(item => item.track?.uri).filter(Boolean);
    const index = randomIndex(allUris.length);
    const userId = useUserStore.getState().profile?.id;
    playOn(async (deviceId) => {
      await setShuffle(true, deviceId);
      await playLikedSongsQueue(token, deviceId, allUris, index, userId);
    });
  };

  const formatDateAdded = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const totalRows = items.length;
  const nextPageUrl = trackData?.next || null;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount, totalRows, nextPageUrl]);

  // The header and controls never wait for the songs
  const data = trackData
    ? { items, total: Math.max(0, (trackData.total || 0) - removedCount), next: trackData.next }
    : { items: [], total: 0, next: null };

  return {
    token, setLikedTracks, setContextMenu, navigateToAlbum, likedTracks, isShuffled, currentTrack, isCurrentTrackPaused, trackData, setTrackData, visibleCount, setVisibleCount, sentinelRef, isFetchingMore, loadedForToken, loadError, setLoadError, reloadNonce, setReloadNonce, country, confirmRows, liveItems, removedCount, sortMode, setSortMode, find, setFind, needle, items, rowKeys, selection, selectedTracks, unlikeSelected, openRowMenu, handleTrackSelect, handleShufflePlay, formatDateAdded, totalRows, nextPageUrl, data, loadRestOfTracks
  };
}
