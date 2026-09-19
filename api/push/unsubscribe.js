import { applyCors } from '../_lib/cors.js';
import { resolveUserId, AuthError } from '../_lib/auth.js';
import { redis, RedisConfigError } from '../_lib/redis.js';
import { removeSubscription, PUSH_KEYS } from '../_lib/push.js';

// Body: { endpoint }. Removing the last device also forgets the server's Spotify grant, so
// nothing is kept for a user who has switched notifications off everywhere.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const userId = await resolveUserId(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.endpoint) await removeSubscription(userId, body.endpoint);
    const r = redis();
    if (!(await r.hlen(PUSH_KEYS.subs(userId)))) {
      await r.del(PUSH_KEYS.grant(userId), PUSH_KEYS.state(userId));
      await r.srem(PUSH_KEYS.users, userId);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[push] unsubscribe failed', err);
    res.status(500).json({ error: 'Could not remove the subscription' });
  }
}
