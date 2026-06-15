import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { searchSpotify, playSingleTrack, checkTracksLiked } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Search, Play, ArrowLeft } from 'lucide-react';
import LikeButton from '../../components/LikeButton';

// Safe String comparison for the Green Highlight
const cleanString = (str) => {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

export default function Browse() {
  const { token, setLikedTracks, navigateToArtist, navigateToAlbum } = useUserStore();
  const { deviceId, playbackState } = usePlayerStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null); // null | 'tracks' | 'albums' | 'artists'

  const currentPlayingTrack = playbackState?.track_window?.current_track;

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (query.trim() && token) {
        searchSpotify(token, query)
          .then((data) => {
            setResults(data);
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
        setExpandedSection(null);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [query, token, setLikedTracks]);

  const handleTrackPlay = (trackUri) => {
    if (!token || !deviceId) return;
    playSingleTrack(token, deviceId, trackUri).catch(console.error);
  };

  const handleArtistClick = (e, artistId) => {
    e.stopPropagation(); // Prevents track playback when clicking the name
    navigateToArtist(artistId);
  };

  const handleAlbumClick = (e, albumId) => {
    e.stopPropagation();
    navigateToAlbum(albumId);
  };

  // ----------------------------------------
  // EXPANDED VIEW RENDERER
  // ----------------------------------------
  if (expandedSection && results) {
    return (
      <div className="flex flex-col pb-8 select-none animate-fade-in px-2">
        <button 
          onClick={() => setExpandedSection(null)} 
          className="flex items-center text-neutral-400 hover:text-white mb-6 w-fit font-bold transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" /> Back to Search
        </button>

        {expandedSection === 'tracks' && (
          <div>
            <h1 className="text-3xl font-extrabold text-white mb-6">All Songs</h1>
            <div className="flex flex-col space-y-1">
              {results.tracks.items.map((track) => {
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
                      <div className="relative w-12 h-12 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center">
                        <img src={track.album.images?.[0]?.url} alt="" className="w-full h-full object-cover rounded" />
                        <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded">
                          <Play className="w-4 h-4 text-white fill-current" />
                        </div>
                      </div>
                      <div className="truncate">
                        <p className={`font-medium truncate ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}>
                          {track.name}
                        </p>
                        <p className="text-neutral-400 text-xs truncate">
                          {track.artists.map((artist, i) => (
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

        {expandedSection === 'artists' && (
          <div>
            <h1 className="text-3xl font-extrabold text-white mb-6">All Artists</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.artists.items.map((artist) => (
                <div 
                  key={artist.id} 
                  onClick={(e) => handleArtistClick(e, artist.id)}
                  className="bg-neutral-800/30 p-4 rounded-xl flex flex-col items-center text-center cursor-pointer hover:bg-neutral-800/60 transition-colors"
                >
                  <div className="w-32 h-32 bg-neutral-700 rounded-full mb-3 overflow-hidden shadow-md">
                    {artist.images?.[0]?.url && <img src={artist.images[0].url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <p className="text-white text-sm font-bold truncate w-full">{artist.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {expandedSection === 'albums' && (
          <div>
            <h1 className="text-3xl font-extrabold text-white mb-6">All Albums</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.albums.items.map((album) => (
                <div 
                  key={album.id} 
                  onClick={(e) => handleAlbumClick(e, album.id)}
                  className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
                >
                  <div className="aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                    {album.images?.[0]?.url && <img src={album.images[0].url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />}
                  </div>
                  <p className="text-white text-sm font-bold truncate w-full">{album.name}</p>
                  <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{album.artists[0].name}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------
  // STANDARD VIEW RENDERER
  // ----------------------------------------
  return (
    <div className="flex flex-col pb-8 select-none">
      <h1 className="text-4xl font-extrabold text-white tracking-tighter mb-6">Browse</h1>
      
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
          
          {/* Songs Preview */}
          {results.tracks?.items?.length > 0 && (
            <div>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-xl font-bold text-white">Songs</h2>
                {results.tracks.items.length > 4 && (
                  <button onClick={() => setExpandedSection('tracks')} className="text-sm font-bold text-neutral-400 hover:text-white transition-colors">
                    See more
                  </button>
                )}
              </div>
              <div className="flex flex-col space-y-1">
                {results.tracks.items.slice(0, 4).map((track) => {
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
                        <div className="relative w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center">
                          <img src={track.album.images?.[0]?.url} alt="" className="w-full h-full object-cover rounded" />
                          <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded">
                            <Play className="w-4 h-4 text-white fill-current" />
                          </div>
                        </div>
                        <div className="truncate">
                          <p className={`font-medium truncate ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}>
                            {track.name}
                          </p>
                          <p className="text-neutral-400 text-xs truncate">
                            {track.artists.map((artist, i) => (
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

          {/* Artists Preview */}
          {results.artists?.items?.length > 0 && (
            <div>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-xl font-bold text-white">Artists</h2>
                {results.artists.items.length > 5 && (
                  <button onClick={() => setExpandedSection('artists')} className="text-sm font-bold text-neutral-400 hover:text-white transition-colors">
                    See more
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {results.artists.items.slice(0, 5).map((artist) => (
                  <div 
                    key={artist.id} 
                    onClick={(e) => handleArtistClick(e, artist.id)}
                    className="bg-neutral-800/30 p-4 rounded-xl flex flex-col items-center text-center cursor-pointer hover:bg-neutral-800/60 transition-colors"
                  >
                    <div className="w-24 h-24 bg-neutral-700 rounded-full mb-3 overflow-hidden shadow-md">
                      {artist.images?.[0]?.url && <img src={artist.images[0].url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <p className="text-white text-sm font-bold truncate w-full">{artist.name}</p>
                    <p className="text-neutral-400 text-xs uppercase tracking-wider mt-1">Artist</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Albums Preview */}
          {results.albums?.items?.length > 0 && (
            <div>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-xl font-bold text-white">Albums</h2>
                {results.albums.items.length > 5 && (
                  <button onClick={() => setExpandedSection('albums')} className="text-sm font-bold text-neutral-400 hover:text-white transition-colors">
                    See more
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {results.albums.items.slice(0, 5).map((album) => (
                  <div 
                    key={album.id} 
                    onClick={(e) => handleAlbumClick(e, album.id)}
                    className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
                  >
                    <div className="aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                      {album.images?.[0]?.url && <img src={album.images[0].url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />}
                    </div>
                    <p className="text-white text-sm font-bold truncate w-full">{album.name}</p>
                    <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{album.artists[0].name}</p>
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