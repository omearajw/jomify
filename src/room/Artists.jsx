import { useUserStore } from '../store/userStore';
import { idFromUri } from '../utils/spotifyUri';

// A song's artists as names that open the artist, wherever the room shows a song: the room's
// own line, the queue, every list's rows. Web API artists carry `id`, the player's carry only
// `uri`; a name with neither (a local file) stays plain text.
// In a row (`inRow`) a touch on the name is the row's, as it was before the room: a name is a
// small target inside a row you tap to play, so on touch screens the row wins and the artist is
// in the row's menu. Off a row (the room's song line) it is a link on every screen.
export default function Artists({ artists, inRow = false, className = '' }) {
  const navigateToArtist = useUserStore((s) => s.navigateToArtist);
  const list = artists || [];
  return (
    <span className={className}>
      {list.map((a, k) => {
        const id = a.id || idFromUri(a.uri, 'artist');
        return (
          <span key={id || `${a.name}-${k}`}>
            {id ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); navigateToArtist(id); }}
                className={`text-left transition-colors hover:text-[var(--room-paper)] hover:underline hover:decoration-[var(--room-faint)] hover:underline-offset-2 ${inRow ? 'pointer-coarse:pointer-events-none' : ''}`}>
                {a.name}
              </button>
            ) : a.name}
            {k < list.length - 1 ? ', ' : ''}
          </span>
        );
      })}
    </span>
  );
}
