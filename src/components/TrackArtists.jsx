import { useUserStore } from '../store/userStore';
import { idFromUri } from '../utils/spotifyUri';

// Renders a track's artists as a comma-separated list of clickable names.
//
// Accepts artists from either source: Web API objects carry `id`, Web Playback SDK objects
// carry only `uri`. Names without a resolvable id (local files, some relinked items) render
// as plain text rather than a dead link.
//
// `onBeforeNavigate` runs before the navigation fires -- for hosts that need to get out of the
// way first, such as a fullscreen overlay.
export default function TrackArtists({
  artists = [],
  className = '',
  // Default: not tappable on touch screens, where a name inside a track row stole taps meant
  // for the row. Screens whose names are not inside a playable row pass their own class.
  linkClassName = 'hover:underline hover:text-white transition-colors pointer-coarse:pointer-events-none',
  onBeforeNavigate
}) {
  const navigateToArtist = useUserStore((s) => s.navigateToArtist);

  if (!artists || artists.length === 0) return null;

  return (
    <span className={className}>
      {artists.map((artist, index) => {
        const id = artist.id || idFromUri(artist.uri, 'artist');
        const isLast = index === artists.length - 1;

        return (
          <span key={id || `${artist.name}-${index}`} className="inline">
            {id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBeforeNavigate?.();
                  navigateToArtist(id);
                }}
                className={`text-left ${linkClassName}`}
              >
                {artist.name}
              </button>
            ) : (
              <span>{artist.name}</span>
            )}
            {!isLast && ', '}
          </span>
        );
      })}
    </span>
  );
}
