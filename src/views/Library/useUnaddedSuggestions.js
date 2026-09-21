import { useEffect, useMemo, useState } from 'react';
import { fetchPlaylistSnapshot, fetchPlaylistTrackArtists, fetchArtistsByIds } from '../../services/spotify/api';
import { buildProfile, rankProfiles, suggestPlaylists } from '../../utils/playlistSuggestions';

// Profiles the check playlists and ranks them for each row of Unadded Songs. Playlist track
// lists are kept per snapshot id (Spotify bumps it on every edit), so reopening the page costs
// one small request per playlist; artist genres barely change and are kept for a week.

const GENRE_CACHE_KEY = 'jomify_artist_genres';
const GENRE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const trackCache = new Map(); // playlistId -> { snapshotId, name, tracks }
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
  const artists = await fetchArtistsByIds(token, missing);
  for (const artist of artists) if (artist?.id) genreCache.set(artist.id, artist.genres || []);
  // Spotify can omit an artist from a batch; an empty answer stops it being asked for every visit
  for (const id of missing) if (!genreCache.has(id)) genreCache.set(id, []);
  saveGenreCache();
}

async function loadPlaylist(token, playlistId) {
  const head = await fetchPlaylistSnapshot(token, playlistId);
  const cached = trackCache.get(playlistId);
  if (cached && cached.snapshotId === head.snapshot_id) return { ...cached, name: head.name };
  const tracks = await fetchPlaylistTrackArtists(token, playlistId);
  const entry = { snapshotId: head.snapshot_id, name: head.name, tracks };
  trackCache.set(playlistId, entry);
  return entry;
}

// Called after a song has been sorted into a playlist so the next ranking knows about it
export function noteTrackSorted(playlistId, track) {
  const entry = trackCache.get(playlistId);
  if (!entry || !track?.id) return;
  entry.tracks.push({ id: track.id, artists: (track.artists || []).filter((a) => a?.id) });
  entry.snapshotId = null; // no longer matches Spotify's; refetched next time
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
        setLoaded({
          key: idsKey,
          status: 'ready',
          profiles: rankProfiles(loadedPlaylists.map((p) => ({ id: p.id, name: p.name, profile: buildProfile(p.tracks, genreCache) })))
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

  // Genres for the rows themselves arrive in a second pass so the playlist profiles never wait
  // on a long Unadded Songs list
  const rowArtistKey = useMemo(
    () => (enabled ? (items || []).flatMap((i) => (i?.track?.artists || []).map((a) => a?.id)).filter(Boolean).join(',') : ''),
    [enabled, items]
  );
  useEffect(() => {
    if (!token || !rowArtistKey || status !== 'ready') return undefined;
    let cancelled = false;
    ensureGenres(token, rowArtistKey.split(','))
      .then(() => { if (!cancelled) setGenreVersion((v) => v + 1); })
      .catch((err) => console.warn('[unadded] row genres unavailable:', err?.message || err));
    return () => { cancelled = true; };
  }, [token, rowArtistKey, status]);

  const suggestionsByTrack = useMemo(() => {
    const out = new Map();
    if (status !== 'ready') return out;
    for (const item of items || []) {
      const track = item?.track;
      if (!track?.id || out.has(track.id)) continue;
      out.set(track.id, suggestPlaylists(track, genreCache, profiles));
    }
    return out;
    // genreVersion is the signal that the cache gained the rows' artists
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, profiles, items, genreVersion]);

  return { status, suggestionsByTrack, targets: profiles.map((p) => ({ id: p.id, name: p.name })) };
}
