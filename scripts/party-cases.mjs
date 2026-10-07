// Party mode: the ordering rule and the two API handlers end to end, against an in-memory
// stand-in for Upstash and a fake Spotify. Run with: node scripts/party-cases.mjs

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);

// ---- ordering ---------------------------------------------------------------------------------
const { orderQueue, positionsFor } = await import('../src/party/order.js');
section('ordering');
const it = (id, guestId, at, extra = {}) => ({ id, uri: `spotify:track:${id}`, guestId, at, ...extra });
const names = (list) => list.map((i) => i.id).join(',');
check('a newcomer jumps a pile', names(orderQueue([it('a1', 'A', 1), it('a2', 'A', 2), it('a3', 'A', 3), it('b1', 'B', 4)])) === 'a1,b1,a2,a3');
check('round robin across three guests', names(orderQueue([it('a1', 'A', 1), it('a2', 'A', 2), it('b1', 'B', 3), it('c1', 'C', 4), it('b2', 'B', 5), it('c2', 'C', 6), it('a3', 'A', 7)])) === 'a1,b1,c1,a2,b2,c2,a3');
check('within a round the earlier request wins', names(orderQueue([it('b1', 'B', 1), it('a1', 'A', 2)])) === 'b1,a1');
check('pins go first, in pin order', names(orderQueue([it('a1', 'A', 1), it('a2', 'A', 2, { pinnedAt: 20 }), it('b1', 'B', 3, { pinnedAt: 10 })])) === 'b1,a2,a1');
check('positions are 1-based and per guest', JSON.stringify(positionsFor(orderQueue([it('a1', 'A', 1), it('b1', 'B', 2), it('a2', 'A', 3)]), 'A')) === '{"a1":1,"a2":3}');
check('empty queue', orderQueue([]).length === 0);
check('rounds follow request time, not list position', names(orderQueue([it('a2', 'A', 2), it('a1', 'A', 1), it('b1', 'B', 3)])) === 'a1,b1,a2');
check('votes reorder within a round only', names(orderQueue([it('a1', 'A', 1), it('b1', 'B', 2, { votes: 3 }), it('a2', 'A', 3, { votes: 9 })])) === 'b1,a1,a2');

// ---- fake redis ---------------------------------------------------------------------------------
// The Upstash client turns every call into an HTTP command (often batched into a pipeline), so
// the stand-in sits at that layer and interprets the commands the party code uses.
const store = new Map();
const lists = new Map();
const hashes = new Map();
const sets = new Map();
function exec([cmd, ...a]) {
  const c = String(cmd).toUpperCase();
  const k = a[0];
  switch (c) {
    case 'GET': return store.has(k) ? store.get(k) : null;
    case 'SET': {
      const flags = a.slice(2).map((x) => String(x).toUpperCase());
      if (flags.includes('NX') && store.has(k)) return null;
      if (flags.includes('XX') && !store.has(k)) return null;
      store.set(k, a[1]); return 'OK';
    }
    case 'DEL': return [store.delete(k), lists.delete(k), hashes.delete(k)].some(Boolean) ? 1 : 0;
    case 'EXISTS': return store.has(k) || lists.has(k) || hashes.has(k) ? 1 : 0;
    case 'EXPIRE': return 1;
    case 'INCR': { const n = (Number(store.get(k)) || 0) + 1; store.set(k, String(n)); return n; }
    case 'RPUSH': { const l = lists.get(k) || []; l.push(...a.slice(1)); lists.set(k, l); return l.length; }
    case 'LPUSH': { const l = lists.get(k) || []; l.unshift(...a.slice(1).reverse()); lists.set(k, l); return l.length; }
    case 'LRANGE': { const l = lists.get(k) || []; const b = Number(a[2]); return l.slice(Number(a[1]), b === -1 ? undefined : b + 1); }
    case 'LREM': { const l = lists.get(k) || []; const i = l.indexOf(a[2]); if (i === -1) return 0; l.splice(i, 1); return 1; }
    case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
    case 'HSET': { const h = hashes.get(k) || {}; for (let i = 1; i < a.length; i += 2) h[a[i]] = a[i + 1]; hashes.set(k, h); return 1; }
    case 'HGETALL': { const h = hashes.get(k); return h ? Object.entries(h).flat() : []; }
    case 'SADD': { const set = sets.get(k) || new Set(); const before = set.size; a.slice(1).forEach((v) => set.add(v)); sets.set(k, set); return set.size - before; }
    case 'SREM': { const set = sets.get(k); if (!set) return 0; const before = set.size; a.slice(1).forEach((v) => set.delete(v)); return before - set.size; }
    case 'SCARD': return (sets.get(k) || new Set()).size;
    case 'SMEMBERS': return [...(sets.get(k) || [])];
    default: throw new Error('fake redis: unsupported ' + c);
  }
}
process.env.UPSTASH_REDIS_REST_URL = 'https://fake'; process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
const { HttpClient } = await import('../node_modules/@upstash/redis/chunk-2JFYL2VL.mjs');
HttpClient.prototype.request = async (req) => {
  const pipeline = (req.path || []).includes('pipeline') || (req.path || []).includes('multi-exec');
  if (pipeline) return req.body.map((cmd) => ({ result: exec(cmd) }));
  return { result: exec(req.body) };
};

