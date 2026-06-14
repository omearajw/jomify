import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchInitialLikedSongs, playLikedSongsQueue, fetchMoreTracks, toggleShuffleState } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play, Heart, Shuffle } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

export default function LikedSongsView() {
  const { token, setLikedTracks } = useUserStore();
  const { deviceId, playbackState, isShuffled, toggleOptimisticShuffle } = usePlayerStore();
  const [trackData, setTrackData] = useState(null);
  
  const isFetchingMore = useRef(false);

  const currentPlayingTrackId = playbackState?.track_window?.current_track?.id;
  const isCurrentTrackPaused = playbackState ? playbackState.paused : true;

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

  const loadRestOfTracks = async (initialNextUrl) => {
    isFetchingMore.current = true;
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
        break;
      }
    }
    isFetchingMore.current = false;
  };

  const handleToggleShuffle = () => {
    if (!token || !deviceId) return;
    toggleOptimisticShuffle();
    toggleShuffleState(token, deviceId, !isShuffled).catch(console.error);
  };

  const handleTrackSelect = (index) => {
    if (!token || !deviceId || !trackData) return;
    const allUris = trackData.items.map(item => item.track.uri);
    playLikedSongsQueue(token, deviceId, allUris, index).catch(console.error);
  };

  if (!trackData) {
    return <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading your collection...</p>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-end space-x-6 mb-6 mt-4 select-none">
        <div className="w-48 h-48 bg-gradient-to-br from-indigo-700 to-blue-500 flex items-center justify-center shadow-2xl rounded">
          <Heart className="w-16 h-16 fill-white text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Playlist</p>
          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter mb-4">Liked Songs</h1>
          <p className="text-neutral-400 text-sm font-medium">{trackData.total} songs</p>
        </div>
      </div>

      {/* Action Bar (Play & Shuffle) */}
      <div className="flex items-center space-x-4 mb-8 pl-4">
        <div className="flex items-center space-x-4 mb-8 pl-4">
          <button onClick={() => handleTrackSelect(0)} className="w-14 h-14 bg-green-500 text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-xl">
            <Play className="w-6 h-6 fill-current ml-1" />
          </button>
          <button onClick={handleToggleShuffle} className={`w-10 h-10 flex items-center justify-center hover:scale-110 transition-all ${isShuffled ? 'text-green-500' : 'text-neutral-400 hover:text-white'}`}>
            <Shuffle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Tracklist Header */}
      <div className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none">
        <span>#</span><span>Title</span><span>Album</span><div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {trackData.items.map((item, index) => {
          const track = item.track;
          if (!track) return null;
          const isCurrentTrack = track.id === currentPlayingTrackId;

          return (
            <div key={`${track.id}-${index}`} onClick={() => handleTrackSelect(index)} className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer">
              <div className="text-neutral-400 w-4 h-4 flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-green-500 font-bold animate-pulse">🔊</span>
                ) : (
                  <><span className={`group-hover:hidden ${isCurrentTrack ? 'text-green-500 font-bold' : ''}`}>{index + 1}</span><Play className="w-4 h-4 text-white hidden group-hover:block fill-current" /></>
                )}
              </div>
              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}>{track.name}</span>
                <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
              </div>
              <span className="text-neutral-400 truncate pr-4">{track.album.name}</span>
              <div className="flex items-center justify-end space-x-4">
                <LikeButton trackId={track.id} />
                <span className="text-neutral-400 w-8 text-right">{formatTime(track.duration_ms)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}