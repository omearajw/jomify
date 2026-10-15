import { log } from '../debugLog';

// Why did the music pause, and should it start again? One place decides, for this browser's own
// player. It replaces eleven pieces that each guessed and each had their own timer (see the
// write-up of 15 Oct 2026 and DESIGN.md §10).
//
// Spotify's player never says why it paused (memory: jomify-sdk-internals), so the cause is read
// from what else happened around the pause. Every pause gets exactly one cause:
//
//   you         Jomify sent a pause (a button, the lock screen, a key, the sleep timer)
//   headphones  the audio outputs changed (AirPods disconnecting, a cable out)
//   elsewhere   the music moved to another device, or Spotify handed it there
//   network     the connection dropped: offline, the player left Spotify Connect, or it was
//               loading when it stopped
//   stalled     a new song arrived paused right after the last one finished (Spotify's own slip)
//   unknown     none of the above
//
// and one rule each: only "network" and "stalled" ever start the music again. "network" keeps
// trying until the connection is back, for up to two minutes; anything you do, a change of
// audio outputs, or the music moving elsewhere ends the trying at once. Every decision is logged
// with its cause.

const DEVICE_WINDOW_MS = 2500;   // an output change this close to a pause caused it
const NETWORK_WINDOW_MS = 15000; // a network sign this recent counts
const COMMAND_WINDOW_MS = 10000; // how long a Jomify pause waits for Spotify to report it
const SETTLE_MS = 1200;          // signals that arrive just after the pause (devicechange does)
const RETRY_EVERY_MS = 5000;
const RETRY_FOR_MS = 120000;
const STALLED_GRACE_MS = 300;   // after the settle: 1.5 s in all, as before

let deps = null;                 // { resume, isPausedHere, whereIsMusic }
let installed = false;

// what has happened, and when
let pendingPause = 0;            // a Jomify pause not yet reported by Spotify
let lastCommandAt = 0;
let lastDeviceChangeAt = 0;
let lastNetworkAt = 0;
let lastNetworkWhat = '';
let loadingSince = 0;
let connected = true;            // the player is on Spotify Connect
let lastCause = null;            // { cause, at, song }

let recovering = null;           // { song, until, timer }
let decideTimer = null;
let stalledTimer = null;

const now = () => Date.now();
const recent = (at, ms) => at && now() - at <= ms;

function stopRecovering(why) {
  if (!recovering) return;
  clearTimeout(recovering.timer);
  log('pause', 'stopped trying to restart the music', why);
  recovering = null;
}

// --- signals ---

// Jomify asked for something. A pause is held until Spotify reports it, however slowly; any
// command at all ends a network retry, because you have taken over.
export function noteCommand(kind) {
  lastCommandAt = now();
  if (kind === 'pause') pendingPause = now();
  else pendingPause = 0;
  clearTimeout(stalledTimer);
  stopRecovering(`you pressed ${kind}`);
}

export function noteDevicesChanged() {
  lastDeviceChangeAt = now();
  // the overlap rule: a change of outputs overrides a network retry
  stopRecovering('the audio outputs changed');
}

export function noteNetwork(what) {
  lastNetworkAt = now();
  lastNetworkWhat = what;
}

export function noteLoading(loading) {
  if (loading && !loadingSince) loadingSince = now();
  if (!loading) loadingSince = 0;
}

export function noteConnection(isConnected) {
  connected = isConnected;
  if (!isConnected) noteNetwork('the player dropped off Spotify Connect');
  else if (recovering) tryRestart('the player is back on Spotify Connect');
}

// The music moved to another device (Spotify says so, or this player stopped being the active one)
export function noteElsewhere(where) {
  stopRecovering(`the music is now ${where}`);
  if (lastCause && now() - lastCause.at < 30000 && lastCause.cause !== 'elsewhere') {
    lastCause = { ...lastCause, cause: 'elsewhere' };
  }
}

// --- the decision ---

