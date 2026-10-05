import { applyCors } from '../_lib/cors.js';
import { resolveUserId, AuthError } from '../_lib/auth.js';
import { redis, RedisConfigError } from '../_lib/redis.js';
import { PUSH_KEYS, PushConfigError } from '../_lib/push.js';

// Whether the server still holds this account's Spotify grant for the Sevens check. The check
// drops a grant Spotify has revoked, and until this existed nobody told the user: the switch
// stayed on while notifications had quietly stopped.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const userId = await resolveUserId(req);
    const r = redis();
    const [hasGrant, devices] = await Promise.all([
      r.get(PUSH_KEYS.grant(userId)),
      r.hlen(PUSH_KEYS.subs(userId))
    ]);
    res.status(200).json({ ok: true, hasGrant: Boolean(hasGrant), devices: devices || 0 });
  } catch (err) {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError || err instanceof PushConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[push] status failed', err);
    res.status(500).json({ error: 'Could not read the notification status' });
  }
}
