import { applyCors } from './_lib/cors.js';
import { resolveUserId, AuthError } from './_lib/auth.js';
import { redis, RedisConfigError } from './_lib/redis.js';
import { K, PARTY_TTL_SECONDS, PartyError, makeCode, parse, readParty, writeParty, publicParty, sendError } from './_lib/party.js';

// The host's door: start a party, or find the one already running. Everything that happens
// inside a party goes through /api/party/<code>.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const hostId = await resolveUserId(req);
    const r = redis();

    if (req.method === 'GET') {
      const code = await r.get(K.hostParty(hostId));
      if (!code) { res.status(200).json({ party: null }); return; }
      try {
        const party = await readParty(String(code));
        res.status(200).json({ party: publicParty(party) });
      } catch (err) {
        if (err instanceof PartyError) { await r.del(K.hostParty(hostId)); res.status(200).json({ party: null }); return; }
        throw err;
      }
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const hostName = String(body.hostName || 'The host').slice(0, 40);
      // One party per host: starting another ends the first
      const existing = await r.get(K.hostParty(hostId));
      if (existing) {
        const old = parse(await r.get(K.party(String(existing))));
        if (old && !old.endedAt) await writeParty({ ...old, endedAt: Date.now() });
      }
      let code = null;
      for (let i = 0; i < 8 && !code; i++) {
        const candidate = makeCode();
        const taken = await r.exists(K.party(candidate));
        if (!taken) code = candidate;
      }
      if (!code) throw new PartyError(503, 'Could not find a free code; try again');
      const party = { code, hostId, hostName, createdAt: Date.now(), backing: body.backing || null, paused: false, cap: body.cap || undefined };
      await writeParty(party);
      await r.set(K.hostParty(hostId), code, { ex: PARTY_TTL_SECONDS });
      if (typeof body.token === 'string' && body.token) {
        const ttl = Math.max(60, Math.min(3600, Math.floor((Number(body.tokenExpiresAt) - Date.now()) / 1000) || 3600));
        await r.set(K.token(code), body.token, { ex: ttl });
      }
      res.status(201).json({ party: publicParty(party) });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendError(res, err)) return;
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[party] failed', err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
