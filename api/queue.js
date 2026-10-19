import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, RedisConfigError } from './_lib/redis.js';
import { applyOp, isOp, MAX_BYTES } from './_lib/queue.js';

// One play queue per listener, shared by their devices (src/queue/share.js; the rules are in
// _lib/queue.js). GET ?since=<rev> answers just { rev } when nothing has changed, so a device
// checking costs one small read; POST { op, args, base, force } changes it.
// The revision is a key of its own, and a write lands only if the revision is still the one the
// write was worked out from (one script, so two devices can't both win).

const DAYS_30 = 60 * 60 * 24 * 30;
const keys = (userId) => [`jomify:queue:v1:${userId}:rev`, `jomify:queue:v1:${userId}`];

const CAS = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur ~= tonumber(ARGV[1]) then return -1 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('SET', KEYS[1], cur + 1, 'EX', ARGV[3])
return cur + 1`;

const parse = (raw) => (raw && typeof raw === 'object' ? raw : (() => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })());

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const userId = await resolveUserId(req);
    const r = redis();
    const [revKey, stateKey] = keys(userId);
    if (req.method === 'GET') {
      const rev = Number(await r.get(revKey)) || 0;
      if (req.query?.since !== undefined && Number(req.query.since) === rev) return res.status(200).json({ rev });
      const stored = parse(await r.get(stateKey));
      return res.status(200).json({ rev, q: stored?.q || null, given: stored?.given || null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
    const body = req.body ?? {};
    if (!isOp(body.op)) return res.status(400).json({ error: 'Unknown queue operation' });
    // an edit is worked out from what is stored; if another device wrote in between, again
    for (let attempt = 0; attempt < 3; attempt++) {
      const rev = Number(await r.get(revKey)) || 0;
      const stored = body.op === 'set' ? null : parse(await r.get(stateKey));
      const out = applyOp(stored, rev, body);
      if (out.error) return res.status(400).json({ error: out.error });
      if (out.conflict) {
        const now = parse(await r.get(stateKey));
        return res.status(409).json({ rev, q: now?.q || null, given: now?.given || null });
      }
      const text = JSON.stringify(out.state);
      if (text.length > MAX_BYTES) return res.status(413).json({ error: 'Queue too large to share' });
      const next = Number(await r.eval(CAS, [revKey, stateKey], [String(rev), text, String(DAYS_30)]));
      if (next > 0) return res.status(200).json({ rev: next, q: out.state.q, given: out.state.given });
      if (body.op === 'set' && !body.force) {
        const now = parse(await r.get(stateKey));
        return res.status(409).json({ rev: Number(await r.get(revKey)) || 0, q: now?.q || null, given: now?.given || null });
      }
    }
    return res.status(409).json({ error: 'Busy; try again' });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status || 401).json({ error: err.message });
    if (err instanceof RedisConfigError) return res.status(503).json({ error: 'The shared queue is not set up on this server' });
    console.error('[queue]', err);
    return res.status(500).json({ error: 'Queue request failed' });
  }
}
