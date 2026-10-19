// The shared queue's server (api/queue.js) against a stand-in Upstash: revisions, a device behind
// being refused, edits from two devices at once both landing, and what a check costs.
import { emptyQueue, source, play, entry } from '../src/queue/model.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

// ---- fake redis: GET, SET, and the one compare-and-set script api/queue.js runs -----------------
const store = new Map();
let commands = 0;
function exec([cmd, ...a]) {
  commands += 1;
  const c = String(cmd).toUpperCase();
  if (c === 'GET') return store.has(a[0]) ? store.get(a[0]) : null;
  if (c === 'SET') { store.set(a[0], a[1]); return 'OK'; }
  if (c === 'EVAL') {
    const [, numKeys, ...rest] = a;
    const keys = rest.slice(0, Number(numKeys));
    const args = rest.slice(Number(numKeys));
    const cur = Number(store.get(keys[0]) || 0);
    if (cur !== Number(args[0])) return -1;
    store.set(keys[1], args[1]);
    store.set(keys[0], String(cur + 1));
    return cur + 1;
  }
  throw new Error('fake redis: unsupported ' + c);
}
process.env.UPSTASH_REDIS_REST_URL = 'https://fake'; process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
const { HttpClient } = await import('../node_modules/@upstash/redis/chunk-2JFYL2VL.mjs');
HttpClient.prototype.request = async (req) => {
  // a little delay, so two requests in flight really do interleave
  await new Promise((r) => setTimeout(r, Math.random() * 4));
  const pipeline = (req.path || []).includes('pipeline') || (req.path || []).includes('multi-exec');
  if (pipeline) return req.body.map((cmd) => ({ result: exec(cmd) }));
  return { result: exec(req.body) };
};
globalThis.fetch = async (url, init = {}) => {
  const auth = (init.headers?.Authorization || '').replace('Bearer ', '');
  if (url.includes('/v1/me')) return auth === 'jack-token' ? new Response(JSON.stringify({ id: 'jack' }), { status: 200 }) : new Response('{}', { status: 401 });
  return new Response('{}', { status: 404 });
};

const handler = (await import('../api/queue.js')).default;
const call = ({ method = 'GET', query = {}, body, token = 'jack-token' } = {}) => new Promise((resolve) => {
  const headers = { origin: 'https://jomify.vercel.app', authorization: `Bearer ${token}` };
  const res = { status(s) { this.statusCode = s; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); }, setHeader() {}, end() { resolve({ status: this.statusCode, body: null }); } };
  handler({ method, query, body, headers }, res);
});

const song = (id) => ({ id, uri: `spotify:track:${id}`, name: `Song ${id}`, duration_ms: 200000, artists: [{ name: 'A' }] });
const q0 = play(emptyQueue(), source({ kind: 'playlist', uri: 'spotify:playlist:p', name: 'P', tracks: ['a', 'b', 'c'].map(song) }), { start: 0 });

{
  const first = await call();
  check('nothing shared yet: revision 0, no queue', first.status === 200 && first.body.rev === 0 && first.body.q === null);
  const set = await call({ method: 'POST', body: { op: 'set', base: 0, args: { q: q0, given: { keys: [q0.now.key], uris: ['spotify:track:a'] } } } });
  check('the playing device shares its queue: revision 1', set.status === 200 && set.body.rev === 1 && set.body.q.now.id === 'a');
  commands = 0;
  const same = await call({ query: { since: '1' } });
  check('a device already up to date gets just the revision', same.status === 200 && same.body.rev === 1 && same.body.q === undefined);
  check('...which costs two reads (who is asking, and the revision)', commands === 2);
  const stale = await call({ method: 'POST', body: { op: 'set', base: 0, args: { q: q0 } } });
  check('a device that missed a change is refused, and sent the queue as it is', stale.status === 409 && stale.body.rev === 1 && stale.body.q.now.id === 'a');
  const forced = await call({ method: 'POST', body: { op: 'set', base: 0, force: true, args: { q: q0 } } });
  check('...unless it insists', forced.status === 200 && forced.body.rev === 2);
  // two devices add a song at the same moment
  const e1 = entry(song('n1'), 'next'), e2 = entry(song('n2'), 'next');
  const [r1, r2] = await Promise.all([
    call({ method: 'POST', body: { op: 'add', args: { entries: [e1] } } }),
    call({ method: 'POST', body: { op: 'add', args: { entries: [e2] } } })
  ]);
  const now = await call();
  check('two edits at once: both land', r1.status === 200 && r2.status === 200 && now.body.rev === 4 && now.body.q.next.map((e) => e.id).sort().join() === 'n1,n2');
  const removed = await call({ method: 'POST', body: { op: 'remove', args: { key: e1.key } } });
  check('remove by key', removed.body.q.next.map((e) => e.id).join() === 'n2');
  const bad = await call({ method: 'POST', body: { op: 'drop' } });
  check('an unknown operation is refused', bad.status === 400);
  const stranger = await call({ token: 'nobody' });
  check('no valid Spotify token, no queue', stranger.status === 401);
  const huge = await call({ method: 'POST', body: { op: 'set', base: 5, args: { q: { ...q0, then: Array.from({ length: 8000 }, (_, i) => entry(song('x' + i), 'source')) } } } });
  check('a queue too large to share is refused rather than stored', huge.status === 413);
}

console.log(`\nqueue server: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
