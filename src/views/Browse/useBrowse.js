import { useState, useEffect, useRef, useCallback } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';

import { playOn } from '../../services/spotify/playbackController';
import { searchSpotify, playSingleTrack, playContext, playUris, checkTracksLiked, fetchSearchPage } from '../../services/spotify/api';

import { useIsMobile } from '../../hooks/useMediaQuery';

import { isUnplayable, unplayableWhy } from '../../utils/spotifyUri';
import { normalizePlaylist } from '../../services/spotify/compat';
import { toast } from '../../store/toastStore';

const MAX_CACHED_RESULTS_BYTES = 500 * 1024;

const safeSessionSet = (key, value) => {
  try { sessionStorage.setItem(key, value); } catch { /* quota or private mode: skip the cache */ }
};
const safeSessionRemove = (key) => {
  try { sessionStorage.removeItem(key); } catch { /* nothing to do */ }
};

// Recent searches live in localStorage: a convenience, not something to sync
const RECENT_KEY = 'jomify_recent_searches';
const RECENT_MAX = 8;
const loadRecentSearches = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; } catch { return []; } };
const saveRecentSearches = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* fine */ } return list; };

export const hasAnyResults = (results) =>
  ['tracks', 'albums', 'artists', 'playlists'].some(kind => (results?.[kind]?.items?.length ?? 0) > 0);

const ALBUM_KIND = { album: 'Album', single: 'Single', compilation: 'Compilation' };
// "Album • 2015 • Tame Impala", as Spotify labels album results
export const albumMeta = (album) =>
  [ALBUM_KIND[album.album_type] || 'Album', album.release_date?.slice(0, 4), album.artists?.[0]?.name]
    .filter(Boolean).join(' • ');

// View-Level Caching: Isolates ephemeral UI memory from the global store
const getCachedString = (key, defaultVal) => {
  const saved = sessionStorage.getItem(key);
  return saved !== null ? saved : defaultVal;
};

const getCachedJSON = (key, defaultVal) => {
  const saved = sessionStorage.getItem(key);
  try {
    return saved ? JSON.parse(saved) : defaultVal;
  } catch {
    return defaultVal;
  }
};

