import { redis } from './redis.js';
import { orderQueue, positionsFor, PER_GUEST_CAP, MAX_QUEUE, RECENT_REPEAT_WINDOW } from '../../src/party/order.js';

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
  snap: (code) => `jomify:party:v1:${code}:snap`,
  rev: (code) => `jomify:party:v1:${code}:rev`,
  search: (code, q) => `jomify:party:v1:${code}:s:${q}`,
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
// Search results are cached a while per party: a room of people searches the same few artists, and
// every miss is a Spotify call on the host's account that could be rate limited.
const SEARCH_CACHE_SECONDS = 900;
export async function searchAsHost(code, query) {
  const key = K.search(code, query.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100));
  const cached = parse(await redis().get(key));
  if (cached) return cached;
  const tracks = await searchSpotify(code, query);
  await redis().set(key, JSON.stringify(tracks), { ex: SEARCH_CACHE_SECONDS });
  return tracks;
}

async function searchSpotify(code, query) {
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
  if ((party.blocked || []).includes(guestId)) throw new PartyError(403, 'The host has turned off your requests');
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
    // The party check's stand-in guest queues a song to prove the path works; it is never played
    const ordered = (await orderedQueue(code)).filter((i) => !String(i.guestId).startsWith('check-'));
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

// One device conducts; the others control or just show the party. Devices rank themselves: one the
// host marked "runs the party" (3), the one the music comes out of (2), an unmarked one (1), one
// marked "remote" (0). A higher rank takes the lock from a lower one; an equal rank leaves it with
// whoever has it; anyone takes a lock that has lapsed, so a remote still steps in if the laptop dies.
export async function claimConductor(code, deviceId, { rank = 1, name = null, awake = null } = {}) {
  const key = K.conductor(code);
  const raw = parse(await redis().get(key));
  const holder = raw && typeof raw === 'object' ? raw : raw ? { id: String(raw), rank: 1 } : null;
  const holderRank = holder ? (holder.rank ?? (holder.playsHere ? 2 : 1)) : -1;
  if (holder && holder.id !== deviceId && holderRank >= rank) return { conductor: false, holder };
  const me = { id: deviceId, rank, name: name ? String(name).slice(0, 60) : null, awake: awake === null ? null : Boolean(awake), at: Date.now() };
  await redis().set(key, JSON.stringify(me), { ex: CONDUCTOR_TTL_SECONDS });
  return { conductor: true, holder: me };
}

export async function endParty(party) {
  const r = redis();
  await writeParty({ ...party, endedAt: Date.now() });
  await r.del(K.snap(party.code));
  await r.del(K.token(party.code));
  await r.del(K.conductor(party.code));
  await r.del(K.hostParty(party.hostId));
  await r.expire(K.party(party.code), 3600); // the code answers "ended" for an hour, then vanishes
}

export const publicParty = (party) => ({
  code: party.code,
  hostName: party.hostName,
  backing: party.backing || null,
  speaker: party.speaker || null,
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

// ---- the snapshot ---------------------------------------------------------------------------
// Everything a guest sees, kept as one stored copy. A dozen phones refresh every few seconds, and
// building the picture from its parts cost a Redis command per song waiting on every refresh,
// which on the free plan would run out partway through one evening. Now a refresh reads the copy
// and the revision counter in one command. Every change bumps the counter and rebuilds the copy;
// a copy built from an older revision (two changes racing) is noticed and rebuilt by the next read.

const NOW_PLAYING_STALE_MS = 120000;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

export async function bumpRev(code) {
  await redis().incr(K.rev(code));
  await redis().expire(K.rev(code), PARTY_TTL_SECONDS);
}

export async function buildSnapshot(code, party) {
  const r = redis();
  // The revision first: a copy labelled with it reflects at least every change up to it
  const rev = Number(await r.get(K.rev(code))) || 0;
  const raw = await readQueue(code);
  const voters = await Promise.all(raw.map((item) => r.smembers(K.votes(code, item.id))));
  const queue = orderQueue(raw.map((item, i) => ({ ...item, votes: (voters[i] || []).length, voters: voters[i] || [] })));
  const [np, fed, history, guests, token, hb, cond] = await Promise.all([
    r.get(K.nowPlaying(code)), r.get(K.fed(code)), readHistory(code, 10), readGuests(code), r.get(K.token(code)), r.get(K.heartbeat(code)), r.get(K.conductor(code))
  ]);
  const snap = {
    rev,
    hostId: party.hostId,
    party: publicParty(party),
    nowPlaying: parse(np),
    upNext: parse(fed)?.item || null,
    queue,
    history,
    guestCount: Object.keys(guests || {}).filter((id) => !id.startsWith('check-')).length,
    blocked: (party.blocked || []).map((id) => ({ id, name: (guests || {})[id] || 'Someone' })),
    hasToken: Boolean(token),
    lastHeartbeatAt: Number(hb) || 0,
    conductor: parse(cond),
    touchedAt: Date.now()
  };
  await r.set(K.snap(code), JSON.stringify(snap), { ex: PARTY_TTL_SECONDS });
  return snap;
}

// The stored copy if it is current, else null (the caller rebuilds)
export async function loadSnapshot(code) {
  const [snapRaw, revRaw] = await redis().mget(K.snap(code), K.rev(code));
  const snap = parse(snapRaw);
  if (!snap || snap.party?.endedAt) return null;
  return snap.rev >= (Number(revRaw) || 0) ? snap : null;
}

// After a change: bump the revision and rebuild
export async function changed(code, party) {
  await bumpRev(code);
  return buildSnapshot(code, party);
}

// The heartbeat changes only what is playing, the token's presence and who conducts: patched into
// the copy rather than rebuilt. A change racing it leaves the copy a revision behind, which the
// next read notices and rebuilds.
export async function patchSnapshot(code, party, patch) {
  const snap = await loadSnapshot(code) || await buildSnapshot(code, party);
  const next = { ...snap, ...patch };
  if (Date.now() - (snap.touchedAt || 0) > TOUCH_EVERY_MS) {
    next.touchedAt = Date.now();
    await Promise.all([redis().expire(K.party(code), PARTY_TTL_SECONDS), redis().expire(K.hostParty(party.hostId), PARTY_TTL_SECONDS)]);
  }
  await redis().set(K.snap(code), JSON.stringify(next), { ex: PARTY_TTL_SECONDS });
  return next;
}

// What one guest (or the host, as 'host') is sent
export function viewFor(snap, guestId) {
  const queue = snap.queue.map((item) => { const out = { ...item }; delete out.voters; return out; });
  const now = Date.now();
  // A snapshot of what was playing goes stale once the host has been quiet for a couple of minutes
  const np = snap.nowPlaying && (!snap.nowPlaying.at || now - snap.nowPlaying.at < NOW_PLAYING_STALE_MS) ? snap.nowPlaying : null;
  return {
    party: snap.party,
    nowPlaying: np,
    upNext: snap.upNext,
    queue,
    history: snap.history,
    guestCount: snap.guestCount,
    mine: guestId ? positionsFor(queue, guestId) : {},
    voted: guestId ? snap.queue.filter((item) => (item.voters || []).includes(guestId)).map((item) => item.id) : [],
    hostAway: !snap.hasToken || !snap.lastHeartbeatAt || now - snap.lastHeartbeatAt > HOST_AWAY_AFTER_MS,
    // Which of the host's devices runs the party, for every device to show; `conductor` itself is
    // the heartbeat's answer to "is it me", so this goes under its own name
    conductorInfo: snap.conductor ? { name: snap.conductor.name || null, at: snap.conductor.at || null, awake: snap.conductor.awake ?? null } : null,
    speakerOk: snap.speakerOk ?? null,
    ...(guestId === 'host' ? { blocked: snap.blocked || [] } : {}),
    serverTime: now
  };
}
