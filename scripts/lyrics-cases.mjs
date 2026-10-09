// The lyrics lookup against a stubbed lrclib: a busy answer is retried rather than read as "no
// lyrics", the exact lookup comes first, answers are shared, and abandoned lookups stop.
import { findLyrics } from '../src/lib/lrc.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

const FAST = [0, 0, 0, 0, 0, 0];
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let calls = [];
let route = () => json(404, {});
globalThis.fetch = async (url, init) => {
  if (init?.signal?.aborted) throw init.signal.reason;
  calls.push(String(url));
  return route(String(url));
};
const isGet = (u) => u.includes('/api/get?');
const isSearch = (u) => u.includes('/api/search?');
let n = 0;
const track = (extra = {}) => ({ id: `t${++n}`, name: 'Delilah (pull me out of this)', duration_ms: 251000, artists: [{ name: 'Fred again..' }], album: { name: 'Actual Life 3' }, ...extra });
const SYNCED = '[00:01.00] first line\n[00:05.00] second line';
const outcome = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

{
  calls = []; let busy = 2;
  route = (u) => (isGet(u) ? (busy-- > 0 ? json(503, {}) : json(200, { syncedLyrics: SYNCED, duration: 251 })) : json(500, {}));
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('two 503s then an answer: the lyrics arrive', r.ok && r.v.synced?.length === 2);
  check('…after three asks of the exact lookup and no search', calls.length === 3 && calls.every(isGet));
  check('the exact lookup carries Spotify\'s names and length', calls[0].includes('track_name=Delilah+%28pull+me+out+of+this%29') && calls[0].includes('album_name=Actual+Life+3') && calls[0].includes('duration=251'));
}

{
  calls = []; let thrown = 1;
  route = (u) => { if (thrown-- > 0) throw new TypeError('Failed to fetch'); return isGet(u) ? json(200, { plainLyrics: 'a\nb' }) : json(404, {}); };
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('a network error is retried, not taken as no lyrics', r.ok && r.v.plain.join('|') === 'a|b' && r.v.synced === null);
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(404, {}) : json(200, [
    { instrumental: true, duration: 251 },
    { plainLyrics: 'plain words', duration: 251 },
    { syncedLyrics: '[00:01.00] live cut', duration: 330 },
    { syncedLyrics: SYNCED, duration: 252 }
  ]));
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('not found exactly: the search is next', calls.length === 2 && isGet(calls[0]) && isSearch(calls[1]));
  check('the search drops "feat." and brackets', calls[1].endsWith(encodeURIComponent('Fred again.. Delilah')));
  check('timed lyrics of the right length win over plain, wordless and the live cut', r.ok && r.v.synced?.[0]?.text === 'first line');
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(404, {}) : json(200, [{ instrumental: true }, { plainLyrics: 'only these', duration: 999 }]));
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('a first hit with no words does not hide a later one that has them', r.ok && r.v.plain[0] === 'only these');
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(404, {}) : json(200, []));
  const t = track();
  const first = await outcome(findLyrics(t, 251, { delays: FAST }));
  const before = calls.length;
  const again = await outcome(findLyrics(t, 251, { delays: FAST }));
  check('a song lrclib does not have is "not found"', !first.ok && /couldn't find/.test(first.e.message));
  check('…and is remembered: asking again costs nothing', !again.ok && calls.length === before);
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(200, { instrumental: true }) : json(200, [{ plainLyrics: 'wrong song' }]));
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('an exact match marked instrumental is final, without a search', !r.ok && calls.length === 1);
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(400, {}) : json(200, [{ syncedLyrics: SYNCED, duration: 251 }]));
  const r = await outcome(findLyrics(track(), 251, { delays: FAST }));
  check('a 400 is "not here", not retried', r.ok && calls.length === 2);
}

{
  calls = [];
  route = (u) => json(200, [{ syncedLyrics: SYNCED, duration: 200 }]);
  const r = await outcome(findLyrics(track({ album: undefined }), 200, { delays: FAST }));
  check('no album name: straight to the search', r.ok && calls.length === 1 && isSearch(calls[0]));
}

{
  calls = [];
  route = () => json(503, {});
  const t = track();
  const r = await outcome(findLyrics(t, 251, { delays: [0, 0] }));
  check('busy past every retry: a busy message, not "no lyrics"', !r.ok && /busy/.test(r.e.message) && calls.length === 3);
  route = (u) => (isGet(u) ? json(200, { syncedLyrics: SYNCED }) : json(404, {}));
  const later = await outcome(findLyrics(t, 251, { delays: [0, 0] }));
  check('…and that failure is not remembered: asking again finds them', later.ok && later.v.synced.length === 2);
}

{
  calls = [];
  route = (u) => (isGet(u) ? json(503, {}) : json(404, {}));
  const stop = new AbortController();
  const p = outcome(findLyrics(track(), 251, { signal: stop.signal, delays: [30, 30, 30, 30, 30, 30] }));
  await new Promise((r) => setTimeout(r, 10));
  stop.abort();
  const r = await p;
  const at = calls.length;
  await new Promise((r) => setTimeout(r, 120));
  check('the only viewer leaving stops the retries', !r.ok && calls.length === at && at === 1);
}

{
  calls = []; let busy = 2;
  route = (u) => (isGet(u) ? (busy-- > 0 ? json(503, {}) : json(200, { syncedLyrics: SYNCED })) : json(404, {}));
  const t = track();
  const leaving = new AbortController();
  const a = outcome(findLyrics(t, 251, { signal: leaving.signal, delays: [20, 20, 20] }));
  const b = outcome(findLyrics(t, 251, { delays: [20, 20, 20] }));
  await new Promise((r) => setTimeout(r, 5));
  leaving.abort();
  const [, rb] = await Promise.all([a, b]);
  check('two views asking at once share one lookup', calls.length === 3);
  check('one leaving does not stop it for the other', rb.ok && rb.v.synced.length === 2);
}

{
  calls = [];
  const r = await outcome(findLyrics({ id: 'x', name: '', artists: [] }, 100, { delays: FAST }));
  check('a track with no name or artist asks nobody', !r.ok && calls.length === 0);
}

console.log(`\nlyrics: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
