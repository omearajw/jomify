// A read-only pass over every Spotify endpoint Jomify depends on, run from the debug log on the
// user's own device with their own login, writing one line per endpoint. Spotify marked many of
// these deprecated for development-mode apps in 2026 while leaving them answering, and the only
// way to know which still do is to ask them from an account that has access.

import { useUserStore } from '../store/userStore';
import { spotifyFetch } from './spotify/api';
import { log } from './debugLog';

const BASE = 'https://api.spotify.com/v1';

// Fields Spotify's 2026 changes removed for development-mode apps, and which Jomify shows. The
// check reports which of them this account still receives.
const WATCHED_FIELDS = {
  '/me': ['followers', 'product', 'email', 'country'],
  '/artists/': ['followers', 'popularity', 'genres'],
  '/tracks/': ['popularity', 'linked_from', 'available_markets'],
  '/albums/': ['label', 'popularity', 'copyrights'],
  '/users/': ['followers']
};

async function get(path, token) {
  const started = Date.now();
  try {
    const response = await spotifyFetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    let note = '';
    if (!response.ok) {
      try { note = (await response.json())?.error?.message || ''; } catch { /* no body */ }
    } else {
      // Only the single-object paths: "/me" itself, or "/artists/<id>" with nothing after the id
      const watched = Object.entries(WATCHED_FIELDS).find(([prefix]) =>
        prefix.endsWith('/') ? new RegExp(`^${prefix}[^/?]+$`).test(path) : path === prefix);
      if (watched) {
        try {
          const body = await response.json();
          note = 'fields: ' + watched[1].map((f) => `${f}=${body?.[f] === undefined ? 'gone' : 'present'}`).join(' ');
        } catch { /* not json */ }
      }
    }
    return { status: response.status, ms: Date.now() - started, note };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, note: err?.name === 'RATE_LIMITED' || err?.message === 'RATE_LIMITED' ? 'rate limited' : (err?.message || String(err)) };
  }
}

// Ids to try with come from the account itself: the first liked song gives a track, its artist
// and its album; the first owned playlist gives a playlist. Nothing is written anywhere.
async function sampleIds(token) {
  const ids = { user: useUserStore.getState().profile?.id || null, playlist: null, track: null, artist: null, album: null };
  const playlists = useUserStore.getState().playlists || [];
  ids.playlist = (playlists.find((p) => p.owner?.id === ids.user) || playlists[0])?.id || null;
  try {
    const response = await spotifyFetch(`${BASE}/me/tracks?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) {
      const track = (await response.json())?.items?.[0]?.track;
      ids.track = track?.id || null;
      ids.artist = track?.artists?.[0]?.id || null;
      ids.album = track?.album?.id || null;
    }
  } catch { /* reported by the /me/tracks line below */ }
  return ids;
}

export async function checkSpotifyEndpoints() {
  const token = useUserStore.getState().token;
  if (!token) { log('api check', 'not signed in'); return; }
  const ids = await sampleIds(token);
  const u = encodeURIComponent;
  const checks = [
    ['GET /me', '/me'],
    ['GET /me/playlists', '/me/playlists?limit=1'],
    ['GET /me/tracks', '/me/tracks?limit=1'],
    ['GET /me/albums', '/me/albums?limit=1'],
    ['GET /me/top/tracks', '/me/top/tracks?limit=1&time_range=short_term'],
    ['GET /me/top/artists', '/me/top/artists?limit=1&time_range=short_term'],
    ['GET /me/player/recently-played', '/me/player/recently-played?limit=1'],
    ['GET /me/player/devices', '/me/player/devices'],
    ['GET /me/player', '/me/player'],
    ['GET /search', '/search?q=jamiroquai&type=track&limit=1'],
    ['GET /search with limit=20 (Jomify asks for 20; the limit was cut to 10)', '/search?q=jamiroquai&type=track,album,artist,playlist&limit=20'],
    ids.track && ['GET /me/tracks/contains (deprecated)', `/me/tracks/contains?ids=${ids.track}`],
    ids.track && ['GET /me/library/contains (new)', `/me/library/contains?uris=${u(`spotify:track:${ids.track}`)}`],
    ids.track && ['GET /tracks/{id}', `/tracks/${ids.track}`],
    ids.artist && ['GET /artists/{id}', `/artists/${ids.artist}`],
    ids.artist && ['GET /artists?ids= (deprecated)', `/artists?ids=${ids.artist}`],
    ids.artist && ['GET /artists/{id}/top-tracks (deprecated)', `/artists/${ids.artist}/top-tracks?market=from_token`],
    ids.artist && ['GET /artists/{id}/albums', `/artists/${ids.artist}/albums?limit=1`],
    ids.album && ['GET /albums/{id}', `/albums/${ids.album}`],
    ids.album && ['GET /albums?ids= (deprecated)', `/albums?ids=${ids.album}`],
    ids.playlist && ['GET /playlists/{id}', `/playlists/${ids.playlist}?fields=id,name`],
    ids.playlist && ['GET /playlists/{id}/tracks (deprecated)', `/playlists/${ids.playlist}/tracks?limit=1`],
    ids.playlist && ['GET /playlists/{id}/items (new)', `/playlists/${ids.playlist}/items?limit=1`],
    ids.user && ['GET /users/{id} (deprecated)', `/users/${u(ids.user)}`],
    ids.user && ['GET /users/{id}/playlists (deprecated)', `/users/${u(ids.user)}/playlists?limit=1`],
    ids.user && ['GET /me/following/contains (deprecated)', `/me/following/contains?type=user&ids=${u(ids.user)}`],
    ids.user && ['GET /me/library/contains for a user (new)', `/me/library/contains?uris=${u(`spotify:user:${ids.user}`)}`]
  ].filter(Boolean);

  log('api check', 'starting', `${checks.length} endpoints, ids from the account: ${Object.entries(ids).map(([k, v]) => `${k}=${v ? 'yes' : 'none'}`).join(' ')}`);
  for (const [label, path] of checks) {
    const r = await get(path, token);
    log('api check', label, `${r.status || 'no response'} in ${r.ms}ms${r.note ? `, ${r.note}` : ''}`);
    // Spread out so the check itself cannot trip Spotify's rate limit
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  log('api check', 'finished');
}
