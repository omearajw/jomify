// Spotify renamed and merged a set of endpoints in 2026 and marked the old ones deprecated.
// Both halves still answer for Jack's account (checked 5 Oct 2026), so every call here tries
// the new shape first and falls back to the old one when the new is refused, remembering the
// refusal for a while so a missing endpoint does not double every request. Responses are
// normalised to the shape the rest of the app has always read, so a playlist's songs are
// `tracks.items[].track` whichever endpoint delivered them.
import { log } from '../debugLog.js';

const REFUSED_FOR_MS = 60 * 60 * 1000;
const refused = new Map(); // label -> when the new endpoint last refused

// Statuses that mean "this endpoint is not here for you" rather than "try again later"
const REFUSAL = new Set([400, 403, 404, 405, 410, 501]);

export function newEndpointRefused(label) {
  const at = refused.get(label);
  return Boolean(at) && Date.now() - at < REFUSED_FOR_MS;
}

// `requestNew` and `requestOld` each return a fetch Response. The old one is only used when the
// new one is refused; a rate limit or a server error on the new one is returned as is.
export async function withFallback(label, requestNew, requestOld) {
  if (!newEndpointRefused(label)) {
    const response = await requestNew();
    if (response.ok || !REFUSAL.has(response.status)) return response;
    refused.set(label, Date.now());
    log('api', `new endpoint refused with ${response.status}; using the old one for an hour`, label);
  }
  return requestOld();
}

// --- URLs -------------------------------------------------------------------------------------

export const API = 'https://api.spotify.com/v1';

// A playlist's songs: /items is the new name for /tracks. `query` is everything after the `?`.
export const playlistItemsUrl = (playlistId, query = '', { legacy = false } = {}) =>
  `${API}/playlists/${encodeURIComponent(playlistId)}/${legacy ? 'tracks' : 'items'}${query ? `?${query}` : ''}`;

// The same page under the other name, for retrying a URL Spotify handed us
export const swapItemsPath = (url, toLegacy) => (toLegacy
  ? url.replace(/\/playlists\/([^/?]+)\/items(?=[/?]|$)/, '/playlists/$1/tracks')
  : url.replace(/\/playlists\/([^/?]+)\/tracks(?=[/?]|$)/, '/playlists/$1/items'));

export const isPlaylistItemsUrl = (url) => /\/playlists\/[^/?]+\/(items|tracks)(?=[/?]|$)/.test(url);

// `fields` filters that name both the old and the new field, since unknown names are ignored.
// For a playlist object the songs moved from `tracks` to `items`; for a page of songs the array
// is `items` under both names and only the song inside moved from `track` to `item`.
const splitTopLevel = (fields) => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of fields) {
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
export const bothPlaylistFields = (fields) => splitTopLevel(fields)
  .flatMap((f) => (/\btracks\b/.test(f) ? [f, f.replace(/\btracks\b/g, 'items')] : [f])).join(',');
export const bothPageFields = (fields) => fields.replace(/\btrack(\((?:[^()]|\([^()]*\))*\))/g, 'track$1,item$1');

// --- Shapes -----------------------------------------------------------------------------------

// One entry of a playlist page: the song is under `item` now and `track` before; give it both
export function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.track === undefined && entry.item !== undefined) return { ...entry, track: entry.item };
  return entry;
}

// A page of entries (items/next/total/offset/limit)
export function normalizePage(page) {
  if (!page || !Array.isArray(page.items)) return page;
  return { ...page, items: page.items.map(normalizeEntry) };
}

// A playlist object: its songs live under `items` now and `tracks` before
export function normalizePlaylist(playlist) {
  if (!playlist || typeof playlist !== 'object') return playlist;
  const page = playlist.tracks ?? playlist.items;
  if (page === undefined) return playlist;
  const tracks = Array.isArray(page?.items) ? normalizePage(page) : page;
  return { ...playlist, tracks };
}

// --- Library URIs ------------------------------------------------------------------------------

export const LIBRARY_BATCH = 40;
export const trackUri = (id) => (String(id).startsWith('spotify:') ? id : `spotify:track:${id}`);
export const albumUri = (id) => (String(id).startsWith('spotify:') ? id : `spotify:album:${id}`);
export const userUri = (id) => (String(id).startsWith('spotify:') ? id : `spotify:user:${id}`);
export const playlistUri = (id) => (String(id).startsWith('spotify:') ? id : `spotify:playlist:${id}`);
export const artistUri = (id) => (String(id).startsWith('spotify:') ? id : `spotify:artist:${id}`);
export const libraryUrl = (uris) => `${API}/me/library?uris=${encodeURIComponent(uris.join(','))}`;
export const libraryContainsUrl = (uris) => `${API}/me/library/contains?uris=${encodeURIComponent(uris.join(','))}`;
