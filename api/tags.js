import { createHash } from 'node:crypto';
import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, RedisConfigError } from './_lib/redis.js';
import { cleanTags } from '../src/utils/lastfmTags.js';

// Last.fm top tags for tracks: the mood words ("sad", "upbeat", "chill") Spotify's artist genres
// lack. POST { tracks: [{ id, artist, name }] }, up to BATCH at a time, answered as
// { tags: { [id]: [{ name, count }] } }. Results are cached for a month; a track with too few
// useful tags falls back to its artist's. Needs LASTFM_API_KEY in the Vercel environment.

const BATCH = 20;
const CONCURRENCY = 5;
const CACHE_SECONDS = 30 * 24 * 60 * 60;
const ENOUGH_TRACK_TAGS = 2;

const cacheKey = (artist, name) => `lastfm:v1:${createHash('sha1').update(`${artist}|${name}`.toLowerCase()).digest('hex')}`;

async function lastfm(method, params, key) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Last.fm ${response.status}`);
  const data = await response.json();
  if (data.error) return []; // 6 = not found; anything else is treated the same for one track
  return data.toptags?.tag || [];
}

async function tagsFor({ artist, name }, key) {
  const tags = cleanTags(await lastfm('track.gettoptags', { artist, track: name }, key), artist);
  if (tags.length >= ENOUGH_TRACK_TAGS) return tags;
  const artistTags = cleanTags(await lastfm('artist.gettoptags', { artist }, key), artist);
  // Artist tags are a weaker stand-in for the song's own; scale them down so a playlist's
  // profile leans on tracks that were actually tagged
  return [...tags, ...artistTags.filter((t) => !tags.some((x) => x.name === t.name)).map((t) => ({ ...t, count: Math.round(t.count * 0.6) }))];
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = process.env.LASTFM_API_KEY;
  if (!key) { res.status(503).json({ error: 'LASTFM_API_KEY is not set in the Vercel project environment.' }); return; }

  try {
    await resolveUserId(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tracks = (Array.isArray(body.tracks) ? body.tracks : [])
      .filter((t) => t && typeof t.id === 'string' && typeof t.artist === 'string' && typeof t.name === 'string')
      .slice(0, BATCH);
    if (tracks.length === 0) { res.status(400).json({ error: 'tracks is required' }); return; }

    const r = redis();
    const keys = tracks.map((t) => cacheKey(t.artist, t.name));
    const cached = await r.mget(...keys);
    const tags = {};
    const misses = [];
    tracks.forEach((t, i) => {
      const hit = cached[i];
      if (hit) tags[t.id] = typeof hit === 'string' ? JSON.parse(hit) : hit;
      else misses.push({ ...t, key: keys[i] });
    });

    const fetched = await mapLimit(misses, CONCURRENCY, async (t) => {
      try { return await tagsFor(t, key); }
      catch (err) { console.warn('[tags] lookup failed', t.artist, t.name, err?.message || err); return null; }
    });
    const writes = [];
    misses.forEach((t, i) => {
      if (fetched[i] === null) return; // left uncached so a hiccup is retried next time
      tags[t.id] = fetched[i];
      writes.push(r.set(t.key, JSON.stringify(fetched[i]), { ex: CACHE_SECONDS }));
    });
    await Promise.all(writes);

    res.status(200).json({ tags });
  } catch (err) {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[tags] failed', err);
    res.status(500).json({ error: 'Could not look up tags' });
  }
}
