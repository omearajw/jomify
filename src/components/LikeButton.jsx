import { Heart } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { toggleTrackLike, checkTracksLiked } from '../services/spotify/api';

// Three states, not two. `likedTracks[trackId]` is undefined until a checkTracksLiked pass has
// covered that track, and "not checked yet" is not the same as "not liked": treating it as
// false meant the first click on an already-saved track sent a PUT for something Spotify
// already had, and the heart lied until then.
//
// One of these sits on every track row, so it subscribes to exactly its own entry: a
// whole-store subscription here re-rendered a thousand hearts on every drag and every poll.
export default function LikeButton({ trackId }) {
  const token = useUserStore((s) => s.token);
  const setLikedTracks = useUserStore((s) => s.setLikedTracks);
  const known = useUserStore((s) => s.likedTracks[trackId]);

  if (!trackId) return null;

  const isKnown = known !== undefined;
  const isLiked = known === true;

  const handleToggle = async (e) => {
    e.stopPropagation(); // Prevents the playlist row from playing the song when you click the heart
    if (!token) return;

    let current = isLiked;

    // Unknown state: find out before flipping, so we never toggle blind
    if (!isKnown) {
      try {
        const result = await checkTracksLiked(token, [trackId]);
        current = Boolean(result[trackId]);
        setLikedTracks({ [trackId]: current });
      } catch (err) {
        console.error(err);
        return;
      }
    }

    // Optimistic UI Update: Instantly flip the state
    setLikedTracks({ [trackId]: !current });

    // Perform actual API call
    toggleTrackLike(token, trackId, current).catch((err) => {
      console.error(err);
      // Revert if the network fails
      setLikedTracks({ [trackId]: current });
    });
  };

  const heartClass = isLiked
    ? 'fill-[var(--brand-mid)] text-[var(--brand-mid)]'
    : isKnown
      ? 'text-neutral-400 hover:text-white'
      : 'text-neutral-600 hover:text-white'; // dimmer: we haven't checked this one yet

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isLiked}
      aria-label={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      title={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      className="flex items-center justify-center transition-all hover:scale-110"
    >
      <Heart className={`w-5 h-5 transition-colors ${heartClass}`} />
    </button>
  );
}
