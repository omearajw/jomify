import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchInitialLikedSongs, playLikedSongsQueue, fetchMoreTracks } from '../../services/spotify/api';
import { playOn, toggleShuffle } from '../../services/spotify/playbackController';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, Heart, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { rowButtonProps } from '../../utils/a11y';
import MoreButton from '../../components/MoreButton';
import { Skeleton, SkeletonRows } from '../../components/Skeleton';
import { useSlice, usePlaybackSummary } from '../../store/selectors';

const ROW_PAGE = 150;

export default function LikedSongsView() {
  const { token, setLikedTracks, setContextMenu } = useSlice(useUserStore, ['token', 'setLikedTracks', 'setContextMenu']);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const { currentPlayingTrack: currentTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [trackData, setTrackData] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ROW_PAGE);
  const sentinelRef = useRef(null);

  const isFetchingMore = useRef(false);
  const loadedForToken = useRef(false);

  // Hoisted out of the row loop: the same split/lowercase used to run once per row per render
  const currentKey = currentTrack ? currentTrack.name.split(/[-(]/)[0].trim().toLowerCase() : '';

  // Set when a page fails to load partway; the header then says how much is actually here
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (token) {
      // Load once: the token rotates hourly and refetching here used to reset the scroll
      if (loadedForToken.current) return;
      loadedForToken.current = true;
      isFetchingMore.current = false;
      fetchInitialLikedSongs(token).then((data) => {
        setTrackData(data);
        setVisibleCount(ROW_PAGE);
        
        // Globally mark as liked
        const updates = {};
        data.items.forEach(item => { if (item.track?.id) updates[item.track.id] = true; });
        setLikedTracks(updates);

        // The rest pages in as you scroll (see the sentinel below)
      }).catch((err) => { loadedForToken.current = false; console.error(err); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  const handleToggleShuffle = () => { if (token) toggleShuffle(); };

  const handleTrackSelect = (index) => {
    if (!token || !trackData) return;

    const allUris = trackData.items
      .map(item => item.track?.uri)
      .filter(Boolean);

    if (!allUris.length) return;
    const userId = useUserStore.getState().profile?.id;
    playOn((deviceId) => playLikedSongsQueue(token, deviceId, allUris, index, userId));
  };

  const totalRows = trackData?.items.length ?? 0;
  const nextPageUrl = trackData?.next || null;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount, totalRows, nextPageUrl]);

  // The header and controls never wait for the songs
  const data = trackData || { items: [], total: 0, next: null };

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-4 md:mb-6 mt-2 md:mt-4 select-none">
        <div className="w-24 h-24 md:w-48 md:h-48 shrink-0 bg-gradient-to-br from-indigo-700 to-blue-500 flex items-center justify-center shadow-2xl rounded">
          <Heart className="w-10 h-10 md:w-16 md:h-16 fill-white text-white" />
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Playlist</p>
          <h1 className="text-2xl md:text-5xl lg:text-7xl font-extrabold text-white tracking-tighter mb-1 md:mb-4">Liked Songs</h1>
          {!trackData && <Skeleton className="h-4 w-24 mt-1" />}
          {trackData && <p className="text-neutral-400 text-sm font-medium">
            {data.items.length < data.total
              ? `${data.items.length.toLocaleString()} of ${data.total.toLocaleString()} songs loaded`
              : `${data.total.toLocaleString()} songs`}
          </p>}
          {loadError && (
            <p className="text-red-400 text-xs font-medium mt-2 flex items-center gap-3">
              {loadError}
              {data.next && (
                <button
                  type="button"
                  onClick={() => { if (!isFetchingMore.current) loadRestOfTracks(data.next); }}
                  className="underline hover:text-white transition-colors"
                >
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Action Bar (Play & Shuffle) */}
      <div className="flex items-center space-x-4 mb-4 md:mb-8 pl-1 md:pl-4">
        <button onClick={() => handleTrackSelect(0)} aria-label="Play Liked Songs" className="w-12 h-12 md:w-14 md:h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
          <Play className="w-6 h-6 fill-current ml-1" />
        </button>
        <button onClick={handleToggleShuffle} aria-label={isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={isShuffled} className={`w-11 h-11 flex items-center justify-center hover:scale-110 transition-all ${isShuffled ? 'text-brand-gradient' : 'text-neutral-400 hover:text-white'}`}>
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      {/* Tracklist Header */}
      <div className="hidden md:grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none">
        <span>#</span><span>Title</span><span>Album</span><div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {!trackData && <SkeletonRows count={8} art={false} />}
        {data.items.slice(0, visibleCount).map((item, index) => {
          const track = item.track;
          if (!track) return null;

          // ROBUST MATCH: Checks ID, URI, and falls back to exact Title + Artist match
          const isCurrentTrack = currentTrack && (
            track.id === currentTrack.id ||
            track.uri === currentTrack.uri ||
            (track.linked_from && track.linked_from.id === currentTrack.id) ||
            (track.name.split(/[-(]/)[0].trim().toLowerCase() === currentKey &&
             track.artists?.[0]?.name === currentTrack.artists?.[0]?.name)
          );

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={() => handleTrackSelect(index)}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
              className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_64px]"
            >
              <div className="text-neutral-400 w-4 h-4 hidden md:flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-brand-gradient font-bold animate-pulse">🔊</span>
                ) : (
                  <><span className={`group-hover:hidden ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>{index + 1}</span><Play className="w-4 h-4 text-white hidden group-hover:block fill-current" /></>
                )}
              </div>
              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>{track.name}</span>
                <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
              </div>
              <span className="hidden md:block text-neutral-400 truncate pr-4">{track.album.name}</span>
              <div className="flex items-center justify-end space-x-4">
                <LikeButton trackId={track.id} />
                <span className="hidden md:inline text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
                <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
              </div>
            </div>
          );
        })}
        {(visibleCount < totalRows || nextPageUrl) && (
          <div ref={sentinelRef} className="py-6 text-center text-xs text-neutral-500">
            {Math.max(0, (data.total || totalRows) - Math.min(visibleCount, totalRows))} more…
          </div>
        )}
      </div>
    </div>
  );
}