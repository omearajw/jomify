import { redis } from './redis.js';
import { orderQueue, PER_GUEST_CAP, MAX_QUEUE, RECENT_REPEAT_WINDOW } from '../../src/party/order.js';

// A party: a host's playlist playing somewhere, and a code that lets anyone in the room add songs
// from a phone with no Spotify account. Everything lives in Redis under the code and expires on
// its own if the host walks away without ending it.

export const PARTY_TTL_SECONDS = 18 * 3600;
export const CONDUCTOR_TTL_SECONDS = 25;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export class PartyError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const K = {
  party: (code) => `jomify:party:v1:${code}`,
  token: (code) => `jomify:party:v1:${code}:token`,
  queue: (code) => `jomify:party:v1:${code}:q`,
  fed: (code) => `jomify:party:v1:${code}:fed`,
  history: (code) => `jomify:party:v1:${code}:h`,
  nowPlaying: (code) => `jomify:party:v1:${code}:np`,
  guests: (code) => `jomify:party:v1:${code}:guests`,
  conductor: (code) => `jomify:party:v1:${code}:cond`,
  votes: (code, id) => `jomify:party:v1:${code}:v:${id}`,
  guestVotes: (code, guestId) => `jomify:party:v1:${code}:gv:${guestId}`,
  heartbeat: (code) => `jomify:party:v1:${code}:hb`,
  rate: (code, guestId, kind) => `jomify:party:v1:${code}:rl:${kind}:${guestId}`,
  hostParty: (hostId) => `jomify:party:v1:host:${hostId}`
};

export const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const stringify = (v) => JSON.stringify(v);

export function makeCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export const normalizeCode = (raw) => String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

export async function readParty(code) {
  const party = parse(await redis().get(K.party(code)));
  if (!party || party.endedAt) throw new PartyError(404, party ? 'This party has ended' : 'No party with that code');
  return party;
}

export async function writeParty(party) {
  await redis().set(K.party(party.code), stringify(party), { ex: PARTY_TTL_SECONDS });
}

export async function readQueue(code) {
  const raw = await redis().lrange(K.queue(code), 0, -1);
  return (raw || []).map(parse).filter(Boolean);
}

// The queue with the room's votes counted onto each item
export async function readQueueWithVotes(code) {
  const queue = await readQueue(code);
  if (queue.length === 0) return queue;
  const counts = await Promise.all(queue.map((item) => redis().scard(K.votes(code, item.id))));
  return queue.map((item, i) => ({ ...item, votes: Number(counts[i]) || 0 }));
}

// A guest's vote on someone else's request; voting again takes it back
export async function toggleVote(code, guestId, id) {
  const queue = await readQueue(code);
  const item = queue.find((i) => i.id === id);
  if (!item) throw new PartyError(404, 'That song is no longer waiting');
  if (item.guestId === guestId) throw new PartyError(403, "You can't vote for your own request");
  const r = redis();
  const added = await r.sadd(K.votes(code, id), guestId);
  if (added) {
    await r.sadd(K.guestVotes(code, guestId), id);
    await r.expire(K.votes(code, id), PARTY_TTL_SECONDS);
    await r.expire(K.guestVotes(code, guestId), PARTY_TTL_SECONDS);
    return true;
  }
  await r.srem(K.votes(code, id), guestId);
  await r.srem(K.guestVotes(code, guestId), id);
  return false;
}

export async function votedBy(code, guestId) {
  const ids = await redis().smembers(K.guestVotes(code, guestId));
  return ids || [];
}

// The heartbeat says the host is here; a token alone can outlive a dead phone by an hour
export const HOST_AWAY_AFTER_MS = 30000;
export async function noteHeartbeat(code) {
  await redis().set(K.heartbeat(code), String(Date.now()), { ex: PARTY_TTL_SECONDS });
}
export async function hostIsAway(code) {
  const [token, last] = await Promise.all([redis().get(K.token(code)), redis().get(K.heartbeat(code))]);
  if (!token) return true;
  return !last || Date.now() - Number(last) > HOST_AWAY_AFTER_MS;
}

export async function readHistory(code, count = 30) {
  const raw = await redis().lrange(K.history(code), 0, count - 1);
  return (raw || []).map(parse).filter(Boolean);
}

export async function readGuests(code) {
  const all = await redis().hgetall(K.guests(code));
  return all || {};
}

// Everyone's names on the items, and the order they will play in
export async function orderedQueue(code) {
  return orderQueue(await readQueueWithVotes(code));
}

export async function assertNotRateLimited(code, guestId, kind, limitPerMinute) {
  const key = K.rate(code, guestId, kind);
  const n = await redis().incr(key);
  if (n === 1) await redis().expire(key, 60);
  if (n > limitPerMinute) throw new PartyError(429, 'Slow down a little', { retryAfter: 60 });
}

export function slimTrack(t) {
  if (!t?.uri) return null;
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    image: t.album?.images?.slice(-1)[0]?.url || t.album?.images?.[0]?.url || null,
    durationMs: t.duration_ms || 0,
    explicit: Boolean(t.explicit)
  };
}

