import { fetchRecentlyPlayed } from './spotify/api';

// Spotify's recently-played feed, fetched once and shared: Home's "Jump back in" and the
// library's "recently played" order both read it. Keyed by account, not token.
const FRESH_MS = 60 * 1000;
let cache = null; // { userId, items, at }
let inFlight = null;

export async function getRecentlyPlayed(token, userId) {
  if (cache && cache.userId === userId && Date.now() - cache.at < FRESH_MS) return cache.items;
  if (inFlight) return inFlight;
  inFlight = fetchRecentlyPlayed(token, 50)
    .then((items) => { cache = { userId, items, at: Date.now() }; return items; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

// The most recent play of each context (playlist, album, artist), newest first: a Map of
// context uri -> played_at time
export function lastPlayedByContext(items) {
  const out = new Map();
  for (const item of items || []) {
    const uri = item?.context?.uri;
    if (!uri || out.has(uri)) continue;
    out.set(uri, new Date(item.played_at).getTime());
  }
  return out;
}
