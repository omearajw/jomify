import { applyCors } from '../_lib/cors.js';
import { resolveUserId, AuthError } from '../_lib/auth.js';
import { redis, RedisConfigError } from '../_lib/redis.js';
import { encrypt, PUSH_KEYS, PushConfigError } from '../_lib/push.js';

// Body: { subscription, refreshToken? }. The refresh token is the server's own Spotify grant,
// obtained by a second authorization in the browser; it is stored encrypted and only ever used
// by the Sevens check. Sending a subscription without one keeps the previous grant.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const userId = await resolveUserId(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).json({ error: 'A push subscription with endpoint and keys is required' });
      return;
    }
    if (body.refreshToken && typeof body.refreshToken !== 'string') {
      res.status(400).json({ error: 'refreshToken must be a string' });
      return;
    }

    const r = redis();
    await r.hset(PUSH_KEYS.subs(userId), { [subscription.endpoint]: JSON.stringify(subscription) });
    await r.sadd(PUSH_KEYS.users, userId);
    if (body.refreshToken) await r.set(PUSH_KEYS.grant(userId), encrypt(body.refreshToken));

    const hasGrant = Boolean(await r.get(PUSH_KEYS.grant(userId)));
    res.status(200).json({ ok: true, hasGrant });
  } catch (err) {
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError || err instanceof PushConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[push] subscribe failed', err);
    res.status(500).json({ error: 'Could not save the subscription' });
  }
}
