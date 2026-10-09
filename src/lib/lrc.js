import { log } from '../services/debugLog.js';

// Shared lyrics helpers. LyricsView and ZenMode each carried their own copy of these, and the
// copies had already drifted: one applied a 300ms lead-in when picking the active line and the
// other didn't, so the two views highlighted different lines for the same song.

// How far ahead of the timestamp a line lights up. Slightly early reads as "in time"; exactly
// on time reads as late, because the eye needs a moment to find the new line.
export const LYRIC_LEAD_IN_MS = 300;

export function parseLrc(lrcString) {
  const lines = lrcString.split('\n');
  const synced = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  lines.forEach((line) => {
    const match = timeRegex.exec(line);
    if (!match) return;

    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const msRaw = match[3];
    const ms = msRaw.length === 2 ? parseInt(msRaw, 10) * 10 : parseInt(msRaw, 10);

    synced.push({
      timeMs: (min * 60000) + (sec * 1000) + ms,
      text: line.replace(timeRegex, '').trim()
    });
  });

  return synced;
}

// lrclib returns several versions of a song; prefer the one whose length matches what's
// actually playing, within a tolerance. Falls back to the first hit when nothing is close.
export function pickClosestByDuration(results, durationSec, toleranceSec = 10) {
  if (!Array.isArray(results) || results.length === 0) return null;
  if (!durationSec) return results[0];

  let best = results[0];
  let bestDiff = Infinity;
  for (const candidate of results) {
    if (typeof candidate.duration !== 'number') continue;
    const diff = Math.abs(candidate.duration - durationSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return bestDiff <= toleranceSec ? best : results[0];
}

// One search for both the Lyrics page and Zen mode. They used to search differently: Zen
// trimmed "feat." and fell back to a second database, the page did neither, so the same song
// had lyrics in one and not the other. Resolves {synced, plain} and rejects with a message
// the view can show.
//
// lrclib sheds load with a quick 503, often several in a row (five running, once, in testing), and
// one of those used to read as "no lyrics" until the view was closed and opened again. A busy or
// unreachable answer is now retried with growing gaps; only a real "not found" is final. The
// second database, lyrics.ovh, was dropped: it answered 404 for Wonderwall, Hello and Yellow.
const LRCLIB = 'https://lrclib.net/api';
const RETRY_DELAYS_MS = [400, 800, 1500, 2500, 4000, 6000];
const NONE = Object.freeze({ none: true });
const NOT_FOUND = "We couldn't find lyrics for this song.";
const MAX_REMEMBERED = 200;

// Answers per song, shared by Zen and the page, so moving between them or toggling the panel
// does not ask lrclib again. Failures are never remembered, so asking again retries.
const settled = new Map();
const inflight = new Map();

const songKey = (track) => track?.id || `${track?.artists?.[0]?.name || ''}|${track?.name || ''}`;
const describeSong = (track) => `${track?.artists?.[0]?.name || '?'} - ${track?.name || '?'}`;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// JSON for a 200, null for an answer that means "not here", and a rejection once a busy or
// unreachable lrclib has had every retry
async function ask(url, { signal, delays, song }) {
  for (let attempt = 0; ; attempt += 1) {
    let res = null;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    if (res?.ok) return res.json();
    if (res && res.status < 500 && res.status !== 429) return null;
    const why = res ? `HTTP ${res.status}` : 'unreachable';
    if (attempt >= delays.length) {
      log('lyrics', 'lrclib gave no answer; giving up', `${why} for ${song}`);
      throw new Error('The lyrics service is busy. Try again in a moment.');
    }
    log('lyrics', 'lrclib busy; retrying', `${why} for ${song}`);
    await sleep(delays[attempt], signal);
  }
}

const hasWords = (r) => r && !r.instrumental && (r.syncedLyrics || r.plainLyrics);

function fromRecord(r) {
  if (!hasWords(r)) return null;
  if (r.syncedLyrics) return { synced: parseLrc(r.syncedLyrics), plain: [] };
  return { synced: null, plain: r.plainLyrics.split('\n') };
}

// Search results include versions with no words at all, and the first hit is often a live cut
// or a remix: timed lyrics of the right length first, then any lyrics of the right length,
// then whatever has words
function bestOf(results, durationSec) {
  const withWords = (Array.isArray(results) ? results : []).filter(hasWords);
  const synced = withWords.filter((r) => r.syncedLyrics);
  const near = (list) => {
    const pick = pickClosestByDuration(list, durationSec);
    if (!pick || !durationSec) return pick;
    return typeof pick.duration === 'number' && Math.abs(pick.duration - durationSec) <= 10 ? pick : null;
  };
  return near(synced) || near(withWords) || synced[0] || withWords[0] || null;
}

async function lookUp(track, durationSec, opts) {
  const artist = track?.artists?.[0]?.name || '';
  const fullTitle = String(track?.name || '').trim();
  const album = track?.album?.name || '';
  const seconds = Math.round(durationSec || (track?.duration_ms || 0) / 1000);
  if (!artist || !fullTitle) return NONE;

  // The exact lookup first: Spotify's own names and length pick the right version, and lrclib
  // answers it more readily than a search
  if (album && seconds) {
    const params = new URLSearchParams({ artist_name: artist, track_name: fullTitle, album_name: album, duration: String(seconds) });
    const exact = await ask(`${LRCLIB}/get?${params}`, opts);
    const found = fromRecord(exact);
    if (found) return found;
    if (exact?.instrumental) return NONE;
  }

  const title = fullTitle.split(/[-()]/)[0].replace(/feat\..*/i, '').trim();
  const results = await ask(`${LRCLIB}/search?q=${encodeURIComponent(`${artist} ${title}`)}`, opts);
  return fromRecord(bestOf(results, durationSec || seconds || null)) || NONE;
}

function remember(key, answer) {
  settled.set(key, answer);
  if (settled.size > MAX_REMEMBERED) settled.delete(settled.keys().next().value);
}

const settle = (answer) => (answer === NONE ? Promise.reject(new Error(NOT_FOUND)) : Promise.resolve(answer));

// `signal` ends this caller's interest. The lookup itself is shared by everyone asking about the
// same song at once, and stops retrying only when all of them have gone.
export function findLyrics(track, durationSec, { signal, delays = RETRY_DELAYS_MS } = {}) {
  const key = songKey(track);
  if (settled.has(key)) return settle(settled.get(key));

  let job = inflight.get(key);
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController();
    const song = describeSong(track);
    job = { controller, users: 0 };
    job.promise = lookUp(track, durationSec, { signal: controller.signal, delays, song })
      .then((answer) => {
        remember(key, answer);
        if (answer === NONE) log('lyrics', 'no lyrics for this song', song);
        return answer;
      })
      .finally(() => { if (inflight.get(key) === job) inflight.delete(key); });
    inflight.set(key, job);
  }

  job.users += 1;
  const current = job;
  signal?.addEventListener('abort', () => {
    current.users -= 1;
    if (current.users <= 0) current.controller.abort();
  }, { once: true });
  return current.promise.then(settle);
}
