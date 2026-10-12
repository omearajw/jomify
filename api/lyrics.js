import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, RedisConfigError } from './_lib/redis.js';
import { normalizeSpicy } from './_lib/wordLyrics.js';

// Word-timed lyrics from the Spicy Lyrics API, by Spotify track id: GET /api/lyrics?id=<id>.
// The key stays here (SPICY_LYRICS_KEY in the Vercel environment); it allows 60 requests a
// minute, so every answer is cached, a found sync for a month and a miss for three days. Only
// a signed-in Jomify user may ask, so the key cannot be borrowed through this route.

const FOUND_SECONDS = 30 * 24 * 60 * 60;
const MISSING_SECONDS = 3 * 24 * 60 * 60;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const cacheKey = (id) => `lyrics:spicy:v1:${id}`;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = process.env.SPICY_LYRICS_KEY;
  if (!key) { res.status(503).json({ error: 'SPICY_LYRICS_KEY is not set in the Vercel project environment.' }); return; }
  const id = String(req.query?.id || '');
  if (!SPOTIFY_ID.test(id)) { res.status(400).json({ error: 'A Spotify track id is required' }); return; }

  try {
    await resolveUserId(req);
    const r = redis();
    const cached = await r.get(cacheKey(id));
    if (cached) {
      const hit = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (hit.none) { res.status(404).json({ none: true }); return; }
      res.status(200).json(hit);
      return;
    }

    const upstream = await fetch(`https://api.spicylyrics.org/v1/lyrics/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (upstream.status === 404) {
      await r.set(cacheKey(id), JSON.stringify({ none: true }), { ex: MISSING_SECONDS });
      res.status(404).json({ none: true });
      return;
    }
    // Busy, refused or broken: say so without caching, so the next ask tries again
    if (!upstream.ok) { res.status(502).json({ error: `Spicy Lyrics answered ${upstream.status}` }); return; }

    const lyrics = normalizeSpicy(await upstream.json());
    if (!lyrics) {
      await r.set(cacheKey(id), JSON.stringify({ none: true }), { ex: MISSING_SECONDS });
      res.status(404).json({ none: true });
      return;
    }
    await r.set(cacheKey(id), JSON.stringify(lyrics), { ex: FOUND_SECONDS });
    res.status(200).json(lyrics);
  } catch (err) {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[lyrics] failed', err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
