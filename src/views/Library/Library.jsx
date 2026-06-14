import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { fetchUserPlaylists } from '../../services/spotify/api';
import { Heart } from 'lucide-react';

export default function Library() {
  const { token, playlists, setPlaylists, setCurrentView, setActivePlaylistId } = useUserStore();
  const [loading, setLoading] = useState(playlists.length === 0);

  useEffect(() => {
    if (token && playlists.length === 0) {
      fetchUserPlaylists(token)
        .then((data) => {
          setPlaylists(data.items);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    }
  }, [token, playlists, setPlaylists]);

  if (loading) {
    return <p className="text-neutral-400 animate-pulse text-lg">Loading your collection...</p>;
  }

  return (
    <div>
      <h1 className="text-4xl font-extrabold text-white tracking-tighter mb-8">Your Library</h1>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {/* The Liked Songs Custom Card */}
        <div 
          onClick={() => setCurrentView('liked-songs')}
          className="bg-gradient-to-br from-indigo-700 to-blue-500 p-4 rounded-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group shadow-lg flex flex-col justify-end aspect-square relative overflow-hidden"
        >
          <div className="absolute top-4 left-4">
             <Heart className="w-8 h-8 fill-white text-white shadow-sm" />
          </div>
          <h3 className="font-bold text-2xl text-white mb-1 leading-tight tracking-tighter">Liked Songs</h3>
          <p className="text-xs text-indigo-100 font-medium">Your saved collection</p>
        </div>
        
        {playlists.map((playlist) => (
         <div 
            key={playlist.id} 
            onClick={() => {
                setActivePlaylistId(playlist.id);
                setCurrentView('playlist');
            }}
            className="bg-neutral-800/40 p-4 rounded-xl hover:bg-neutral-800/80 transition-all duration-300 cursor-pointer group shadow-lg"
         >
            <div className="relative aspect-square w-full mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md">
              {playlist.images?.length > 0 ? (
                <img 
                  src={playlist.images[0].url} 
                  alt={playlist.name} 
                  className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <span className="text-3xl">💿</span>
              )}
            </div>
            <h3 className="font-bold text-sm text-white truncate mb-1">{playlist.name}</h3>
            <p className="text-xs text-neutral-400 truncate">By {playlist.owner.display_name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}