// This browser's player reported a pause. `newSong` is true when it arrived with a different song.
export function notePaused({ song, position, newSong, wasPlaying }) {
  clearTimeout(decideTimer);
  if (recent(pendingPause, COMMAND_WINDOW_MS)) {
    pendingPause = 0;
    decide('you', song, 'Jomify paused it');
    return;
  }
  // Let the signals that trail a pause arrive, then judge
  decideTimer = setTimeout(() => judge({ song, position, newSong, wasPlaying }), SETTLE_MS);
}

export function notePlaying() {
  clearTimeout(decideTimer);
  clearTimeout(stalledTimer);
  pendingPause = 0;
  if (recovering) { log('pause', 'playing again', recovering.song); recovering = null; }
}

async function judge({ song, position, newSong, wasPlaying }) {
  if (!deps?.isPausedHere()) return; // it has started again, or moved, while we waited
  if (recent(lastDeviceChangeAt, DEVICE_WINDOW_MS + SETTLE_MS)) { decide('headphones', song, 'the audio outputs changed as it paused'); return; }
  if (recent(lastCommandAt, 3000)) { decide('you', song, 'a Jomify command came just before'); return; }
  const where = await deps.whereIsMusic().catch(() => null);
  if (where && where.elsewhere) { decide('elsewhere', song, `Spotify says it is on ${where.name || 'another device'}`); return; }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline || !connected || recent(lastNetworkAt, NETWORK_WINDOW_MS) || (loadingSince && now() - loadingSince > 500) || where === null) {
    const sign = offline ? 'the browser is offline' : !connected ? 'the player is off Spotify Connect' : loadingSince ? 'it was loading when it stopped' : where === null ? 'Spotify could not be reached' : lastNetworkWhat;
    decide('network', song, sign);
    return;
  }
  if (newSong && wasPlaying && (position || 0) < 3000) { decide('stalled', song, 'the next song arrived paused'); return; }
  decide('unknown', song, 'no sign of why');
}

function decide(cause, song, detail) {
  lastCause = { cause, at: now(), song };
  const action = cause === 'network' ? 'will restart it when the connection is back'
    : cause === 'stalled' ? 'starting it' : 'leaving it paused';
  log('pause', `${song || '?'} paused: ${cause}`, `${detail}; ${action}`);
  if (cause === 'network') startRecovering(song);
  if (cause === 'stalled') {
    clearTimeout(stalledTimer);
    stalledTimer = setTimeout(() => { if (deps?.isPausedHere()) deps.resume('the next song had arrived paused'); }, STALLED_GRACE_MS);
  }
}

function startRecovering(song) {
  stopRecovering('a new network pause');
  recovering = { song, until: now() + RETRY_FOR_MS, timer: null };
  // the connection may already be back by the time the pause is judged: try at once
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (online && connected) recovering.timer = setTimeout(() => tryRestart('the connection is already back'), 300);
  else schedule();
}

function schedule() {
  if (!recovering) return;
  clearTimeout(recovering.timer);
  recovering.timer = setTimeout(() => tryRestart('trying again'), RETRY_EVERY_MS);
}

async function tryRestart(why) {
  if (!recovering) return;
  if (now() > recovering.until) { stopRecovering('two minutes passed without the connection coming back'); return; }
  if (!deps?.isPausedHere()) { stopRecovering('it is playing again, or no longer here'); return; }
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online || !connected) { schedule(); return; }
  const where = await deps.whereIsMusic().catch(() => null);
  if (!recovering) return;
  if (where?.elsewhere) { stopRecovering(`the music is now on ${where.name || 'another device'}`); return; }
  if (where === null) { schedule(); return; } // Spotify still out of reach
  log('pause', 'the connection is back; restarting the music', `${recovering.song || '?'}, ${why}`);
  deps.resume('the connection came back');
  schedule(); // checked again shortly; playing ends the retrying
}

export const lastPauseCause = () => lastCause;
export const isRecovering = () => Boolean(recovering);

// --- wiring ---

export function installPauseReferee(d) {
  deps = d;
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('offline', () => noteNetwork('the browser went offline'));
  window.addEventListener('online', () => { if (recovering) tryRestart('the browser is online again'); });
  navigator.connection?.addEventListener?.('change', () => noteNetwork('the connection changed'));
  navigator.mediaDevices?.addEventListener?.('devicechange', noteDevicesChanged);
}
