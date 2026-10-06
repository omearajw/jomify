import { useUserStore } from '../store/userStore.js';

// The library as last seen, so the app opens with something to show before Spotify answers,
// and opens at all when there is no connection. Playback needs Spotify; the shelves don't.
const KEY = 'jomify_library_cache';
const SAVE_DELAY_MS = 2000;

const slim = (p) => p && ({ id: p.id, name: p.name, images: p.images?.slice(0, 1) || [], owner: p.owner ? { id: p.owner.id, display_name: p.owner.display_name } : undefined, tracks: { total: p.tracks?.total ?? 0 }, collaborative: Boolean(p.collaborative), public: p.public, type: p.type || 'playlist' });
const slimAlbum = (a) => a && ({ id: a.id, name: a.name, images: a.images?.slice(0, 1) || [], artists: (a.artists || []).map((x) => ({ id: x.id, name: x.name })), total_tracks: a.total_tracks, type: 'album', release_date: a.release_date, album_type: a.album_type });
const slimArtist = (a) => a && ({ id: a.id, name: a.name, images: a.images?.slice(0, 1) || [], type: 'artist' });

export function loadLibraryCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// Fills in whatever the store does not yet have; live data replaces it as it arrives
export function hydrateLibraryFromCache() {
  const cached = loadLibraryCache();
  if (!cached) return false;
  const s = useUserStore.getState();
  const patch = {};
  if (!s.playlists.length && cached.playlists?.length) patch.playlists = cached.playlists;
  if (!(s.albums || []).length && cached.albums?.length) patch.albums = cached.albums;
  if (!s.followedArtists.length && cached.followedArtists?.length) patch.followedArtists = cached.followedArtists;
  if (!s.profile && cached.profile) patch.profile = cached.profile;
  if (Object.keys(patch).length) useUserStore.setState(patch);
  return Object.keys(patch).length > 0;
}

let timer = null;
function save() {
  const s = useUserStore.getState();
  if (!s.token || !s.profile) return;
  const snapshot = {
    savedAt: Date.now(),
    profile: { id: s.profile.id, display_name: s.profile.display_name, images: s.profile.images?.slice(0, 1) || [], country: s.profile.country },
    playlists: s.playlists.map(slim).filter(Boolean),
    albums: (s.albums || []).map(slimAlbum).filter(Boolean),
    followedArtists: s.followedArtists.map(slimArtist).filter(Boolean)
  };
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* full: the cache is a convenience */ }
}

export function startLibraryCache() {
  return useUserStore.subscribe(
    (s) => [s.playlists, s.albums, s.followedArtists, s.profile],
    () => { clearTimeout(timer); timer = setTimeout(save, SAVE_DELAY_MS); },
    { equalityFn: (a, b) => a.every((v, i) => v === b[i]) }
  );
}

export function clearLibraryCache() {
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}