// Search Spotify as the host. Without a live host token the party can't search, which guests
// see as "the host's phone is away" rather than an error.
export async function searchAsHost(code, query) {
  const token = await redis().get(K.token(code));
  if (!token) throw new PartyError(503, "The host's Jomify is away; searching will come back when it does");
  const url = `https://api.spotify.com/v1/search?type=track&limit=12&market=from_token&q=${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new PartyError(503, 'Could not reach Spotify');
  }
  if (response.status === 401) throw new PartyError(503, "The host's Jomify needs a moment to reconnect");
  if (response.status === 429) throw new PartyError(429, 'Spotify asked for a pause; try again in a moment', { retryAfter: Number(response.headers.get('Retry-After')) || 5 });
  if (!response.ok) throw new PartyError(502, `Spotify answered ${response.status}`);
  const body = await response.json();
  return (body?.tracks?.items || []).map(slimTrack).filter(Boolean);
}

export async function addRequest(code, party, guestId, guestName, track) {
  if (party.paused) throw new PartyError(423, 'The host has paused requests for now');
  if (!track?.uri || !/^spotify:track:[A-Za-z0-9]+$/.test(track.uri)) throw new PartyError(400, 'That is not a Spotify song');
  const [queue, recent, fed] = await Promise.all([readQueue(code), readHistory(code, RECENT_REPEAT_WINDOW), parse(await redis().get(K.fed(code)))]);
  if (queue.length >= MAX_QUEUE) throw new PartyError(429, 'The queue is full for now');
  const cap = party.cap || PER_GUEST_CAP;
  if (guestId !== 'host' && queue.filter((i) => i.guestId === guestId).length >= cap) throw new PartyError(429, `You already have ${cap} songs waiting; let a few play first`);
  if (queue.some((i) => i.uri === track.uri) || fed?.item?.uri === track.uri) throw new PartyError(409, 'That song is already in the queue');
  if (recent.some((i) => i.uri === track.uri)) throw new PartyError(409, 'That one played recently; pick something else');
  const item = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    uri: track.uri,
    name: String(track.name || '').slice(0, 200),
    artists: String(track.artists || '').slice(0, 200),
    image: typeof track.image === 'string' ? track.image.slice(0, 500) : null,
    durationMs: Number(track.durationMs) || 0,
    guestId,
    guestName: String(guestName || 'Someone').slice(0, 40),
    at: Date.now()
  };
  await redis().rpush(K.queue(code), stringify(item));
  await redis().expire(K.queue(code), PARTY_TTL_SECONDS);
  return item;
}

export async function removeItem(code, id) {
  const queue = await readQueue(code);
  const item = queue.find((i) => i.id === id);
  if (!item) return null;
  const removed = await redis().lrem(K.queue(code), 1, stringify(item));
  return removed ? item : null;
}

export async function pinItem(code, id, pinned) {
  const queue = await readQueue(code);
  const item = queue.find((i) => i.id === id);
  if (!item) return null;
  const next = { ...item, pinnedAt: pinned ? Date.now() : undefined };
  if (!pinned) delete next.pinnedAt;
  // Replace in place: remove the old value and append the new one; its `at` keeps its turn
  const removed = await redis().lrem(K.queue(code), 1, stringify(item));
  if (!removed) return null;
  await redis().rpush(K.queue(code), stringify(next));
  return next;
}

// The conductor asks for the next song to hand to Spotify. The pick is made now, with every
// request so far known, and parked in `fed` until it is heard playing.
export async function takeNext(code) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ordered = await orderedQueue(code);
    const item = ordered[0];
    if (!item) return null;
    const stored = { ...item };
    delete stored.votes; // votes are counted on read, never stored on the item
    const removed = await redis().lrem(K.queue(code), 1, stringify(stored));
    if (!removed) continue; // withdrawn between the read and the take; pick again
    const fed = { item, at: Date.now() };
    await redis().set(K.fed(code), stringify(fed), { ex: PARTY_TTL_SECONDS });
    return item;
  }
  return null;
}

export async function markPlayed(code, item) {
  await redis().del(K.fed(code));
  await redis().lpush(K.history(code), stringify({ ...item, playedAt: Date.now() }));
  await redis().ltrim(K.history(code), 0, 99);
  await redis().expire(K.history(code), PARTY_TTL_SECONDS);
}

// A fed song Spotify never started goes back to the front of the queue
export async function returnFed(code) {
  const fed = parse(await redis().get(K.fed(code)));
  if (!fed?.item) return null;
  await redis().del(K.fed(code));
  await redis().rpush(K.queue(code), stringify({ ...fed.item, pinnedAt: fed.item.pinnedAt || Date.now() }));
  return fed.item;
}

// One device plays conductor; the others just show the party. The device the music actually
// comes out of wins the lock from one that is only controlling, since it is the one that will
// stay on all night; otherwise whoever renews the lock keeps it.
export async function claimConductor(code, deviceId, { playsHere = false } = {}) {
  const key = K.conductor(code);
  const raw = await redis().get(key);
  const current = raw ? (typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : parse(raw)) : null;
  const holder = current && typeof current === 'object' ? current : current ? { id: String(current), playsHere: false } : null;
  if (holder && holder.id !== deviceId && (holder.playsHere || !playsHere)) return false;
  await redis().set(key, JSON.stringify({ id: deviceId, playsHere: Boolean(playsHere) }), { ex: CONDUCTOR_TTL_SECONDS });
  return true;
}

export async function endParty(party) {
  const r = redis();
  await writeParty({ ...party, endedAt: Date.now() });
  await r.del(K.token(party.code));
  await r.del(K.conductor(party.code));
  await r.del(K.hostParty(party.hostId));
  await r.expire(K.party(party.code), 3600); // the code answers "ended" for an hour, then vanishes
}

export const publicParty = (party) => ({
  code: party.code,
  hostName: party.hostName,
  backing: party.backing || null,
  paused: Boolean(party.paused),
  cap: party.cap || PER_GUEST_CAP,
  createdAt: party.createdAt,
  endedAt: party.endedAt || null
});

export function sendError(res, err) {
  if (err instanceof PartyError) {
    if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
    res.status(err.status).json({ error: err.message, ...err.extra });
    return true;
  }
  return false;
}