// ---- fake Spotify -------------------------------------------------------------------------------
const TOKENS = { 'host-token': 'jack', 'other-token': 'sam' };
let searchCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const auth = (init.headers?.Authorization || '').replace('Bearer ', '');
  if (url.includes('/v1/me')) {
    if (!TOKENS[auth]) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ id: TOKENS[auth] }), { status: 200 });
  }
  if (url.includes('/v1/search')) {
    searchCalls++;
    if (auth !== 'host-token') return new Response('{}', { status: 401 });
    const q = decodeURIComponent(url.split('q=')[1]);
    return new Response(JSON.stringify({ tracks: { items: [{ uri: 'spotify:track:s1', id: 's1', name: `Song about ${q}`, artists: [{ name: 'Band' }], album: { images: [{ url: 'big' }, { url: 'small' }] }, duration_ms: 1000 }] } }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

// ---- handlers ----------------------------------------------------------------------------------
const hostHandler = (await import('../api/party.js')).default;
const codeHandler = (await import('../api/party/[code].js')).default;
function call(handler, { method = 'GET', query = {}, body, token, origin = 'https://jomify.vercel.app' } = {}) {
  return new Promise((resolve) => {
    const headers = { origin };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = { status(s) { this.statusCode = s; return this; }, json(b) { resolve({ status: this.statusCode, body: b, headers: this.h }); }, setHeader(k, v) { (this.h = this.h || {})[k] = v; }, end() { resolve({ status: this.statusCode, body: null }); } };
    handler({ method, query, body, headers }, res);
  });
}
const host = (method, body, extra = {}) => call(hostHandler, { method, body, token: 'host-token', ...extra });
const inParty = (code, body, token) => call(codeHandler, { method: 'POST', query: { code }, body, token });
const state = (code, guest) => call(codeHandler, { method: 'GET', query: { code, guest } });
const track = (id, name = `Track ${id}`) => ({ uri: `spotify:track:${id}`, name, artists: 'Band', image: null, durationMs: 180000 });

section('host door');
check('no party yet', (await host('GET')).body.party === null);
check('a guest token cannot start one', (await call(hostHandler, { method: 'POST', body: {}, token: 'nope' })).status === 401);
const created = await host('POST', { hostName: 'Jack', backing: { uri: 'spotify:playlist:p1', name: 'Bangers' }, token: 'host-token', tokenExpiresAt: Date.now() + 3600e3 });
const code = created.body.party?.code;
check('party created with a 4-char code', created.status === 201 && /^[A-Z2-9]{4}$/.test(code || ''));
check('host finds it again', (await host('GET')).body.party?.code === code);
check('party key is not a VITE_ var and holds no token', !JSON.stringify((await state(code)).body).includes('host-token'));

section('guests');
const g1 = 'guest-aaaaaa', g2 = 'guest-bbbbbb';
check('unknown code is 404', (await state('ZZZZ')).status === 404);
check('join records a name', (await inParty(code, { op: 'join', guestId: g1, name: 'Amy' })).body.guestCount === 1);
await inParty(code, { op: 'join', guestId: g2, name: 'Ben' });
const s1 = await inParty(code, { op: 'search', guestId: g1, q: 'tame' });
check('search runs with the host token', s1.status === 200 && s1.body.tracks[0].name === 'Song about tame' && s1.body.tracks[0].image === 'small');
check('bad guest id refused', (await inParty(code, { op: 'search', guestId: 'x', q: 'tame' })).status === 400);
const r1 = await inParty(code, { op: 'request', guestId: g1, track: track('a1') });
check('request lands at position 1', r1.status === 201 && r1.body.position === 1 && r1.body.item.guestName === 'Amy');
await inParty(code, { op: 'request', guestId: g1, track: track('a2') });
await inParty(code, { op: 'request', guestId: g1, track: track('a3') });
const r2 = await inParty(code, { op: 'request', guestId: g2, track: track('b1') });
check('a second guest jumps the pile to position 2', r2.body.position === 2);
check('duplicate song refused', (await inParty(code, { op: 'request', guestId: g2, track: track('a1') })).status === 409);
check('not a track uri refused', (await inParty(code, { op: 'request', guestId: g2, track: { uri: 'spotify:album:x', name: 'x' } })).status === 400);
check('queue order visible to all', (await state(code)).body.queue.map((i) => i.uri.split(':')[2]).join(',') === 'a1,b1,a2,a3');
check('my positions', JSON.stringify((await state(code, g1)).body.mine) === JSON.stringify({ [r1.body.item.id]: 1, [(await state(code)).body.queue[2].id]: 3, [(await state(code)).body.queue[3].id]: 4 }));
check("can't withdraw someone else's", (await inParty(code, { op: 'withdraw', guestId: g2, id: r1.body.item.id })).status === 403);
check('withdraw own', (await inParty(code, { op: 'withdraw', guestId: g2, id: r2.body.item.id })).body.removed === true);
await inParty(code, { op: 'request', guestId: g2, track: track('b1') });
for (let i = 0; i < 8; i++) await inParty(code, { op: 'request', guestId: g1, track: track(`x${i}`) });
check('per-guest cap holds', (await inParty(code, { op: 'request', guestId: g1, track: track('too-many') })).status === 429);
check('request rate limit', (await inParty(code, { op: 'request', guestId: g1, track: track('rl') })).status === 429);

section('votes');
const g3 = 'guest-cccccc';
await inParty(code, { op: 'join', guestId: g3, name: 'Cal' });
const own = (await state(code, g1)).body.queue.find((i) => i.guestId === g1);
check("can't vote for your own", (await inParty(code, { op: 'vote', guestId: g1, id: own.id })).status === 403);
// b1 (Ben's first) sits behind a1 (Amy's first) in round one; Cal's vote lifts it
const theirs = (await state(code)).body.queue.find((i) => i.uri === 'spotify:track:b1');
const idx = async (uri) => (await state(code)).body.queue.findIndex((i) => i.uri === uri);
check('before the vote Amy is first', (await idx('spotify:track:a1')) < (await idx('spotify:track:b1')));
const v1 = await inParty(code, { op: 'vote', guestId: g3, id: theirs.id });
check('a vote counts and is remembered for the voter', v1.body.cast === true && v1.body.queue.find((i) => i.id === theirs.id).votes === 1 && (await state(code, g3)).body.voted.includes(theirs.id));
check('votes reorder within the round', (await idx('spotify:track:b1')) < (await idx('spotify:track:a1')));
check('but never across rounds', (await idx('spotify:track:a1')) < (await idx('spotify:track:a2')) && (await idx('spotify:track:b1')) < (await idx('spotify:track:a2')));
check('voting again takes it back', (await inParty(code, { op: 'vote', guestId: g3, id: theirs.id })).body.cast === false && (await idx('spotify:track:a1')) < (await idx('spotify:track:b1')));
check('unknown song', (await inParty(code, { op: 'vote', guestId: g3, id: 'nope' })).status === 404);

section('host controls');
check('guest cannot run host ops', (await inParty(code, { op: 'next', guestId: g1 })).status === 401);
check('another account cannot either', (await inParty(code, { op: 'next' }, 'other-token')).status === 403);
const hb = await inParty(code, { op: 'heartbeat', deviceId: 'phone', token: 'host-token', tokenExpiresAt: Date.now() + 3600e3, nowPlaying: { name: 'Now', uri: 'spotify:track:np' } }, 'host-token');
check('heartbeat claims the conductor and stores now playing', hb.body.conductor === true && hb.body.nowPlaying.name === 'Now');
check('host is not away after a heartbeat', hb.body.hostAway === false);
check('a second device does not get the conductor', (await inParty(code, { op: 'heartbeat', deviceId: 'laptop' }, 'host-token')).body.conductor === false);
check('the device playing the music takes the conductor from a controller', (await inParty(code, { op: 'heartbeat', deviceId: 'laptop', playsHere: true }, 'host-token')).body.conductor === true);
check('and a controller cannot take it back', (await inParty(code, { op: 'heartbeat', deviceId: 'phone' }, 'host-token')).body.conductor === false);
check('the laptop keeps it', (await inParty(code, { op: 'heartbeat', deviceId: 'laptop', playsHere: true }, 'host-token')).body.conductor === true);
const added = await inParty(code, { op: 'add', track: track('h1'), playNext: true }, 'host-token');
check('host play-next pins to the front', (await state(code)).body.queue[0].uri === 'spotify:track:h1' && added.status === 201);
const n1 = await inParty(code, { op: 'next' }, 'host-token');
check('next hands over the pinned song and parks it', n1.body.item.uri === 'spotify:track:h1' && (await state(code)).body.upNext?.uri === 'spotify:track:h1');
check('a fed song counts as a duplicate', (await inParty(code, { op: 'request', guestId: g2, track: track('h1') })).status === 409);
await inParty(code, { op: 'played', id: n1.body.item.id }, 'host-token');
const after = await state(code);
check('played moves it to history', after.body.upNext === null && after.body.history[0].uri === 'spotify:track:h1');
check('a recently played song is refused', (await inParty(code, { op: 'request', guestId: g2, track: track('h1') })).status === 409);
const n2 = await inParty(code, { op: 'next' }, 'host-token');
check('then the fair order resumes with a1', n2.body.item.uri === 'spotify:track:a1');
const back = await inParty(code, { op: 'unfed' }, 'host-token');
check('unfed returns it to the front', back.body.item.uri === 'spotify:track:a1' && (await state(code)).body.queue[0].uri === 'spotify:track:a1');
await inParty(code, { op: 'settings', paused: true }, 'host-token');
check('paused refuses requests', (await inParty(code, { op: 'request', guestId: g2, track: track('paused') })).status === 423);
await inParty(code, { op: 'settings', paused: false, backing: { uri: 'spotify:playlist:p2', name: 'Chill' } }, 'host-token');
check('backing playlist changed', (await state(code)).body.party.backing.name === 'Chill');
const removed = await inParty(code, { op: 'remove', id: (await state(code)).body.queue[0].id }, 'host-token');
check('host removes a request', removed.body.removed === true);
check('ends', (await inParty(code, { op: 'end' }, 'host-token')).body.ended === true);
check('ended party answers 404', (await state(code)).status === 404 && (await state(code)).body.error === 'This party has ended');
check('host door clears', (await host('GET')).body.party === null);
check('search calls went through the host token once each', searchCalls === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
