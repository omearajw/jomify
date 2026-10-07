import { usePartyStore } from '../store/partyStore';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { hostApi } from './client';
import { addToQueue, playContext, fetchQueue } from '../services/spotify/api';
import { playOn, togglePlay, next as skipNext, setShuffle } from '../services/spotify/playbackController';
import { log } from '../services/debugLog';

// The host device that keeps the party going. It heartbeats so the server has a live token and
// something to show guests; when it holds the conductor lock it hands Spotify the next song just
// before the current one ends, confirms it played, and refuses to let the music stop.
//
// Only one of the host's devices conducts at a time (the lock); the rest just show the party.

const HEARTBEAT_MS = 8000;
const CHANGE_PUSH_DELAY_MS = 400;  // a track change reaches guests after this, not the next heartbeat
const TICK_MS = 1500;
const FEED_AT_MS = 15000;        // hand over the next song with this much of the current one left
const FED_TIMEOUT_MS = 90000;    // a fed song Spotify hasn't started by then goes back to the queue
const PAUSE_TOLERANCE_MS = 8000; // paused this long without the host asking: resume
const SILENCE_TOLERANCE_MS = 15000;
const RESTART_COOLDOWN_MS = 60000;

let timers = null;
let fed = null;            // { item, at } handed to Spotify, awaiting its start
let pausedSince = 0;
let silentSince = 0;
let lastResumeAt = 0;
let lastRestartAt = 0;
let hostPaused = false;    // the host pressed pause in the party view; the watchdog stands down
let wakeLock = null;
let heartbeatInFlight = false;
let unsubscribeChanges = null;
let changeTimer = null;

const party = () => usePartyStore.getState();
const player = () => usePlayerStore.getState();
const token = () => useUserStore.getState().token;

export const isConducting = () => Boolean(timers);
export function setHostPaused(value) { hostPaused = Boolean(value); if (!value) pausedSince = 0; }

function livePosition(state, positionAt) {
  if (!state) return 0;
  return state.paused ? state.position : state.position + (Date.now() - positionAt);
}

function snapshot() {
  const s = player();
  const t = s.playbackState?.track_window?.current_track;
  if (!t) return null;
  return {
    uri: t.uri, name: t.name, artists: (t.artists || []).map((a) => a.name).join(', '),
    image: t.album?.images?.[0]?.url || null, durationMs: t.duration_ms || s.playbackState.duration || 0,
    position: Math.round(livePosition(s.playbackState, s.positionAt)), paused: Boolean(s.playbackState.paused), at: Date.now(),
    device: s.activeDevice?.name || null
  };
}

export async function heartbeat() {
  const code = party().code;
  if (!code || heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    const u = useUserStore.getState();
    const res = await hostApi.op(code, { op: 'heartbeat', deviceId: party().deviceId, token: u.token, tokenExpiresAt: u.tokenExpiresAt, nowPlaying: snapshot() });
    party().applyState(res);
  } catch (err) {
    if (err?.status === 404) { log('party', 'the party has ended', err.message); stopConductor(); party().clear(); return; }
    party().setError(err?.message || 'Lost touch with the party');
  } finally {
    heartbeatInFlight = false;
  }
}

async function waitForQueued(t, uri) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 300 : 500));
    try {
      const q = await fetchQueue(t);
      if ((q?.queue || []).some((x) => x?.uri === uri)) return true;
    } catch { /* keep trying */ }
  }
  log('party', 'the queue never showed the song; skipping anyway');
  return false;
}

async function feedNext(reason, { waitUntilQueued = false } = {}) {
  const code = party().code;
  const t = token();
  if (!code || !t || fed) return null;
  let item;
  try {
    ({ item } = await hostApi.op(code, { op: 'next' }));
  } catch (err) { log('party', 'could not take the next song', err.message); return null; }
  if (!item) return null;
  fed = { item, at: Date.now() };
  // Show it straight away rather than after the next heartbeat
  usePartyStore.setState((s) => ({ upNext: item, queue: s.queue.filter((i) => i.id !== item.id) }));
  try {
    await addToQueue(t, player().activeDevice?.id || null, item.uri);
    log('party', `queued ${item.name} for ${item.guestName}`, reason);
    // Spotify answers before the queue actually holds the song. A skip in that gap went to the
    // playlist's next track and the request played after it, so wait until the queue shows it.
    if (waitUntilQueued) await waitForQueued(t, item.uri);
  } catch (err) {
    log('party', `Spotify refused ${item.name}`, err?.message);
    fed = null;
    await hostApi.op(code, { op: 'unfed' }).catch(() => {});
    return null;
  }
  return item;
}

