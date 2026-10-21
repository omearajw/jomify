import { spotifyFetch } from './spotify/api';
import { withFallback, playlistItemsUrl } from './spotify/compat';
import { log } from './debugLog';

// Who you share playlists with, for friend suggestions (Jack, 19 Oct): everyone who has added a
// song to a collaborative playlist in your library, and the owner of every other person's
// playlist you have saved (known from the library list, no request). A shared playlist is read
// whole, a page a request (added_by only), remembered on this device against its snapshot, so it
// is read again only when it has changed. Reading only its first 100 songs missed anyone who had
// added further down (Jack, 20 Oct).
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
    const others = (playlists || []).filter((p) => p?.id && (p.collaborative || (p.owner?.id && p.owner.id !== meId && p.owner.id !== 'spotify')));
    const entryOf = (p, adders) => ({ snap: p.snapshot_id || '', name: p.name, owner: p.owner?.id || null, ownerName: p.owner?.display_name || null, shared: Boolean(p.collaborative), adders });
    let asked = 0;
    for (const p of others) {
      const snap = p.snapshot_id || '';
      if (cache[p.id]?.snap === snap && snap && cache[p.id].shared === Boolean(p.collaborative)) continue;
      // someone else's playlist you saved: its owner is all there is to know
      if (!p.collaborative) { cache[p.id] = entryOf(p, {}); continue; }
      const adders = {};
      let complete = true;
      try {
        for (let offset = 0; ; offset += 100) {
          const query = `limit=100&offset=${offset}&fields=items(added_by(id)),total`;
          const res = await withFallback('playlist items',
            () => spotifyFetch(playlistItemsUrl(p.id, query), { headers: { Authorization: `Bearer ${token}` } }),
            () => spotifyFetch(playlistItemsUrl(p.id, query, { legacy: true }), { headers: { Authorization: `Bearer ${token}` } }));
          if (!res.ok) { complete = offset > 0 ? false : complete; break; }
          const page = await res.json();
          (page?.items || []).forEach((i) => { const id = i?.added_by?.id; if (id) adders[id] = (adders[id] || 0) + 1; });
          asked += 1;
          if (!page?.items?.length || offset + 100 >= (page.total ?? 0)) break;
          await new Promise((r) => setTimeout(r, SPACING_MS));
        }
      } catch (err) {
        complete = false;
        if (err?.message === 'RATE_LIMITED') { cache[p.id] = { ...entryOf(p, adders), snap: '' }; break; }
      }
      // a playlist read only in part is kept without its snapshot, so the next scan finishes it
      cache[p.id] = complete ? entryOf(p, adders) : { ...entryOf(p, adders), snap: '' };
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    // forget playlists no longer in the library
    const present = new Set(others.map((p) => p.id));
    Object.keys(cache).forEach((id) => { if (!present.has(id)) delete cache[id]; });
    save(cache);
    if (asked) log('friends', 'read who adds to shared playlists', `${asked} pages read; ${others.filter((p) => p.collaborative).length} shared playlists, ${others.filter((p) => !p.collaborative).length} saved from others`);
    return byPerson(cache, meId);
  })();
  try { return await running; } finally { running = null; }
}

export const knownCollaborators = (meId) => byPerson(load(), meId);

function byPerson(cache, meId) {
  const people = {};
  Object.entries(cache).forEach(([playlistId, entry]) => {
    // `shared`: a collaborative playlist you both add to; otherwise theirs, which you saved.
    // Entries cached before 20 Oct were all collaborative.
    const shared = entry.shared !== false;
    const add = (id, songs, name = null) => {
      if (!id || id === meId || id === 'spotify') return;
      (people[id] = people[id] || []).push({ playlistId, name: entry.name, songs, shared, personName: name });
    };
    Object.entries(entry.adders || {}).forEach(([id, n]) => add(id, n, id === entry.owner ? entry.ownerName : null));
    if (entry.owner && !(entry.adders || {})[entry.owner]) add(entry.owner, 0, entry.ownerName);
  });
  return people;
}
