import { applyCors } from '../_lib/cors.js';
import { resolveUserId, AuthError } from '../_lib/auth.js';
import { redis, RedisConfigError } from '../_lib/redis.js';
import {
  K, PARTY_TTL_SECONDS, PartyError, parse, normalizeCode, readParty, writeParty, readQueue, readGuests,
  assertNotRateLimited, searchAsHost, addRequest, removeItem, pinItem, takeNext, markPlayed, returnFed,
  claimConductor, endParty, sendError, toggleVote, noteHeartbeat,
  loadSnapshot, buildSnapshot, changed, patchSnapshot, viewFor
} from '../_lib/party.js';

// Inside a party. Guests arrive with the code and a self-chosen id; the host arrives with a
// Spotify token and must be the party's host for the ops marked host-only. Every answer is drawn
// from the party's stored snapshot (see _lib/party.js), which every change rebuilds.

const GUEST_ID = /^[A-Za-z0-9_-]{6,64}$/;

async function requireHost(req, hostId) {
  const userId = await resolveUserId(req);
  if (userId !== hostId) throw new PartyError(403, 'Only the host can do that');
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const code = normalizeCode(req.query?.code);
  try {
    if (!code || code.length < 4) throw new PartyError(404, 'No party with that code');
    const r = redis();

    if (req.method === 'GET') {
      // One command when the snapshot is current, which is nearly always
      const guestId = GUEST_ID.test(req.query?.guest || '') ? req.query.guest : null;
      let snap = await loadSnapshot(code);
      if (!snap) snap = await buildSnapshot(code, await readParty(code));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(viewFor(snap, guestId));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const op = String(body.op || '');
    const guestId = GUEST_ID.test(body.guestId || '') ? body.guestId : null;
    const needGuest = () => { if (!guestId) throw new PartyError(400, 'A guest id is required'); };

    // The heartbeat comes every few seconds from each of the host's devices: it patches the
    // snapshot instead of reading the party and rebuilding everything
    if (op === 'heartbeat') {
      const snap = await loadSnapshot(code);
      const party = snap ? { code, hostId: snap.hostId, ...snap.party } : await readParty(code);
      await requireHost(req, party.hostId);
      const writes = [noteHeartbeat(code)];
      if (typeof body.token === 'string' && body.token) {
        const ttl = Math.max(60, Math.min(3600, Math.floor((Number(body.tokenExpiresAt) - Date.now()) / 1000) || 3600));
        writes.push(r.set(K.token(code), body.token, { ex: ttl }));
      }
      if (body.nowPlaying !== undefined) writes.push(r.set(K.nowPlaying(code), JSON.stringify(body.nowPlaying), { ex: 120 }));
      await Promise.all(writes);
      const role = String(body.role || 'auto');
      const rank = role === 'conductor' ? 3 : role === 'remote' ? 0 : body.playsHere ? 2 : 1;
      const claim = body.deviceId ? await claimConductor(code, String(body.deviceId).slice(0, 64), { rank, name: body.deviceName, awake: body.awake ?? null }) : { conductor: false, holder: snap?.conductor || null };
      const patch = { lastHeartbeatAt: Date.now(), conductor: claim.holder };
      if (body.token) patch.hasToken = true;
      if (body.nowPlaying !== undefined) patch.nowPlaying = body.nowPlaying;
      // Only the conductor speaks for the speaker; a controller's view of it is second-hand
      if (claim.conductor && body.speakerOk !== undefined) patch.speakerOk = body.speakerOk;
      const next = await patchSnapshot(code, party, patch);
      res.status(200).json({ ...viewFor(next, 'host'), conductor: claim.conductor });
      return;
    }

    const party = await readParty(code);
    const answer = async (status, extra = {}, viewer = guestId) => {
      const snap = await changed(code, party);
      res.status(status).json({ ...extra, ...viewFor(snap, viewer) });
    };

    switch (op) {
      // ---- guests ----
      case 'join': {
        needGuest();
        const name = String(body.name || '').trim().slice(0, 40) || 'Someone';
        await r.hset(K.guests(code), { [guestId]: name });
        await r.expire(K.guests(code), PARTY_TTL_SECONDS);
        await answer(200);
        return;
      }
      case 'search': {
        needGuest();
        const q = String(body.q || '').trim().slice(0, 100);
        if (!q) { res.status(200).json({ tracks: [] }); return; }
        await assertNotRateLimited(code, guestId, 'search', 30);
        res.status(200).json({ tracks: await searchAsHost(code, q) });
        return;
      }
      case 'request': {
        needGuest();
        await assertNotRateLimited(code, guestId, 'request', 8);
        const guests = await readGuests(code);
        const item = await addRequest(code, party, guestId, guests[guestId] || body.name, body.track);
        const snap = await changed(code, party);
        const view = viewFor(snap, guestId);
        res.status(201).json({ item, position: view.mine[item.id] || null, ...view });
        return;
      }
      case 'vote': {
        needGuest();
        await assertNotRateLimited(code, guestId, 'vote', 30);
        const cast = await toggleVote(code, guestId, String(body.id || ''));
        await answer(200, { cast });
        return;
      }
      case 'withdraw': {
        needGuest();
        const queue = await readQueue(code);
        const target = queue.find((i) => i.id === body.id);
        if (target && target.guestId !== guestId) throw new PartyError(403, 'That is not your request');
        const removed = target ? await removeItem(code, target.id) : null;
        await answer(200, { removed: Boolean(removed) });
        return;
      }
      // ---- host ----
      case 'add': {
        await requireHost(req, party.hostId);
        const item = await addRequest(code, party, 'host', party.hostName, body.track);
        if (body.playNext) await pinItem(code, item.id, true);
        await answer(201, { item }, 'host');
        return;
      }
      case 'remove': {
        await requireHost(req, party.hostId);
        const removed = await removeItem(code, String(body.id || ''));
        await answer(200, { removed: Boolean(removed) }, 'host');
        return;
      }
      case 'pin': {
        await requireHost(req, party.hostId);
        const item = await pinItem(code, String(body.id || ''), body.pinned !== false);
        await answer(200, { item }, 'host');
        return;
      }
      case 'block': {
        // A guest misbehaving: their songs come out and further requests are refused
        await requireHost(req, party.hostId);
        const target = String(body.guestId || '');
        if (!GUEST_ID.test(target) || target === 'host') throw new PartyError(400, 'Which guest?');
        const queue = await readQueue(code);
        for (const item of queue.filter((i) => i.guestId === target)) await removeItem(code, item.id);
        Object.assign(party, { blocked: [...new Set([...(party.blocked || []), target])] });
        await writeParty(party);
        await answer(200, {}, 'host');
        return;
      }
      case 'unblock': {
        await requireHost(req, party.hostId);
        Object.assign(party, { blocked: (party.blocked || []).filter((id) => id !== body.guestId) });
        await writeParty(party);
        await answer(200, {}, 'host');
        return;
      }
      case 'settings': {
        await requireHost(req, party.hostId);
        if (body.paused !== undefined) party.paused = Boolean(body.paused);
        if (body.backing !== undefined) party.backing = body.backing || null;
        if (body.speaker !== undefined) party.speaker = body.speaker && body.speaker.id ? { id: String(body.speaker.id).slice(0, 80), name: String(body.speaker.name || '').slice(0, 80) } : null;
        if (body.cap !== undefined) party.cap = Math.max(1, Math.min(50, Number(body.cap) || 10));
        if (typeof body.hostName === 'string') party.hostName = body.hostName.slice(0, 40) || party.hostName;
        await writeParty(party);
        await answer(200, {}, 'host');
        return;
      }
      case 'next': {
        // Conductor: hand over the next song. Nothing waiting means the backing playlist carries on.
        await requireHost(req, party.hostId);
        const item = await takeNext(code);
        if (item) await changed(code, party);
        res.status(200).json({ item });
        return;
      }
      case 'played': {
        await requireHost(req, party.hostId);
        const fed = parse(await r.get(K.fed(code)));
        if (fed?.item && (!body.id || fed.item.id === body.id)) await markPlayed(code, fed.item);
        await answer(200, {}, 'host');
        return;
      }
      case 'unfed': {
        await requireHost(req, party.hostId);
        const item = await returnFed(code);
        await answer(200, { item }, 'host');
        return;
      }
      case 'end': {
        await requireHost(req, party.hostId);
        await endParty(party);
        res.status(200).json({ ended: true });
        return;
      }
      default:
        throw new PartyError(400, `Unknown op "${op}"`);
    }
  } catch (err) {
    if (sendError(res, err)) return;
    if (err instanceof AuthError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof RedisConfigError) { res.status(503).json({ error: err.message }); return; }
    console.error('[party] failed', err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
