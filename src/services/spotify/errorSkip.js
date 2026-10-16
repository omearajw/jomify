import { log } from '../debugLog';

// When the connection goes, Spotify's player plays on from the ~12 s it has buffered, then reports
// a "Playback error" and moves itself on to the next song, which can't load either. Nobody asked
// for that song, and when the connection is back the one that was playing is lost (Jack, 16 Oct:
// Filter, 83 s in, gave way to Death From Above 1979 the moment the train left the wifi). The
// player never pauses, so the pause referee never sees it.
//
// This puts the song back. An error partway into a song that was playing, followed at once by a
// different song nobody asked for, is a song lost to the connection: remember it and where it got
// to, and once Spotify can be reached again, play it from there (a couple of seconds early, so
// nothing is missed). Anything pressed in the meantime means you have moved on, and it is left.
// So does a change of audio outputs, or a pause from headphones or from you: unplugged headphones
// must never end with the music starting again by itself (Jack, 15 and 16 Oct).
// An error at the very start of a song is a song that can't play here, and skipping it is right.

const MIN_POSITION_MS = 5000;    // played this far, it was playing fine until the connection went
const SKIP_WINDOW_MS = 3000;     // the next song arriving this soon after the error is the player's skip
const REWIND_MS = 2000;
const RETRY_EVERY_MS = 5000;
const GIVE_UP_MS = 180000;

let deps = null;     // { restore(lost) -> Promise, lastIntentAt() -> ms, isHere() -> bool, stoppedOnPurposeSince(ms) -> string | null }
let errored = null;  // { uri, contextUri, song, positionMs, at }
let lost = null;     // the same, once the skip has happened, until it is put back or let go
let timer = null;
let listening = false;

export function installErrorSkip(d) {
  deps = d;
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('online', () => { if (lost) attempt('the browser is online again'); });
  navigator.connection?.addEventListener?.('change', () => { if (lost) attempt('the connection changed'); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (lost) { log('playback', 'not putting the lost song back', 'the audio outputs changed'); letGo(); } });
}

// The player reported an error while on `song`
export function noteError({ uri, contextUri, song, positionMs, playing }) {
  if (!uri || !playing || (positionMs || 0) < MIN_POSITION_MS) { errored = null; return; }
  errored = { uri, contextUri: contextUri || null, song, positionMs, at: Date.now() };
}

// A different song is on. Straight after an error, with nothing asked for, it is the player's skip.
export function noteTrackChange(uri) {
  if (lost && uri === lost.uri) { log('playback', 'the lost song is back', lost.song); letGo(); return; }
  const e = errored;
  errored = null;
  if (!e || uri === e.uri || Date.now() - e.at > SKIP_WINDOW_MS) return;
  if ((deps?.lastIntentAt() || 0) > e.at - 500) return; // something was asked for: a real change
  letGo();
  lost = e;
  log('playback', 'Spotify skipped a song after losing the connection', `${e.song || '?'} at ${Math.round(e.positionMs / 1000)}s; it goes back on when the connection does`);
  timer = setTimeout(() => attempt('first try'), 1000);
}

async function attempt(why) {
  clearTimeout(timer);
  if (!lost || !deps) return;
  if (Date.now() - lost.at > GIVE_UP_MS) { log('playback', 'gave up putting the lost song back', 'three minutes passed'); letGo(); return; }
  if (deps.lastIntentAt() > lost.at) { log('playback', 'not putting the lost song back', 'something else was asked for'); letGo(); return; }
  const stopped = deps.stoppedOnPurposeSince?.(lost.at);
  if (stopped) { log('playback', 'not putting the lost song back', stopped); letGo(); return; }
  if (!deps.isHere()) { log('playback', 'not putting the lost song back', 'the music is no longer on this device'); letGo(); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { timer = setTimeout(() => attempt('trying again'), RETRY_EVERY_MS); return; }
  const target = lost;
  try {
    await deps.restore({ ...target, positionMs: Math.max(0, target.positionMs - REWIND_MS) });
    if (lost !== target) return;
    log('playback', 'put the lost song back', `${target.song || '?'} from ${Math.round(Math.max(0, target.positionMs - REWIND_MS) / 1000)}s, ${why}`);
    letGo();
  } catch (err) {
    if (lost !== target) return;
    log('playback', 'could not put the lost song back yet', `${err?.message || err}; trying again`);
    timer = setTimeout(() => attempt('trying again'), RETRY_EVERY_MS);
  }
}

function letGo() {
  clearTimeout(timer);
  timer = null;
  lost = null;
}

export const isRestoring = () => Boolean(lost);