async function restartBacking(reason) {
  const t = token();
  const backing = party().party?.backing;
  if (!t || !backing?.uri || Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) return;
  lastRestartAt = Date.now();
  log('party', `starting ${backing.name || 'the playlist'} again`, reason);
  await playOn(async (deviceId) => {
    await playContext(t, deviceId, backing.uri, 0);
    await setShuffle(true, deviceId).catch(() => {});
  }, { quiet: true }).catch((err) => log('party', 'could not restart the playlist', err?.message));
}

async function tick() {
  const p = party();
  if (!p.code || !p.conductor) return;
  const s = player();
  const state = s.playbackState;
  const current = state?.track_window?.current_track?.uri || null;
  const now = Date.now();

  // A fed song heard playing is done with; one that never starts goes back
  if (fed) {
    if (current === fed.item.uri) {
      const done = fed; fed = null;
      hostApi.op(p.code, { op: 'played', id: done.item.id }).then((res) => party().applyState(res)).catch(() => {});
    } else if (now - fed.at > FED_TIMEOUT_MS) {
      log('party', `${fed.item.name} never started; back to the front`);
      fed = null;
      hostApi.op(p.code, { op: 'unfed' }).catch(() => {});
    }
  }

  // Never silent
  if (!current) {
    silentSince = silentSince || now;
    if (now - silentSince > SILENCE_TOLERANCE_MS && !hostPaused) restartBacking('nothing was playing');
    return;
  }
  silentSince = 0;
  if (state.paused) {
    pausedSince = pausedSince || now;
    if (!hostPaused && now - pausedSince > PAUSE_TOLERANCE_MS && now - lastResumeAt > PAUSE_TOLERANCE_MS * 2) {
      lastResumeAt = now;
      log('party', 'paused with nobody asking; resuming');
      togglePlay();
    }
  } else {
    pausedSince = 0;
  }

  // Hand over the next request as late as possible
  const remaining = (state.duration || 0) - livePosition(state, s.positionAt);
  if (!fed && p.queue.length > 0 && remaining > 0 && remaining < FEED_AT_MS) await feedNext(`${Math.round(remaining / 1000)}s left`);
}

// The party view's Skip: the next request goes in first so a skip lands on it, not on the playlist
export async function skipWithParty() {
  const before = player().playbackState?.track_window?.current_track?.uri || null;
  if (!fed && party().queue.length > 0) await feedNext('skip', { waitUntilQueued: true });
  const wanted = fed?.item || null;
  skipNext();
  if (!wanted) return;
  // Spotify sometimes lands on the playlist's next song despite the queue; one more skip reaches
  // the request. Only when the song really changed to something else, never on a slow answer.
  await new Promise((r) => setTimeout(r, 3000));
  const now = player().playbackState?.track_window?.current_track?.uri || null;
  if (fed?.item?.uri === wanted.uri && now && now !== before && now !== wanted.uri) {
    log('party', `skip landed on the playlist, not ${wanted.name}; skipping once more`);
    skipNext();
  }
}

async function acquireWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
const onVisible = () => { if (document.visibilityState === 'visible' && timers && !wakeLock) acquireWakeLock(); };

export function startConductor() {
  if (timers) return;
  fed = null; pausedSince = 0; silentSince = 0; hostPaused = false;
  timers = { hb: setInterval(heartbeat, HEARTBEAT_MS), tick: setInterval(() => { tick().catch(() => {}); }, TICK_MS) };
  heartbeat();
  // Guests see a change of song straight away rather than at the next heartbeat
  const keyOf = (s) => `${s.playbackState?.track_window?.current_track?.uri || ''}|${s.playbackState?.paused ? 1 : 0}`;
  let lastKey = keyOf(player());
  unsubscribeChanges = usePlayerStore.subscribe((s) => {
    const key = keyOf(s);
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(heartbeat, CHANGE_PUSH_DELAY_MS);
  });
  acquireWakeLock();
  document.addEventListener('visibilitychange', onVisible);
  log('party', 'conducting', party().code);
}

export function stopConductor() {
  if (!timers) return;
  clearInterval(timers.hb); clearInterval(timers.tick); timers = null;
  unsubscribeChanges?.(); unsubscribeChanges = null; clearTimeout(changeTimer);
  document.removeEventListener('visibilitychange', onVisible);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  log('party', 'stopped conducting');
}

// Rejoin after a reload: the code is persisted, the server says whether the party still exists
export async function resumePartyIfAny() {
  const code = party().code;
  if (!code || !token()) return;
  try {
    const { party: live } = await hostApi.current();
    if (live?.code === code) { startConductor(); return; }
  } catch { return; }
  party().clear();
}
