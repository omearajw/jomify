import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useUserStore } from '../store/userStore';
import { fetchPlaylistSummary, fetchAlbumsByIds, fetchArtistsByIds } from '../services/spotify/api';

// Names what the music is coming from ("Playing from <playlist>"), the way Spotify's own
// Now Playing does. The library usually knows the name already; anything else is fetched once.
const names = new Map(); // context uri -> name | '' (looked up, nothing usable)

const parseContext = (uri) => {
  if (!uri) return null;
  const parts = uri.split(':');
  // spotify:user:<id>:collection is Liked Songs
  if (parts[1] === 'user' && parts[3] === 'collection') return { type: 'liked', id: parts[2] };
  if (['playlist', 'album', 'artist'].includes(parts[1]) && parts[2]) return { type: parts[1], id: parts[2] };
  return null;
};

const TYPE_LABEL = { playlist: 'playlist', album: 'album', artist: 'artist', liked: 'Liked Songs' };

async function lookUp(token, { type, id }) {
  if (type === 'playlist') return (await fetchPlaylistSummary(token, id)).name;
  if (type === 'album') return (await fetchAlbumsByIds(token, [id]))[0]?.name;
  if (type === 'artist') return (await fetchArtistsByIds(token, [id]))[0]?.name;
  return '';
}

// Returns null when nothing is known, else { type, id, name } (name '' while it is looked up)
export function usePlayingFrom() {
  const contextUri = usePlayerStore((s) => s.playbackState?.context?.uri || null);
  const parsed = parseContext(contextUri);
  const token = useUserStore((s) => s.token);
  const known = useUserStore((s) => {
    if (!parsed) return '';
    if (parsed.type === 'playlist') return s.playlists.find((p) => p.id === parsed.id)?.name || '';
    if (parsed.type === 'album') return (s.albums || []).find((a) => a.id === parsed.id)?.name || '';
    return '';
  });
  const [, setLookedUp] = useState(0);

  useEffect(() => {
    if (!parsed || !token || known || parsed.type === 'liked' || names.has(contextUri)) return undefined;
    let cancelled = false;
    lookUp(token, parsed)
      .then((name) => { names.set(contextUri, name || ''); })
      .catch(() => { names.set(contextUri, ''); })
      .finally(() => { if (!cancelled) setLookedUp((n) => n + 1); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextUri, token, known]);

  if (!parsed) return null;
  if (parsed.type === 'liked') return { type: 'liked', id: parsed.id, name: 'Liked Songs' };
  return { type: parsed.type, id: parsed.id, name: known || names.get(contextUri) || '' };
}

export const playingFromLabel = (from) => {
  if (!from) return '';
  if (from.type === 'liked') return 'Playing from Liked Songs';
  return from.name ? `Playing from ${from.name}` : `Playing from ${TYPE_LABEL[from.type]}`;
};
