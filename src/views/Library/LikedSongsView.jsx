import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchInitialLikedSongs, playLikedSongsQueue, fetchMoreTracks } from '../../services/spotify/api';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import { formatTime } from '../../utils/formatTime';
import { artUrl } from '../../utils/images';
import { Clock3, Play, Heart, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { rowButtonProps } from '../../utils/a11y';
import MoreButton from '../../components/MoreButton';
import { Skeleton, SkeletonRows } from '../../components/Skeleton';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { isSameTrack, isUnplayable } from '../../utils/spotifyUri';
import { toast } from '../../store/toastStore';

const ROW_PAGE = 150;
const randomIndex = (count) => Math.floor(Math.random() * count);
// Phone: art, title/artists, like + duration + menu. Desktop: the same table as a playlist.
const GRID = 'grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[16px_48px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px]';

export default function LikedSongsView() {
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
  const items = (trackData?.items || []).filter((item) => item.track && likedTracks[item.track.id] !== false);
  const removedCount = (trackData?.items.length ?? 0) - items.length;

  const country = useUserStore((s) => s.profile?.country);
  const handleTrackSelect = (index) => {
    if (!token || !trackData) return;
    if (isUnplayable(items[index]?.track, country)) { toast("Spotify can't play this song."); return; }

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
    }, { rootMargin: '800px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount, totalRows, nextPageUrl]);

  // The header and controls never wait for the songs
  const data = trackData
    ? { items, total: Math.max(0, (trackData.total || 0) - removedCount), next: trackData.next }
    : { items: [], total: 0, next: null };

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
              <button
                type="button"
                onClick={() => { if (!trackData) setReloadNonce((n) => n + 1); else if (data.next && !isFetchingMore.current) loadRestOfTracks(data.next); }}
                className="underline hover:text-white transition-colors"
              >
                Try again
              </button>
            </p>
          )}
        </div>
      </div>

      {/* Action Bar (Play & Shuffle) */}
      <div className="flex items-center space-x-4 mb-4 md:mb-8 pl-1 md:pl-4">
        <button onClick={() => handleTrackSelect(0)} aria-label="Play Liked Songs" className="w-12 h-12 md:w-14 md:h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
          <Play className="w-6 h-6 fill-current ml-1" />
        </button>
        <button onClick={handleShufflePlay} aria-label="Shuffle play" title="Shuffle play" className={`w-11 h-11 flex items-center justify-center hover:scale-110 transition-all ${isShuffled ? 'text-[var(--brand-mid)]' : 'text-neutral-400 hover:text-white'}`}>
          <Shuffle className="w-6 h-6" />
        </button>
      </div>

      {/* Tracklist Header */}
      <div className={`hidden md:grid ${GRID} gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none`}>
        <span>#</span><span /><span>Title</span><span>Album</span><span>Date Added</span><div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {!trackData && !loadError && <SkeletonRows count={8} />}
        {trackData && data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-500">Songs you like will appear here. Tap the heart on any song.</p>
        )}
        {data.items.slice(0, visibleCount).map((item, index) => {
          const track = item.track;
          if (!track) return null;

          const isCurrentTrack = isSameTrack(track, currentTrack);
          const unplayable = isUnplayable(track, country);

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={() => handleTrackSelect(index)}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
              aria-disabled={unplayable || undefined}
              title={unplayable ? 'Not available on Spotify' : undefined}
              className={`grid ${GRID} gap-3 md:gap-4 px-2 md:px-4 py-2.5 md:py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${unplayable ? 'opacity-45' : ''}`}
            >
              <div className="text-neutral-400 w-4 h-4 hidden md:flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-[var(--brand-mid)] font-bold animate-pulse">🔊</span>
                ) : (
                  <><span className={`group-hover:hidden ${isCurrentTrack ? 'text-brand-gradient font-bold' : ''}`}>{index + 1}</span><Play className="w-4 h-4 text-white hidden group-hover:block fill-current" /></>
                )}
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-md overflow-hidden flex-shrink-0">
                {track.album?.images?.[0]?.url ? (
                  <img src={artUrl(track.album.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center">🎵</div>
                )}
              </div>
              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>{track.name}</span>
                <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
              </div>
              <div className="hidden md:block truncate pr-4">
                {track.album?.id ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigateToAlbum(track.album.id); }}
                    className="text-neutral-400 hover:text-white hover:underline transition-colors text-left truncate block w-full"
                  >
                    {track.album.name}
                  </button>
                ) : (
                  <span className="text-neutral-400 truncate">{track.album?.name}</span>
                )}
              </div>
              <span className="hidden md:block text-neutral-400 text-xs truncate">{formatDateAdded(item.added_at)}</span>
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