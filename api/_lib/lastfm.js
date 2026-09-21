import { cleanTags } from '../../src/utils/lastfmTags.js';

// Last.fm lookups, kept apart from the request handler so they can be timed and tested alone.

export const ENOUGH_TRACK_TAGS = 2;
const TIMEOUT_MS = 4000;

export async function lastfm(method, params, key) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Last.fm ${response.status}`);
  const data = await response.json();
  if (data.error) return []; // 6 = not found; anything else is treated the same for one track
  return data.toptags?.tag || [];
}

export async function tagsFor({ artist, name }, key) {
  const tags = cleanTags(await lastfm('track.gettoptags', { artist, track: name }, key), artist);
  if (tags.length >= ENOUGH_TRACK_TAGS) return tags;
  const artistTags = cleanTags(await lastfm('artist.gettoptags', { artist }, key), artist);
  // Artist tags are a weaker stand-in for the song's own; scale them down so a playlist's
  // profile leans on tracks that were actually tagged
  return [...tags, ...artistTags.filter((t) => !tags.some((x) => x.name === t.name)).map((t) => ({ ...t, count: Math.round(t.count * 0.6) }))];
}

export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}
