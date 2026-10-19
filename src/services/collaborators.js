import { spotifyFetch } from './spotify/api';
import { withFallback, playlistItemsUrl } from './spotify/compat';
import { log } from './debugLog';

// Who you share playlists with, for friend suggestions (Jack, 19 Oct): everyone who has added a
// song to a collaborative playlist in your library, and the owners of those you follow. One
// request a playlist (the first 100 entries, added_by only), remembered on this device against
// the playlist's snapshot, so a playlist is read again only when it has changed.
// Blends belong to Spotify and Jomify may not open them; whether that holds for this account is
// what "Check Spotify" reports (BLEND lines), and they join here if it ever does.

const STORE_KEY = 'jomify_collaborators';
const SPACING_MS = 250;

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* full or blocked */ } };

let running = null;

// { [userId]: [{ playlistId, name, songs }] }, the people you share a playlist with and where
export async function scanCollaborators(token, playlists, meId) {
  if (running) return running;
  running = (async () => {
    const cache = load();
    const shared = (playlists || []).filter((p) => p?.id && p.collaborative);
    let asked = 0;
    for (const p of shared) {
      const snap = p.snapshot_id || '';
      if (cache[p.id]?.snap === snap && snap) continue;
      try {
        const query = 'limit=100&fields=items(added_by(id))';
        const res = await withFallback('playlist items',
          () => spotifyFetch(playlistItemsUrl(p.id, query), { headers: { Authorization: `Bearer ${token}` } }),
          () => spotifyFetch(playlistItemsUrl(p.id, query, { legacy: true }), { headers: { Authorization: `Bearer ${token}` } }));
        if (!res.ok) { cache[p.id] = { snap, name: p.name, owner: p.owner?.id || null, adders: {} }; continue; }
        const adders = {};
        ((await res.json())?.items || []).forEach((i) => { const id = i?.added_by?.id; if (id) adders[id] = (adders[id] || 0) + 1; });
        cache[p.id] = { snap, name: p.name, owner: p.owner?.id || null, adders };
        asked += 1;
      } catch (err) {
        if (err?.message === 'RATE_LIMITED') break;
      }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    // forget playlists no longer in the library
    const present = new Set(shared.map((p) => p.id));
    Object.keys(cache).forEach((id) => { if (!present.has(id)) delete cache[id]; });
    save(cache);
    if (asked) log('friends', 'read who adds to shared playlists', `${asked} of ${shared.length} asked, the rest unchanged`);
    return byPerson(cache, meId);
  })();
  try { return await running; } finally { running = null; }
}

export const knownCollaborators = (meId) => byPerson(load(), meId);

function byPerson(cache, meId) {
  const people = {};
  Object.entries(cache).forEach(([playlistId, entry]) => {
    const add = (id, songs) => {
      if (!id || id === meId || id === 'spotify') return;
      (people[id] = people[id] || []).push({ playlistId, name: entry.name, songs });
    };
    Object.entries(entry.adders || {}).forEach(([id, n]) => add(id, n));
    if (entry.owner && !(entry.adders || {})[entry.owner]) add(entry.owner, 0);
  });
  return people;
}