// Everything search does, with no markup: the query and its cache, recent searches, the
// debounced search, paging, play. The old page (Browse.jsx) and the room's surface
// (src/room/RoomSearch.jsx) are two faces on it.
export function useBrowse() {
  // Added setContextMenu and setDraggedItem here
  const { token, setLikedTracks, navigateToArtist, navigateToAlbum, setContextMenu, setDraggedItem, navigateToPlaylist, searchFocusRequested, clearSearchFocus } = useSlice(useUserStore, ['token', 'setLikedTracks', 'navigateToArtist', 'navigateToAlbum', 'setContextMenu', 'setDraggedItem', 'navigateToPlaylist', 'searchFocusRequested', 'clearSearchFocus']);
  const { currentPlayingTrack } = usePlaybackSummary();
  const isMobile = useIsMobile();
  const inputRef = useRef(null);
  
  // Initialize state directly from the session cache
  const [query, setQuery] = useState(() => getCachedString('jomify_browse_query', ''));
  // The last few things searched for, shown under the box before you type
  const [recent, setRecent] = useState(loadRecentSearches);
  const rememberSearch = (q) => setRecent((prev) => saveRecentSearches([q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX)));
  const forgetSearch = (q) => setRecent((prev) => saveRecentSearches(prev.filter((r) => r !== q)));
  const clearRecent = () => setRecent(saveRecentSearches([]));
  const [results, setResults] = useState(() => getCachedJSON('jomify_browse_results', null));
  const [expandedSection, setExpandedSection] = useState(() => getCachedString('jomify_browse_expanded', null)); 
  const [paginationUrls, setPaginationUrls] = useState(() => ({
    tracks: null,
    albums: null,
    artists: null,
    playlists: null,
    ...getCachedJSON('jomify_browse_pagination', {})
  }));
  
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef(null);
  const isInitialMount = useRef(true);


  // Real-time synchronization to cache. Every write is guarded: after a few "load more" pages
  // the result set can exceed the sessionStorage quota, and an uncaught QuotaExceededError
  // thrown inside an effect unmounts the whole tree.
  useEffect(() => { safeSessionSet('jomify_browse_query', query); }, [query]);
  // The address carries the search (/search?q=…)
  const setBrowseQuery = useUserStore((s) => s.setBrowseQuery);
  useEffect(() => { setBrowseQuery(query.trim()); }, [query, setBrowseQuery]);
  useEffect(() => {
    if (!results) { safeSessionRemove('jomify_browse_results'); return; }
    const json = JSON.stringify(results);
    if (json.length > MAX_CACHED_RESULTS_BYTES) safeSessionRemove('jomify_browse_results');
    else safeSessionSet('jomify_browse_results', json);
  }, [results]);
  useEffect(() => {
    if (expandedSection) safeSessionSet('jomify_browse_expanded', expandedSection);
    else safeSessionRemove('jomify_browse_expanded');
  }, [expandedSection]);
  useEffect(() => { safeSessionSet('jomify_browse_pagination', JSON.stringify(paginationUrls)); }, [paginationUrls]);

  // Search status, so the page can say "searching", "nothing found" or "that failed" instead
  // of leaving stale results (or nothing at all) on screen.
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  // Enter pressed before the results arrived: open "All songs" once they do
  const expandOnResult = useRef(false);

  // Ctrl/Cmd+K (handled in MainLayout, which also brings you here): leave any "See more" list
  // and focus the box. The box only exists in the standard view, so focus follows the collapse.
  const [focusKey, setFocusKey] = useState(0);
  useEffect(() => {
    if (!searchFocusRequested) return undefined;
    const id = setTimeout(() => {
      setExpandedSection(null);
      setFocusKey((n) => n + 1);
      clearSearchFocus();
    }, 0);
    return () => clearTimeout(id);
  }, [searchFocusRequested, clearSearchFocus]);
  useEffect(() => {
    if (!focusKey) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  useEffect(() => {
    // Prevent network requests on initial render if we successfully loaded from cache
    if (isInitialMount.current) {
      isInitialMount.current = false;
      const cachedResults = sessionStorage.getItem('jomify_browse_results');
      if (cachedResults && query.trim()) return; 
    }

    const delayDebounce = setTimeout(() => {
      if (query.trim() && token) {
        setSearching(true);
        setSearchError('');
        searchSpotify(token, query)
          .then((raw) => {
            // Playlists in search results carry their count under `items` now, `tracks` before
            const data = Array.isArray(raw?.playlists?.items) ? { ...raw, playlists: { ...raw.playlists, items: raw.playlists.items.map(normalizePlaylist) } } : raw;
            setResults(data);
            if (hasAnyResults(data)) rememberSearch(query.trim());
            if (expandOnResult.current) {
              expandOnResult.current = false;
              if (data?.tracks?.items?.length) setExpandedSection('tracks');
            }
            setPaginationUrls({
              tracks: data.tracks?.next || null,
              albums: data.albums?.next || null,
              artists: data.artists?.next || null,
              playlists: data.playlists?.next || null
            });
            if (data?.tracks?.items) {
              const ids = data.tracks.items.map(track => track.id).filter(Boolean);
              if (ids.length > 0) {
                checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
              }
            }
          })
          .catch((err) => {
            console.error(err);
            // Stale results under an error read as the answer; clear them
            setResults(null);
            setExpandedSection(null);
            setSearchError(
              err?.message === 'RATE_LIMITED'
                ? 'Spotify is rate-limiting searches right now. Try again in a moment.'
                : "Search failed. Check your connection and try again."
            );
          })
          .finally(() => setSearching(false));
      } else {
        setResults(null);
        setExpandedSection(null);
        setSearchError('');
        setPaginationUrls({ tracks: null, albums: null, artists: null, playlists: null });
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [query, token, setLikedTracks, searchAttempt]);

  const retrySearch = () => { setSearchError(''); setSearchAttempt((n) => n + 1); };
  const clearQuery = () => { setQuery(''); inputRef.current?.focus(); };
  const onInputKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) clearQuery(); else inputRef.current?.blur();
    } else if (e.key === 'Enter' && query.trim()) {
      e.preventDefault();
      if (results?.tracks?.items?.length && !searching) setExpandedSection('tracks');
      else expandOnResult.current = true;
      if (isMobile) inputRef.current?.blur();
    }
  };

  const loadMoreResults = useCallback(async (section) => {
    if (!paginationUrls[section] || loadingMore || !token) return;

    setLoadingMore(true);
    try {
      const data = await fetchSearchPage(token, paginationUrls[section]);
      
      setResults((prev) => {
        if (!prev || !data) return prev;
        const sectionKey = section === 'tracks' ? 'tracks' : section === 'albums' ? 'albums' : section === 'artists' ? 'artists' : 'playlists';
        const existingItems = Array.isArray(prev[sectionKey]?.items) ? prev[sectionKey].items : [];
        const newItems = Array.isArray(data[sectionKey]?.items) ? data[sectionKey].items : [];

        return {
          ...prev,
          [sectionKey]: {
            ...data[sectionKey],
            items: [...existingItems, ...newItems]
          }
        };
      });

      setPaginationUrls((prev) => ({
        ...prev,
        [section]: data?.[section === 'tracks' ? 'tracks' : section === 'albums' ? 'albums' : section === 'artists' ? 'artists' : 'playlists']?.next || null
      }));

      // Check if new tracks are liked
      if (section === 'tracks' && data.tracks?.items) {
        const ids = data.tracks.items.map(track => track.id).filter(Boolean);
        if (ids.length > 0) {
          checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
        }
      }
    } catch (error) {
      console.error(`Failed to load more ${section}:`, error);
    } finally {
      setLoadingMore(false);
    }
  }, [paginationUrls, loadingMore, token, setLikedTracks]);

  // Infinite scroll effect
  useEffect(() => {
    if (!sentinelRef.current || !expandedSection || !paginationUrls[expandedSection]) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && paginationUrls[expandedSection]) {
          loadMoreResults(expandedSection);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [expandedSection, paginationUrls, loadingMore, loadMoreResults]);

  const country = useUserStore((s) => s.profile?.country);
  // The song, then the rest of the results after it, so playback carries on as Spotify's does
  // instead of stopping after one song
  const handleTrackPlay = (track) => {
    if (!token || !track?.uri) return;
    if (isUnplayable(track, country)) { toast(`${unplayableWhy(track, country)}.`); return; }
    const list = (results?.tracks?.items || []).filter((t) => t?.uri && !isUnplayable(t, country));
    const at = list.findIndex((t) => t.uri === track.uri);
    const uris = at >= 0 ? list.slice(at).map((t) => t.uri).slice(0, 100) : [track.uri];
    playOn((deviceId) => (uris.length > 1 ? playUris(token, deviceId, uris, 0) : playSingleTrack(token, deviceId, track.uri)), { track });
  };

  const handleContextPlay = (uri) => {
    if (!token) return;
    playOn((deviceId) => playContext(token, deviceId, uri));
  };

  const handleArtistClick = (e, artistId) => {
    e.stopPropagation(); 
    navigateToArtist(artistId);
  };

  const handleAlbumClick = (e, albumId) => {
    e.stopPropagation();
    navigateToAlbum(albumId);
  };

  return {
    token, setLikedTracks, navigateToArtist, navigateToAlbum, setContextMenu, setDraggedItem, navigateToPlaylist, searchFocusRequested, clearSearchFocus, currentPlayingTrack, isMobile, inputRef, query, setQuery, recent, setRecent, rememberSearch, forgetSearch, clearRecent, results, setResults, expandedSection, setExpandedSection, paginationUrls, setPaginationUrls, loadingMore, setLoadingMore, sentinelRef, isInitialMount, setBrowseQuery, searching, setSearching, searchError, setSearchError, searchAttempt, setSearchAttempt, expandOnResult, focusKey, setFocusKey, retrySearch, clearQuery, onInputKeyDown, loadMoreResults, country, handleTrackPlay, handleContextPlay, handleArtistClick, handleAlbumClick
  };
}
