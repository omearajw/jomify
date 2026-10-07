import { applyCors } from '../_lib/cors.js';
import { resolveUserId, AuthError } from '../_lib/auth.js';
import { redis, RedisConfigError } from '../_lib/redis.js';
import {
  K, PARTY_TTL_SECONDS, PartyError, parse, normalizeCode, readParty, writeParty, readQueue, readHistory, readGuests,
  orderedQueue, assertNotRateLimited, searchAsHost, addRequest, removeItem, pinItem, takeNext, markPlayed, returnFed,
  claimConductor, endParty, publicParty, sendError, toggleVote, votedBy, noteHeartbeat, hostIsAway
} from '../_lib/party.js';
import { positionsFor } from '../../src/party/order.js';

// Inside a party. Guests arrive with the code and a self-chosen id; the host arrives with a
// Spotify token and must be the party's host for the ops marked host-only.

const GUEST_ID = /^[A-Za-z0-9_-]{6,64}$/;

async function readState(code, party, guestId) {
  const r = redis();
  const [queue, np, fed, history, guests, hostAway, voted] = await Promise.all([
    orderedQueue(code), parse(await r.get(K.nowPlaying(code))), parse(await r.get(K.fed(code))), readHistory(code, 10), readGuests(code),
    hostIsAway(code), guestId ? votedBy(code, guestId) : []
  ]);
  return {
    party: publicParty(party),
    nowPlaying: np,
    upNext: fed?.item || null,
    queue,
    history,
    guestCount: Object.keys(guests).length,
    mine: guestId ? positionsFor(queue, guestId) : {},
    voted,
    hostAway,
    serverTime: Date.now()
  };
}

async function requireHost(req, party) {
  const userId = await resolveUserId(req);
  if (userId !== party.hostId) throw new PartyError(403, 'Only the host can do that');
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const code = normalizeCode(req.query?.code);
  try {
    if (!code || code.length < 4) throw new PartyError(404, 'No party with that code');
    const party = await readParty(code);
    const r = redis();

    if (req.method === 'GET') {
      const guestId = GUEST_ID.test(req.query?.guest || '') ? req.query.guest : null;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(await readState(code, party, guestId));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const op = String(body.op || '');
    const guestId = GUEST_ID.test(body.guestId || '') ? body.guestId : null;

    switch (op) {
      // ---- guests ----
      case 'join': {
        if (!guestId) throw new PartyError(400, 'A guest id is required');
        const name = String(body.name || '').trim().slice(0, 40) || 'Someone';
        await r.hset(K.guests(code), { [guestId]: name });
        await r.expire(K.guests(code), PARTY_TTL_SECONDS);
        res.status(200).json(await readState(code, party, guestId));
        return;
      }
      case 'search': {
        if (!guestId) throw new PartyError(400, 'A guest id is required');
        const q = String(body.q || '').trim().slice(0, 100);
        if (!q) { res.status(200).json({ tracks: [] }); return; }
        await assertNotRateLimited(code, guestId, 'search', 30);
        res.status(200).json({ tracks: await searchAsHost(code, q) });
        return;
      }
      case 'request': {
        if (!guestId) throw new PartyError(400, 'A guest id is required');
        await assertNotRateLimited(code, guestId, 'request', 8);
        const guests = await readGuests(code);
        const item = await addRequest(code, party, guestId, guests[guestId] || body.name, body.track);
        const state = await readState(code, party, guestId);
        res.status(201).json({ item, position: state.mine[item.id] || null, ...state });
        return;
      }
      case 'vote': {
        if (!guestId) throw new PartyError(400, 'A guest id is required');
        await assertNotRateLimited(code, guestId, 'vote', 30);
        const cast = await toggleVote(code, guestId, String(body.id || ''));
        res.status(200).json({ cast, ...(await readState(code, party, guestId)) });
        return;
      }
      case 'withdraw': {
        if (!guestId) throw new PartyError(400, 'A guest id is required');
        const queue = await readQueue(code);
        const target = queue.find((i) => i.id === body.id);
        if (target && target.guestId !== guestId) throw new PartyError(403, 'That is not your request');
        const removed = target ? await removeItem(code, target.id) : null;
        res.status(200).json({ removed: Boolean(removed), ...(await readState(code, party, guestId)) });
        return;
      }
      // ---- host ----
      case 'heartbeat': {
        await requireHost(req, party);
        if (typeof body.token === 'string' && body.token) {
          const ttl = Math.max(60, Math.min(3600, Math.floor((Number(body.tokenExpiresAt) - Date.now()) / 1000) || 3600));
          await r.set(K.token(code), body.token, { ex: ttl });
        }
        if (body.nowPlaying !== undefined) await r.set(K.nowPlaying(code), JSON.stringify(body.nowPlaying), { ex: 120 });
        const conductor = body.deviceId ? await claimConductor(code, String(body.deviceId).slice(0, 64), { playsHere: Boolean(body.playsHere) }) : false;
        await noteHeartbeat(code);
        await r.expire(K.party(code), PARTY_TTL_SECONDS);
        await r.expire(K.hostParty(party.hostId), PARTY_TTL_SECONDS);
        res.status(200).json({ conductor, ...(await readState(code, party, 'host')) });
        return;
      }
      case 'add': {
        // The host's own pick, under the same fairness as everyone else's but with no cap
        await requireHost(req, party);
        const item = await addRequest(code, party, 'host', party.hostName, body.track);
        if (body.playNext) await pinItem(code, item.id, true);
        res.status(201).json({ item, ...(await readState(code, party, 'host')) });
        return;
      }
      case 'remove': {
        await requireHost(req, party);
        const removed = await removeItem(code, String(body.id || ''));
        res.status(200).json({ removed: Boolean(removed), ...(await readState(code, party, 'host')) });
        return;
      }
      case 'pin': {
        await requireHost(req, party);
        const item = await pinItem(code, String(body.id || ''), body.pinned !== false);
        res.status(200).json({ item, ...(await readState(code, party, 'host')) });
        return;
      }
      case 'settings': {
        await requireHost(req, party);
        const next = { ...party };
        if (body.paused !== undefined) next.paused = Boolean(body.paused);
        if (body.backing !== undefined) next.backing = body.backing || null;
        if (body.cap !== undefined) next.cap = Math.max(1, Math.min(50, Number(body.cap) || 10));
        if (typeof body.hostName === 'string') next.hostName = body.hostName.slice(0, 40) || party.hostName;
        await writeParty(next);
        res.status(200).json(await readState(code, next, 'host'));
        return;
      }
      case 'next': {
        // Conductor: hand over the next song. Nothing waiting means the backing playlist carries on.
        await requireHost(req, party);
        const item = await takeNext(code);
        res.status(200).json({ item });
        return;
      }
      case 'played': {
        await requireHost(req, party);
        const fed = parse(await r.get(K.fed(code)));
        if (fed?.item && (!body.id || fed.item.id === body.id)) await markPlayed(code, fed.item);
        res.status(200).json(await readState(code, party, 'host'));
        return;
      }
      case 'unfed': {
        await requireHost(req, party);
        const item = await returnFed(code);
        res.status(200).json({ item, ...(await readState(code, party, 'host')) });
        return;
      }
      case 'end': {
        await requireHost(req, party);
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
