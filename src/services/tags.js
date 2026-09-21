import { apiBaseUrl } from './sync/client';
import { useUserStore } from '../store/userStore';

// Track tags from Last.fm, through Jomify's own endpoint (which holds the key and caches).
// Kept here for a month too, so a playlist is only ever looked up once per device.

const CACHE_KEY = 'jomify_track_tags';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 20;

const memory = loadCache();

function loadCache() {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const now = Date.now();
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && now - (entry.t || 0) < TTL_MS && Array.isArray(entry.g)) map.set(id, entry.g);
    }
  } catch { /* fresh start */ }
  return map;
}

function saveCache() {
  try {
    const out = {};
    const t = Date.now();
    for (const [id, g] of memory) out[id] = { g, t };
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked: the in-memory copy still works */ }
}

export const tagCache = memory;

// tracks: [{ id, name, artists: [{ name }] }]. Resolves once every track has an entry (an empty
// list when Last.fm knows nothing). A failed batch leaves its tracks unknown for next time.
export async function ensureTrackTags(tracks) {
  const wanted = [];
  const seen = new Set();
  for (const t of tracks || []) {
    if (!t?.id || !t.name || !t.artists?.[0]?.name || memory.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    wanted.push({ id: t.id, artist: t.artists[0].name, name: t.name });
  }
  if (wanted.length === 0) return memory;
  const token = useUserStore.getState().token;
  if (!token) return memory;

  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    let response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/tags`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: batch })
      });
    } catch (err) {
      console.warn('[tags] request failed:', err?.message || err);
      break;
    }
    if (!response.ok) {
      console.warn('[tags] endpoint answered', response.status);
      break; // a missing key or a server problem: no point hammering it
    }
    const data = await response.json().catch(() => ({}));
    for (const t of batch) {
      const tags = data.tags?.[t.id];
      if (Array.isArray(tags)) memory.set(t.id, tags);
    }
    saveCache();
  }
  return memory;
}
