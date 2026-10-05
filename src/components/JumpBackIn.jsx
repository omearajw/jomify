import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { fetchRecentlyPlayed, fetchAlbumsByIds, fetchArtistsByIds, fetchPlaylistSummary, playContext } from '../services/spotify/api';
import { playOn } from '../services/spotify/playbackController';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import { Skeleton } from './Skeleton';

const MAX_ENTRIES = 10;
// Kept for the session, so coming back to Home shows the list at once instead of skeletons;
// refreshed quietly behind it once it is this old
const FRESH_MS = 60 * 1000;
let cache = null; // { userId, entries, at }

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
  const userId = useUserStore((s) => s.profile?.id || '');
  const [entries, setEntries] = useState(() => (cache && cache.userId === userId ? cache.entries : null));

  useEffect(() => {
    if (!token) return undefined;
    if (cache && cache.userId === userId && Date.now() - cache.at < FRESH_MS) return undefined;
    let cancelled = false;
    buildEntries(token)
      .then((list) => {
        cache = { userId, entries: list, at: Date.now() };
        if (!cancelled) setEntries(list);
      })
      .catch((err) => {
        // A session granted before the recently-played scope existed gets a 403 here; the
        // section simply stays hidden until the next sign-in
        console.debug('[home] recently played unavailable:', err?.message || err);
        if (!cancelled) setEntries((prev) => prev || []);
      });
    return () => { cancelled = true; };
  }, [token, userId]);

  // Still asking Spotify: hold the space with placeholders so the page doesn't reflow
  if (entries === null) {
    return (
      <div className="w-full mb-8" aria-busy="true">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">Jump back in</h3>
        <div className="flex gap-4 overflow-hidden pb-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="shrink-0 w-32 md:w-40">
              <Skeleton className="w-32 h-32 md:w-40 md:h-40 rounded-xl mb-2" />
              <Skeleton className="h-3.5 w-3/4 mb-1.5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (entries.length === 0) return null;

  const open = (entry) => {
    if (entry.type === 'playlist') navigateToPlaylist(entry.id);
    else if (entry.type === 'album') navigateToAlbum(entry.id);
    else navigateToArtist(entry.id);
  };
  const play = (entry) => playOn((deviceId) => playContext(token, deviceId, `spotify:${entry.type}:${entry.id}`));

  return (
    <div className="w-full mb-8">
      <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">Jump back in</h3>
      <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry) => (
          <div
            key={`${entry.type}-${entry.id}`}
            onClick={() => open(entry)}
            {...rowButtonProps(() => open(entry))}
            className="shrink-0 w-32 md:w-40 text-left group cursor-pointer"
          >
            <div className="relative w-32 h-32 md:w-40 md:h-40">
              <div className={`w-full h-full overflow-hidden bg-neutral-800 shadow-lg ${entry.round ? 'rounded-full' : 'rounded-xl'}`}>
                {entry.images?.[0]?.url && (
                  <img src={artUrl(entry.images, 160)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                )}
              </div>
              {/* Desktop: play straight from the card, as Spotify's Home does */}
              <button
                type="button"
                aria-label={`Play ${entry.name}`}
                onClick={(e) => { e.stopPropagation(); play(entry); }}
                className="hidden md:flex absolute bottom-2 right-2 w-10 h-10 rounded-full bg-brand-gradient text-white items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100 hover:scale-105 transition-all"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            </div>
            <p className="mt-2 text-sm font-bold text-white truncate">{entry.name}</p>
            <p className="text-xs text-neutral-400 truncate">{entry.subtitle}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
