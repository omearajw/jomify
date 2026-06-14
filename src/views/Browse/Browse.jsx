import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { searchSpotify, playSingleTrack, checkTracksLiked } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Search, Play } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

export default function Browse() {
  const { token, setLikedTracks } = useUserStore();
  const { deviceId } = usePlayerStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (query.trim() && token) {
        searchSpotify(token, query)
          .then((data) => {
            setResults(data);
            
            // Extract searched track IDs and bulk check them
            if (data?.tracks?.items) {
              const ids = data.tracks.items.map(track => track.id).filter(Boolean);
              if (ids.length > 0) {
                checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
              }
            }
          })
          .catch(console.error);
      } else {
        setResults(null);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [query, token, setLikedTracks]);

  const handleTrackPlay = (trackUri) => {
    if (!token || !deviceId) return;
    playSingleTrack(token, deviceId, trackUri).catch(console.error);
  };

  return (
    <div className="flex flex-col pb-8 select-none">
      <h1 className="text-4xl font-extrabold text-white tracking-tighter mb-6">Browse</h1>
      
      {/* Minimalist Search Input Bar */}
      <div className="relative w-full max-w-md mb-8">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-neutral-500" />
        <input 
          type="text"
          placeholder="Search songs, artists, or albums..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-neutral-800 border-none rounded-full py-3 pl-12 pr-6 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
        />
      </div>

      {results ? (
        <div className="space-y-10 animate-fade-in">
          
          {/* Songs Section */}
          {results.tracks?.items?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Songs</h2>
              <div className="flex flex-col space-y-1">
                {results.tracks.items.map((track) => (
                  <div 
                    key={track.id}
                    onClick={() => handleTrackPlay(track.uri)}
                    className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                  >
                    <div className="flex items-center space-x-4 truncate pr-4">
                      <div className="relative w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center">
                        <img src={track.album.images?.[0]?.url} alt="" className="w-full h-full object-cover rounded" />
                        <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded">
                          <Play className="w-4 h-4 text-white fill-current" />
                        </div>
                      </div>
                      <div className="truncate">
                        <p className="text-white font-medium truncate">{track.name}</p>
                        <p className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</p>
                      </div>
                    </div>
                    
                    {/* Controls & Time */}
                    <div className="flex items-center space-x-4">
                      <LikeButton trackId={track.id} />
                      <span className="text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Artists Section */}
          {results.artists?.items?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Artists</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {results.artists.items.map((artist) => (
                  <div key={artist.id} className="bg-neutral-800/30 p-4 rounded-xl flex flex-col items-center text-center">
                    <div className="w-24 h-24 bg-neutral-700 rounded-full mb-3 overflow-hidden shadow-md">
                      {artist.images?.[0]?.url && (
                        <img src={artist.images[0].url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="text-white text-sm font-bold truncate w-full">{artist.name}</p>
                    <p className="text-neutral-400 text-xs uppercase tracking-wider mt-1">Artist</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Albums Section */}
          {results.albums?.items?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {results.albums.items.map((album) => (
                  <div key={album.id} className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group">
                    <div className="aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                      {album.images?.[0]?.url && (
                        <img src={album.images[0].url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      )}
                    </div>
                    <p className="text-white text-sm font-bold truncate w-full">{album.name}</p>
                    <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{album.artists.map(a => a.name).join(', ')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
          <p className="text-lg font-medium">Search for music catalog data</p>
          <p className="text-sm mt-1">No audiobooks, podcasts, or advertisements included.</p>
        </div>
      )}
    </div>
  );
}