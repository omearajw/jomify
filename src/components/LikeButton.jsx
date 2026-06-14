import { Heart } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { toggleTrackLike } from '../services/spotify/api';

export default function LikeButton({ trackId }) {
  const { token, likedTracks, setLikedTracks } = useUserStore();
  const isLiked = likedTracks[trackId] || false;

  const handleToggle = (e) => {
    e.stopPropagation(); // Prevents the playlist row from playing the song when you click the heart
    if (!token || !trackId) return;

    // Optimistic UI Update: Instantly flip the state
    setLikedTracks({ [trackId]: !isLiked });
    
    // Perform actual API call
    toggleTrackLike(token, trackId, isLiked).catch((err) => {
      console.error(err);
      // Revert if the network fails
      setLikedTracks({ [trackId]: isLiked }); 
    });
  };

  return (
    <button onClick={handleToggle} className="flex items-center justify-center transition-all hover:scale-110">
      <Heart className={`w-5 h-5 transition-colors ${isLiked ? 'fill-green-500 text-green-500' : 'text-neutral-400 hover:text-white'}`} />
    </button>
  );
}