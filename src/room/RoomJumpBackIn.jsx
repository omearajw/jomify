import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { fetchAlbumsByIds, fetchArtistsByIds, fetchPlaylistSummary, playContext } from '../services/spotify/api';
import { getRecentlyPlayed } from '../services/recentlyPlayed';
import { playOn } from '../services/spotify/playbackController';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';

// What you were last listening in, on the room's language, for the room's Home: bare covers
// under a mono head, the white Play disc on hover, artists round. The old page's JumpBackIn
// stays as it is for the old layout; the lookup is the same, written again here because that
// file keeps it private.

const MAX_ENTRIES = 10;
// Kept for the session, so coming back to Home shows the list at once; refreshed quietly
// behind it once it is this old
const FRESH_MS = 60 * 1000;
let cache = null; // { userId, entries, at }

// Spotify's recently-played feed lists tracks with the context they were played from. One cover
// per context, most recent first: the playlist, album or artist you were in, not the song.
async function buildEntries(token) {
  const { playlists, albums, profile } = useUserStore.getState();
  const items = await getRecentlyPlayed(token, profile?.id || '');
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

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;

export default function RoomJumpBackIn() {
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

  if (entries !== null && entries.length === 0) return null;

  const open = (entry) => {
    if (entry.type === 'playlist') navigateToPlaylist(entry.id);
    else if (entry.type === 'album') navigateToAlbum(entry.id);
    else navigateToArtist(entry.id);
  };
  const play = (entry) => playOn((deviceId) => playContext(token, deviceId, `spotify:${entry.type}:${entry.id}`));

  return (
    <section>
      <div className="mb-4 mt-10 border-b border-[var(--room-hair)] pb-2 @max-md:mt-8"><Mono className="text-[var(--room-faint)]">Jump back in</Mono></div>
      {entries === null ? (
        <Mono className="py-2 text-[var(--room-faint)]">Loading</Mono>
      ) : (
        <div className="grid gap-x-5 gap-y-6 @max-md:gap-x-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(132px, 40%), 1fr))' }}>
          {entries.map((entry) => (
            <div key={`${entry.type}-${entry.id}`} onClick={() => open(entry)} {...rowButtonProps(() => open(entry))} className="group min-w-0 cursor-pointer">
              <div className={`relative aspect-square w-full overflow-hidden bg-white/5 ${entry.round ? 'rounded-full' : 'rounded-[4px]'}`}>
                {entry.images?.length > 0 && <img src={artUrl(entry.images, 300)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
                <button type="button" onClick={(e) => { e.stopPropagation(); play(entry); }} aria-label={`Play ${entry.name}`} className={`absolute grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 ${entry.round ? 'bottom-[8%] right-[8%]' : 'bottom-2 right-2'}`} style={{ transitionDuration: 'var(--room-mid)' }}>
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                </button>
              </div>
              <p className="mt-2 truncate text-[13px] font-medium text-[var(--room-paper)]/90">{entry.name}</p>
              <Mono className="mt-0.5 truncate text-[var(--room-faint)]">{entry.subtitle}</Mono>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
