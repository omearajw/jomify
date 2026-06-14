import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { fetchPlaylistDetails, playPlaylistTrack, checkTracksLiked, fetchMoreTracks } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Clock3, Play } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

// Robust string cleaner to bypass Spotify's meta mismatches
const cleanString = (str) => {
  if (!str) return '';
  return str
    .split(/[-(]/)[0] // Grab everything before a hyphen or parenthesis
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Keep only alphanumeric characters
    .trim();
};

export default function PlaylistView() {
  const { token, activePlaylistId, setLikedTracks, setContextMenu } = useUserStore();
  const { deviceId, playbackState } = usePlayerStore();
  const [playlist, setPlaylist] = useState(null);
  
  const isFetchingMore = useRef(false);

  const currentPlayingTrack = playbackState?.track_window?.current_track;
  const isCurrentTrackPaused = playbackState ? playbackState.paused : true;

  const checkLikesForChunk = (items) => {
    const ids = items.map(item => item.track?.id).filter(Boolean);
    if (ids.length > 0) {
      checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
    }
  };

  useEffect(() => {
    if (token && activePlaylistId) {
      setPlaylist(null); 
      isFetchingMore.current = false;

      fetchPlaylistDetails(token, activePlaylistId)
        .then((data) => {
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

  const loadRestOfTracks = async (initialNextUrl) => {
    isFetchingMore.current = true;
    let nextUrl = initialNextUrl;

    while (nextUrl) {
      try {
        const nextData = await fetchMoreTracks(token, nextUrl);
        
        setPlaylist((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: {
              ...prev.tracks,
              items: [...prev.tracks.items, ...nextData.items],
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

  const handleTrackSelect = (index) => {
    if (!token || !deviceId) return;
    playPlaylistTrack(token, deviceId, activePlaylistId, index).catch(console.error);
  };

  const handleRightClick = (e, track) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track: track
    });
  };

  if (!playlist) {
    return <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading tracks...</p>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Playlist Header */}
      <div className="flex items-end space-x-6 mb-8 mt-4 select-none">
        {playlist.images?.length > 0 ? (
          <img src={playlist.images[0].url} alt={playlist.name} className="w-48 h-48 shadow-2xl shadow-black/50 rounded" />
        ) : (
          <div className="w-48 h-48 bg-neutral-800 flex items-center justify-center text-4xl shadow-2xl rounded"> 💿 </div>
        )}
        <div>
          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Playlist</p>
          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter mb-4">{playlist.name}</h1>
          <p className="text-neutral-400 text-sm font-medium">
            {playlist.description && <span className="mr-2">{playlist.description} •</span>}
            {playlist.owner.display_name} • {playlist.tracks.total} songs
          </p>
        </div>
      </div>

      {/* Tracklist Header */}
      <div className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-2 border-b border-neutral-800 text-neutral-400 text-sm mb-4 items-center select-none">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <div className="flex justify-end pr-2"><Clock3 className="w-4 h-4" /></div>
      </div>

      {/* Tracklist */}
      <div className="flex flex-col">
        {playlist.tracks.items.map((item, index) => {
          const track = item.track;
          if (!track) return null;

          // Multi-layered verification matching logic
          const isCurrentTrack = currentPlayingTrack && (
            track.id === currentPlayingTrack.id || 
            track.uri === currentPlayingTrack.uri ||
            (track.linked_from && track.linked_from.id === currentPlayingTrack.id) ||
            (cleanString(track.name) === cleanString(currentPlayingTrack.name) && 
             track.artists?.[0]?.name === currentPlayingTrack.artists?.[0]?.name)
          );

          return (
            <div 
              key={`${track.id}-${index}`} 
              onClick={() => handleTrackSelect(index)}
              onContextMenu={(e) => handleRightClick(e, track)}
              className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-4 px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm items-center transition-colors cursor-pointer"
            >
              <div className="text-neutral-400 w-4 h-4 flex items-center justify-center">
                {isCurrentTrack && !isCurrentTrackPaused ? (
                  <span className="text-green-500 font-bold animate-pulse">🔊</span>
                ) : (
                  <>
                    <span className={`group-hover:hidden ${isCurrentTrack ? 'text-green-500 font-bold' : ''}`}>
                      {index + 1}
                    </span>
                    <Play className="w-4 h-4 text-white hidden group-hover:block fill-current" />
                  </>
                )}
              </div>
              
              <div className="flex flex-col truncate pr-4">
                <span className={`font-medium truncate ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}>
                  {track.name}
                </span>
                <span className="text-neutral-400 text-xs truncate">
                  {track.artists.map(a => a.name).join(', ')}
                </span>
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