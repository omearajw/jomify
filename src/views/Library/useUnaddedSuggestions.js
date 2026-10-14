import { useEffect, useMemo, useState } from 'react';
import { fetchPlaylistSnapshot, fetchPlaylistTrackArtists, fetchArtistsByIds } from '../../services/spotify/api';
import { useUserStore } from '../../store/userStore';
import { buildProfile, rankProfiles, suggestPlaylists } from '../../utils/playlistSuggestions';
import { ensureTrackTags, tagCache } from '../../services/tags';
import { ensureSoundFeatures, soundFeatures } from '../../services/soundFeatures';

// Profiles the check playlists and ranks them for each row of Unadded Songs. Playlist track
// lists are kept per snapshot id (Spotify bumps it on every edit) on this device, and checked
// against the snapshot id the library list already carries, so reopening the page after a
// reload costs no request at all for a playlist that has not changed; artist genres barely
// change and are kept for a week, and song measurements (ReccoBeats) for a month. Every check
// playlist refetched on every reload was a burst of a page per hundred songs, which is what
// got Jomify rate limited.

const GENRE_CACHE_KEY = 'jomify_artist_genres';
const GENRE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRACKS_CACHE_KEY = 'jomify_unadded_profiles';

const trackCache = loadTrackCache(); // playlistId -> { snapshotId, name, tracks }
function loadTrackCache() {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(TRACKS_CACHE_KEY) || '{}');
    for (const [id, e] of Object.entries(raw)) if (e && Array.isArray(e.tracks)) map.set(id, e);
  } catch { /* fresh start */ }
  return map;
}
function saveTrackCache() {
  try {
    const out = {};
    for (const [id, e] of trackCache) if (e.snapshotId) out[id] = { snapshotId: e.snapshotId, name: e.name, tracks: e.tracks };
    localStorage.setItem(TRACKS_CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked: the in-memory copy still works */ }
}
// Spotify's "slow down": wait out the cooldown the interceptor set, then try again
const RATE_LIMITED = (err) => err?.message === 'RATE_LIMITED';
async function patient(work, tries = 3) {
  for (let n = 1; ; n++) {
    try { return await work(); }
    catch (err) {
      if (!RATE_LIMITED(err) || n >= tries) throw err;
      const until = useUserStore.getState().apiCooldownUntil || 0;
      await new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now() + 250)));
    }
  }
}
const genreCache = loadGenreCache();

function loadGenreCache() {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(GENRE_CACHE_KEY) || '{}');
    const now = Date.now();
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && now - (entry.t || 0) < GENRE_TTL_MS && Array.isArray(entry.g)) map.set(id, entry.g);
    }
  } catch { /* fresh start */ }
  return map;
}

function saveGenreCache() {
  try {
    const out = {};
    const t = Date.now();
    for (const [id, g] of genreCache) out[id] = { g, t };
    localStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked: the in-memory copy still works */ }
}

async function ensureGenres(token, artistIds) {
  const missing = [...new Set(artistIds)].filter((id) => id && !genreCache.has(id));
  if (missing.length === 0) return;
  const artists = await patient(() => fetchArtistsByIds(token, missing));
  for (const artist of artists) if (artist?.id) genreCache.set(artist.id, artist.genres || []);
  // Spotify can omit an artist from a batch; an empty answer stops it being asked for every visit
  for (const id of missing) if (!genreCache.has(id)) genreCache.set(id, []);
  saveGenreCache();
}

async function loadPlaylist(token, playlistId) {
  const cached = trackCache.get(playlistId);
  // the library list carries each playlist's snapshot id: a match means no request at all
  const known = useUserStore.getState().playlists?.find((p) => p.id === playlistId);
  if (cached && known?.snapshot_id && cached.snapshotId === known.snapshot_id) return { ...cached, name: known.name || cached.name };
  const head = await patient(() => fetchPlaylistSnapshot(token, playlistId));
  if (cached && cached.snapshotId === head.snapshot_id) return { ...cached, name: head.name };
  const tracks = await patient(() => fetchPlaylistTrackArtists(token, playlistId));
  const entry = { snapshotId: head.snapshot_id, name: head.name, tracks };
  trackCache.set(playlistId, entry);
  saveTrackCache();
  return entry;
}

