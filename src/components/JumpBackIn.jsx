import { useEffect, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { fetchRecentlyPlayed, fetchAlbumsByIds, fetchArtistsByIds, fetchPlaylistSummary } from '../services/spotify/api';
import { artUrl } from '../utils/images';

const MAX_ENTRIES = 10;

// Spotify's recently-played feed lists tracks with the context they were played from. One card
// per context, most recent first: the playlist, album or artist you were in, not the song.
async function buildEntries(token) {
  const items = await fetchRecentlyPlayed(token, 50);
  const { playlists, albums } = useUserStore.getState();
  const playlistById = new Map(playlists.map(p => [p.id, p]));
  const albumById = new Map((albums || []).map(a => [a.id, a]));

  const seen = new Set();
  const contexts = [];
  for (const item of items) {
    const uri = item.context?.uri;
    if (!uri || seen.has(uri)) continue;
    const [, type, id] = uri.split(':');
    if (!['playlist', 'album', 'artist'].includes(type) || !id) continue;
    seen.add(uri);
    contexts.push({ type, id, playedAt: item.played_at });
    if (contexts.length >= MAX_ENTRIES) break;
  }

  const albumIds = contexts.filter(c => c.type === 'album' && !albumById.has(c.id)).map(c => c.id);
  const artistIds = contexts.filter(c => c.type === 'artist').map(c => c.id);
  const playlistIds = contexts.filter(c => c.type === 'playlist' && !playlistById.has(c.id)).map(c => c.id);
  const [fetchedAlbums, fetchedArtists, fetchedPlaylists] = await Promise.all([
    albumIds.length ? fetchAlbumsByIds(token, albumIds).catch(() => []) : [],
    artistIds.length ? fetchArtistsByIds(token, artistIds).catch(() => []) : [],
    // Spotify-owned playlists refuse this call for third-party apps; those simply drop out
    Promise.all(playlistIds.map(id => fetchPlaylistSummary(token, id).catch(() => null)))
  ]);
  fetchedAlbums.forEach(a => { if (a) albumById.set(a.id, a); });
  fetchedPlaylists.forEach(p => { if (p) playlistById.set(p.id, p); });
  const artistById = new Map(fetchedArtists.filter(Boolean).map(a => [a.id, a]));

  return contexts.map(c => {
    if (c.type === 'playlist') {
      const p = playlistById.get(c.id);
      return p ? { ...c, name: p.name, images: p.images, subtitle: `Playlist${p.owner?.display_name ? ` · ${p.owner.display_name}` : ''}` } : null;
    }
    if (c.type === 'album') {
      const a = albumById.get(c.id);
      return a ? { ...c, name: a.name, images: a.images, subtitle: a.artists?.map(x => x.name).join(', ') || 'Album' } : null;
    }
    const a = artistById.get(c.id);
    return a ? { ...c, name: a.name, images: a.images, subtitle: 'Artist', round: true } : null;
  }).filter(Boolean);
}

export default function JumpBackIn() {
  const { token, navigateToPlaylist, navigateToAlbum, navigateToArtist } = useSlice(useUserStore, ['token', 'navigateToPlaylist', 'navigateToAlbum', 'navigateToArtist']);
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    buildEntries(token)
      .then((list) => { if (!cancelled) setEntries(list); })
      .catch((err) => {
        // A session granted before the recently-played scope existed gets a 403 here; the
        // section simply stays hidden until the next sign-in
        console.debug('[home] recently played unavailable:', err?.message || err);
        if (!cancelled) setEntries([]);
      });
    return () => { cancelled = true; };
  }, [token]);

  if (!entries || entries.length === 0) return null;

  const open = (entry) => {
    if (entry.type === 'playlist') navigateToPlaylist(entry.id);
    else if (entry.type === 'album') navigateToAlbum(entry.id);
    else navigateToArtist(entry.id);
  };

  return (
    <div className="w-full mb-8">
      <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">Jump back in</h3>
      <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry) => (
          <button
            key={`${entry.type}-${entry.id}`}
            type="button"
            onClick={() => open(entry)}
            className="shrink-0 w-32 md:w-40 text-left group"
          >
            <div className={`w-32 h-32 md:w-40 md:h-40 overflow-hidden bg-neutral-800 shadow-lg ${entry.round ? 'rounded-full' : 'rounded-xl'}`}>
              {entry.images?.[0]?.url && (
                <img src={artUrl(entry.images, 160)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              )}
            </div>
            <p className="mt-2 text-sm font-bold text-white truncate">{entry.name}</p>
            <p className="text-xs text-neutral-400 truncate">{entry.subtitle}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
