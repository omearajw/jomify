import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { playSingleTrack, checkTracksLiked } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { ArrowLeft, Play } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

// Safe String comparison for the Green Highlight
const cleanString = (str) => {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

export default function Album() {
  const { token, setLikedTracks, currentAlbumId, goBack, navigateToArtist } = useUserStore();
  const { deviceId, playbackState } = usePlayerStore();
  const [album, setAlbum] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  const currentPlayingTrack = playbackState?.track_window?.current_track;

  useEffect(() => {
    if (!token || !currentAlbumId) return;

    const fetchAlbumData = async () => {
      try {
        setLoading(true);
        // Fetch album details
        const albumRes = await fetch(`https://api.spotify.com/v1/albums/${currentAlbumId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const albumData = await albumRes.json();
        setAlbum(albumData);
        setTracks(albumData.tracks?.items || []);

        // Check liked status
        if (albumData.tracks?.items) {
          const ids = albumData.tracks.items.map(track => track.id).filter(Boolean);
          if (ids.length > 0) {
            checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
          }
        }
      } catch (error) {
        console.error('Failed to fetch album data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAlbumData();
  }, [token, currentAlbumId, setLikedTracks]);

  const handleTrackPlay = (trackUri) => {
    if (!token || !deviceId) return;
    playSingleTrack(token, deviceId, trackUri).catch(console.error);
  };

  const handleArtistClick = (e, artistId) => {
    e.stopPropagation();
    navigateToArtist(artistId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <p className="text-lg">Loading album...</p>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="flex flex-col pb-8">
        <button 
          onClick={goBack}
          className="flex items-center text-neutral-400 hover:text-white mb-6 w-fit font-bold transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <p className="text-neutral-400">Album not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      <button 
        onClick={goBack}
        className="flex items-center text-neutral-400 hover:text-white mb-6 w-fit font-bold transition-colors"
      >
        <ArrowLeft className="w-5 h-5 mr-2" /> Back
      </button>

      {/* Album Header */}
      <div className="flex items-end gap-6 mb-12">
        <div className="w-48 h-48 bg-neutral-700 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
          {album.images?.[0]?.url && (
            <img src={album.images[0].url} alt={album.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Album</p>
          <h1 className="text-6xl font-extrabold text-white tracking-tighter mb-4">{album.name}</h1>
          <div className="text-neutral-400 font-medium mb-4">
            <p>
              By{' '}
              {album.artists?.map((artist, i) => (
                <span key={artist.id}>
                  <span 
                    onClick={(e) => handleArtistClick(e, artist.id)}
                    className="text-white hover:underline cursor-pointer ml-1"
                  >
                    {artist.name}
                  </span>
                  {i < album.artists.length - 1 ? ',' : ''}
                </span>
              ))}
            </p>
            <p className="mt-2">
              {album.release_date?.split('-')[0]} • {album.total_tracks} tracks
            </p>
          </div>
        </div>
      </div>

      {/* Album Tracks */}
      {tracks.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Tracks</h2>
          <div className="flex flex-col space-y-1">
            {tracks.map((track, index) => {
              const isCurrentTrack = currentPlayingTrack && (
                track.id === currentPlayingTrack.id || 
                track.uri === currentPlayingTrack.uri ||
                (cleanString(track.name) === cleanString(currentPlayingTrack.name) && 
                 track.artists?.[0]?.name === currentPlayingTrack.artists?.[0]?.name)
              );

              return (
                <div
                  key={track.id}
                  onClick={() => handleTrackPlay(track.uri)}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <span className="text-neutral-400 w-8 text-right">{index + 1}</span>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}>
                        {track.name}
                      </p>
                      <p className="text-neutral-400 text-xs truncate">
                        {track.artists?.map((artist, i) => (
                          <span key={artist.id}>
                            <span 
                              onClick={(e) => handleArtistClick(e, artist.id)}
                              className="hover:underline hover:text-white"
                            >
                              {artist.name}
                            </span>
                            {i < track.artists.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