// Called after a song has been sorted into a playlist so the next ranking knows about it
export function noteTrackSorted(playlistId, track) {
  const entry = trackCache.get(playlistId);
  if (!entry || !track?.id) return;
  entry.tracks.push({ id: track.id, name: track.name, artists: (track.artists || []).filter((a) => a?.id) });
  entry.snapshotId = null; // no longer matches Spotify's; refetched next time
  saveTrackCache();
}

export function useUnaddedSuggestions({ token, enabled, checkPlaylistIds, items }) {
  // Keyed by the playlist list it was built for, so a change of check playlists reads as
  // "loading" until the new profiles land instead of showing stale chips
  const [loaded, setLoaded] = useState({ key: '', profiles: [], status: 'idle' });
  const [genreVersion, setGenreVersion] = useState(0);

  const idsKey = (checkPlaylistIds || []).join(',');
  const active = Boolean(enabled && token && idsKey);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const ids = idsKey.split(',');
        const loadedPlaylists = [];
        for (const id of ids) {
          if (cancelled) return;
          try { loadedPlaylists.push({ id, ...(await loadPlaylist(token, id)) }); }
          catch (err) { console.warn('[unadded] could not profile playlist', id, err?.message || err); }
        }
        await ensureGenres(token, loadedPlaylists.flatMap((p) => p.tracks.flatMap((t) => t.artists.map((a) => a.id))));
        if (cancelled) return;
        // Mood comes from Last.fm's per-song tags; without the endpoint the genres still work
        // Tags and sound measurements together: neither waits on the other, and either failing
        // leaves the rest working
        const allTracks = loadedPlaylists.flatMap((p) => p.tracks);
        await Promise.all([ensureTrackTags(allTracks), ensureSoundFeatures(allTracks.map((t) => t.id))]);
        if (cancelled) return;
        setLoaded({
          key: idsKey,
          status: 'ready',
          profiles: rankProfiles(loadedPlaylists.map((p) => ({ id: p.id, name: p.name, profile: buildProfile(p.tracks, genreCache, tagCache, soundFeatures) })))
        });
      } catch (err) {
        console.warn('[unadded] suggestions unavailable:', err?.message || err);
        if (!cancelled) setLoaded({ key: idsKey, status: 'error', profiles: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [active, token, idsKey]);

  const current = active && loaded.key === idsKey ? loaded : { profiles: [], status: active ? 'loading' : 'idle' };
  const { profiles, status } = current;

  // Genres and tags for the rows themselves arrive in a second pass so the playlist profiles
  // never wait on a long Unadded Songs list
  const rowKey = useMemo(
    () => (enabled ? (items || []).map((i) => i?.track?.id).filter(Boolean).join(',') : ''),
    [enabled, items]
  );
  useEffect(() => {
    if (!token || !rowKey || status !== 'ready') return undefined;
    let cancelled = false;
    const rows = (items || []).map((i) => i?.track).filter((t) => t?.id);
    (async () => {
      await ensureGenres(token, rows.flatMap((t) => (t.artists || []).map((a) => a?.id)).filter(Boolean));
      if (cancelled) return;
      await Promise.all([ensureTrackTags(rows), ensureSoundFeatures(rows.map((t) => t.id))]);
      if (!cancelled) setGenreVersion((v) => v + 1);
    })().catch((err) => console.warn('[unadded] row tags unavailable:', err?.message || err));
    return () => { cancelled = true; };
    // rows are derived from items, which rowKey already tracks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, rowKey, status]);

  const suggestionsByTrack = useMemo(() => {
    const out = new Map();
    if (status !== 'ready') return out;
    for (const item of items || []) {
      const track = item?.track;
      if (!track?.id || out.has(track.id)) continue;
      out.set(track.id, suggestPlaylists(track, genreCache, profiles, { tagsByTrack: tagCache, featuresByTrack: soundFeatures }));
    }
    return out;
    // genreVersion is the signal that the cache gained the rows' artists
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, profiles, items, genreVersion]);

  return { status, suggestionsByTrack, targets: profiles.map((p) => ({ id: p.id, name: p.name })) };
}
