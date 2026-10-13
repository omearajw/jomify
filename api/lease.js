import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, RedisConfigError } from './_lib/redis.js';

// A short lease on a job only one of a listener's devices should do at a time: carrying out the
// queue when the music plays on a device that is not a Jomify (an Alexa, the Spotify app). The
// holder renews it; one that goes quiet loses it when it lapses, and whoever asks next takes it.
// POST { job, id } takes or renews; POST { job, id, release: true } gives it up.
const LEASE_SECONDS = 30;
const JOBS = new Set(['queue']);
const key = (userId, job) => `jomify:lease:v1:${userId}:${job}`;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const userId = await resolveUserId(req);
    const { job, id, release } = req.body ?? {};
    if (!JOBS.has(job) || typeof id !== 'string' || !id || id.length > 64) return res.status(400).json({ error: 'Bad lease request' });
    const r = redis();
    const k = key(userId, job);
    const raw = await r.get(k);
    const holder = raw ? (typeof raw === 'object' ? raw : (() => { try { return JSON.parse(raw); } catch { return null; } })()) : null;
    if (release) {
      if (holder?.id === id) await r.del(k);
      return res.status(200).json({ held: false });
    }
    if (holder && holder.id !== id && Date.now() - (holder.at || 0) < LEASE_SECONDS * 1000) return res.status(200).json({ held: false, holder: { id: holder.id, at: holder.at } });
    const me = { id, at: Date.now() };
    await r.set(k, JSON.stringify(me), { ex: LEASE_SECONDS });
    return res.status(200).json({ held: true });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status || 401).json({ error: err.message });
    if (err instanceof RedisConfigError) return res.status(503).json({ error: 'Leases are not set up on this server' });
    console.error('[lease]', err);
    return res.status(500).json({ error: 'Lease failed' });
  }
}
