import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchInitialLikedSongs, playLikedSongsQueue, fetchMoreTracks } from '../../services/spotify/api';
import { resolvePlaybackDeviceId, handlePlaybackError, toggleShuffle } from '../../services/spotify/playbackController';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, Heart, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { rowButtonProps } from '../../utils/a11y';
import MoreButton from '../../components/MoreButton';

export default function LikedSongsView() {
  const { token, setLikedTracks, setContextMenu } = useUserStore();
  const { playbackState, isShuffled } = usePlayerStore();
  const [trackData, setTrackData] = useState(null);
  
  const isFetchingMore = useRef(false);

  const isCurrentTrackPaused = playbackState ? playbackState.paused : true;

  // Set when a page fails to load partway; the header then says how much is actually here
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (token) {
      isFetchingMore.current = false;
      fetchInitialLikedSongs(token).then((data) => {
        setTrackData(data);
        
        // Globally mark as liked
        const updates = {};
        data.items.forEach(item => { if (item.track?.id) updates[item.track.id] = true; });
        setLikedTracks(updates);

        if (data.next && !isFetchingMore.current) {
          loadRestOfTracks(data.next);
        }
      }).catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // A function declaration rather than a const, so the effect above can reference it without
  // a use-before-declare: declarations hoist, and it only ever runs after mount anyway.
  async function loadRestOfTracks(initialNextUrl) {
    isFetchingMore.current = true;
    setLoadError('');
    let nextUrl = initialNextUrl;

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
    const deviceId = resolvePlaybackDeviceId();
    if (!deviceId) return;
    const userId = useUserStore.getState().profile?.id;
    playLikedSongsQueue(token, deviceId, allUris, index, userId).catch(handlePlaybackError);
  };

  if (!trackData) {
    return <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading your collection...</p>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 mb-6 mt-4 select-none">
        <div className="w-40 h-40 md:w-48 md:h-48 shrink-0 bg-gradient-to-br from-indigo-700 to-blue-500 flex items-center justify-center shadow-2xl rounded">
          <Heart className="w-16 h-16 fill-white text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Playlist</p>
          <h1 className="text-3xl md:text-5xl lg:text-7xl font-extrabold text-white tracking-tighter mb-4">Liked Songs</h1>
          <p className="text-neutral-400 text-sm font-medium">
            {trackData.items.length < trackData.total
              ? `${trackData.items.length.toLocaleString()} of ${trackData.total.toLocaleString()} songs loaded`
              : `${trackData.total.toLocaleString()} songs`}
          </p>
          {loadError && (
            <p className="text-red-400 text-xs font-medium mt-2 flex items-center gap-3">
              {loadError}
              {trackData.next && (
                <button
                  type="button"
                  onClick={() => { if (!isFetchingMore.current) loadRestOfTracks(trackData.next); }}
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
      <div className="flex items-center space-x-4 mb-8 pl-4">
        <div className="flex items-center space-x-4 mb-8 pl-4">
          <button onClick={() => handleTrackSelect(0)} aria-label="Play Liked Songs" className="w-14 h-14 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
            <Play className="w-6 h-6 fill-current ml-1" />
          </button>
          <button onClick={handleToggleShuffle} className={`w-10 h-10 flex items-center justify-center hover:scale-110 transition-all ${isShuffled ? 'text-brand-gradient' : 'text-neutral-400 hover:text-white'}`}>
            <Shuffle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Tracklist Header */}
      <div className="hidden md:grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none">
        <span>#</span><span>Title</span><span>Album</span><div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {trackData.items.map((item, index) => {
          const track = item.track;
          if (!track) return null;

          const currentTrack = playbackState?.track_window?.current_track;
          
          // ROBUST MATCH: Checks ID, URI, and falls back to exact Title + Artist match
          const isCurrentTrack = currentTrack && (
            track.id === currentTrack.id || 
            track.uri === currentTrack.uri ||
            (track.linked_from && track.linked_from.id === currentTrack.id) ||
            (track.name.split(/[-(]/)[0].trim().toLowerCase() === currentTrack.name.split(/[-(]/)[0].trim().toLowerCase() && 
             track.artists?.[0]?.name === currentTrack.artists?.[0]?.name)
          );

          return (
            <div
              key={`${track.id}-${index}`}
              onClick={() => handleTrackSelect(index)}
              {...rowButtonProps(() => handleTrackSelect(index))}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
              className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer"
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
                <span className="text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
                <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}