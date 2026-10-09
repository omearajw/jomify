import { usePartyStore } from '../store/partyStore';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { hostApi, guestApi } from './client';
import { addToQueue, playContext, fetchQueue, fetchDevices, transferPlayback, resumePlayback } from '../services/spotify/api';
import { playOn, togglePlay, next as skipNext, setShuffle, requestFastPlaybackUpdates, PLAYER_NAME, onUserPause, userPausedAt } from '../services/spotify/playbackController';
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
const SPEAKER_CHECK_MS = 20000;

let timers = null;
let fed = null;              // { item, at } handed to Spotify, awaiting its start
let lastConfirmedId = null; // the last request fed elsewhere that this conductor confirmed
let releaseFastUpdates = null;
// The party speaker (an Alexa group, say): whether Spotify lists it, and whether the music had to go
// somewhere else while it was missing, so it can be moved back when the speaker returns
let speakerOk = null;
let fellBack = false;
let lastSpeakerCheckAt = 0;
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

// A pause made through Jomify on this device stands. Every device reports it to the party, so the
// conductor leaves it be even when the pause was pressed on the phone and the laptop conducts.
onUserPause(() => {
  hostPaused = true;
  const code = party().code;
  if (code && token()) hostApi.op(code, { op: 'hostPause', deviceName: PLAYER_NAME }).catch(() => {});
});

// Before resuming a pause that looks unasked: was it the host, here or on another of their devices?
async function pausedByHost(since) {
  if (userPausedAt() >= since - 3000) return 'on this device';
  const code = party().code;
  if (!code) return null;
  try {
    const view = await guestApi.state(code);
    if (view.hostPausedAt && view.hostPausedAt >= since - 5000) return view.hostPausedBy ? `on ${view.hostPausedBy}` : 'on another of your devices';
  } catch { /* can't tell: resume, as before */ }
  return null;
}
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
    // The device the music comes out of wins the conductor lock, so the laptop that stays on all
    // night conducts even when the phone opened the party first
    const res = await hostApi.op(code, {
      op: 'heartbeat', deviceId: party().deviceId, deviceName: PLAYER_NAME, role: party().role || 'auto',
      playsHere: Boolean(player().isLocalActive), awake: Boolean(wakeLock && !wakeLock.released),
      speakerOk, token: u.token, tokenExpiresAt: u.tokenExpiresAt, nowPlaying: snapshot()
    });
    party().applyState(res);
  } catch (err) {
    if (err?.status === 404) { log('party', 'the party has ended', err.message); stopConductor(); party().clear(); return; }
    party().setError(err?.message || 'Lost touch with the party');
  } finally {
    heartbeatInFlight = false;
  }
}

// A relinked song (another market's copy) shows in the queue under a different uri with the
// requested one in linked_from, so match either, or the wait ran its full course every time
const sameSong = (x, uri) => x?.uri === uri || x?.linked_from?.uri === uri;
// Development-mode apps no longer get linked_from, so a relinked copy is only recognisable by
// what it is called; the artists are kept loose because the queue gives objects and the party
// item a joined string
const sameSongByName = (x, item) => Boolean(x && item && x.name && x.name === item.name && ((x.artists || []).map((a) => a.name).join(', ') === item.artists || !item.artists));
const isItem = (x, item) => sameSong(x, item.uri) || sameSongByName(x, item);
async function waitForQueued(t, item) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const q = await fetchQueue(t);
      if ((q?.queue || []).some((x) => isItem(x, item))) return true;
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
    if (waitUntilQueued) await waitForQueued(t, item);
  } catch (err) {
    log('party', `Spotify refused ${item.name}`, err?.message);
    fed = null;
    await hostApi.op(code, { op: 'unfed' }).catch(() => {});
    return null;
  }
  return item;
}

// The party speaker as Spotify lists it now: by id, or by name, since a speaker group can come back
// from a restart under a new id. Null when it is not listed; undefined when the list itself failed.
const speakerOf = () => party().party?.speaker || null;
async function findSpeaker() {
  const speaker = speakerOf();
  const t = token();
  if (!speaker || !t) return null;
  let devices;
  try { devices = await fetchDevices(t); } catch { return undefined; }
  return devices.find((d) => d.id === speaker.id) || devices.find((d) => d.name && d.name === speaker.name) || null;
}

async function checkSpeaker() {
  lastSpeakerCheckAt = Date.now();
  if (!speakerOf()) { speakerOk = null; return null; }
  const found = await findSpeaker();
  if (found === undefined) return undefined; // couldn't ask; leave things as they were
  const was = speakerOk;
  speakerOk = Boolean(found);
  if (was !== speakerOk) {
    log('party', speakerOk ? `${found.name} is on Spotify Connect` : `${speakerOf().name} has dropped off Spotify Connect`);
    heartbeat();
  }
  // Back after going missing, and the music had to go elsewhere meanwhile: move it back
  if (found && fellBack) {
    fellBack = false;
    const active = player().activeDevice;
    if (!active || active.id !== found.id) {
      log('party', `${found.name} is back; moving the music there`);
      await transferPlayback(token(), found.id, true).catch((err) => log('party', `could not move the music to ${found.name}`, err?.message));
    }
  }
  return found;
}

async function restartBacking(reason) {
  const t = token();
  const backing = party().party?.backing;
  if (!t || !backing?.uri || Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) return;
  lastRestartAt = Date.now();
  log('party', `starting ${backing.name || 'the playlist'} again`, reason);
  const start = async (deviceId) => {
    await playContext(t, deviceId, backing.uri, 0);
    await setShuffle(true, deviceId).catch(() => {});
  };
  // The speaker first. If it is missing the music still may not stop, so it goes wherever Spotify
  // can play, and moves back once the speaker returns.
  if (speakerOf()) {
    const found = await checkSpeaker();
    if (found) {
      try { await start(found.id); return; } catch (err) { log('party', `${found.name} would not start`, err?.message); }
    }
    fellBack = true;
  }
  await playOn(start, { quiet: true }).catch((err) => log('party', 'could not restart the playlist', err?.message));
}

// Paused with nobody asking. With a party speaker, resume there and nowhere else: the general
// resume moves music to this browser when a remote device is slow to start, and an Alexa group can
// be slow enough to set that off.
async function resumeParty() {
  const t = token();
  if (!speakerOf() || !t) { togglePlay(); return; }
  const found = await checkSpeaker();
  if (!found) { restartBacking('the speaker is missing'); return; }
  await resumePlayback(t, found.id).catch(() => restartBacking(`${found.name} would not resume`));
}

async function tick() {
  const p = party();
  if (!p.code || !p.conductor) return;
  const s = player();
  const state = s.playbackState;
  const current = state?.track_window?.current_track?.uri || null;
  const now = Date.now();

  // A request another of the host's devices fed (a skip from the phone) is confirmed here, so it
  // reaches the history and its guest is told
  const currentTrack = player().playbackState?.track_window?.current_track;
  if (!fed && p.upNext && p.upNext.id !== lastConfirmedId && isItem(currentTrack, p.upNext)) {
    lastConfirmedId = p.upNext.id;
    hostApi.op(p.code, { op: 'played', id: p.upNext.id }).then((res) => party().applyState(res)).catch(() => {});
  }

  // A fed song heard playing is done with; one that never starts goes back
  if (fed) {
    if (isItem(player().playbackState?.track_window?.current_track, fed.item)) {
      const done = fed; fed = null;
      hostApi.op(p.code, { op: 'played', id: done.item.id }).then((res) => party().applyState(res)).catch(() => {});
    } else if (now - fed.at > FED_TIMEOUT_MS) {
      log('party', `${fed.item.name} never started; back to the front`);
      fed = null;
      hostApi.op(p.code, { op: 'unfed' }).catch(() => {});
    }
  }

  // Keep an eye on the speaker
  if (speakerOf() && now - lastSpeakerCheckAt > SPEAKER_CHECK_MS) checkSpeaker().catch(() => {});

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
      const since = pausedSince;
      const byHost = await pausedByHost(since);
      if (byHost) {
        hostPaused = true;
        log('party', `paused by you ${byHost}; leaving it paused`);
      } else if (party().conductor && player().playbackState?.paused && pausedSince === since) {
        lastResumeAt = Date.now(); // only an actual resume holds off the next one
        log('party', 'paused with nobody asking; resuming');
        resumeParty();
      }
    }
  } else {
    pausedSince = 0;
    hostPaused = false; // playing again: the next pause is judged afresh
  }

  // Hand over the next request as late as possible
  const remaining = (state.duration || 0) - livePosition(state, s.positionAt);
  if (!fed && p.queue.length > 0 && remaining > 0 && remaining < FEED_AT_MS) await feedNext(`${Math.round(remaining / 1000)}s left`);
}

// The party view's Skip: the next request goes in first so a skip lands on it, not on the playlist
// One press, one skip. The wait for Spotify's queue made the first press look dead, so the
// button shows it is working and a second press while it works is ignored, not queued up.
let skipInFlight = false;
export async function skipWithParty() {
  if (skipInFlight) return;
  skipInFlight = true;
  usePartyStore.setState({ skipping: true });
  try {
    if (!fed && party().queue.length > 0) await feedNext('skip', { waitUntilQueued: true });
    const wanted = fed?.item || null;
    skipNext();
    if (!wanted) return;
    // Spotify can land on the playlist's next song despite the queue. Only Spotify's own queue
    // says so reliably: skip once more only when the request is still waiting at its front.
    // Judging by what this device showed used to skip the request itself whenever its view lagged.
    await new Promise((r) => setTimeout(r, 2500));
    const t = token();
    const q = t ? await fetchQueue(t).catch(() => null) : null;
    if (!q) return;
    if (isItem(q.currently_playing, wanted)) return;
    if (isItem(q.queue?.[0], wanted)) {
      log('party', `skip landed before ${wanted.name}; skipping once more`);
      skipNext();
    } else {
      log('party', `after the skip Spotify is playing ${q.currently_playing?.name || 'nothing'}, and ${wanted.name} is not next`);
    }
  } finally {
    // Only the conductor follows a fed song to the end. On any other device it would linger and
    // the next skip would feed nothing and then chase it with a second skip.
    if (!party().conductor) fed = null;
    skipInFlight = false;
    usePartyStore.setState({ skipping: false });
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
  // Song changes reach the projector and the guests within a couple of seconds, not five
  releaseFastUpdates = requestFastPlaybackUpdates();
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
  releaseFastUpdates?.(); releaseFastUpdates = null;
  speakerOk = null; fellBack = false;
  document.removeEventListener('visibilitychange', onVisible);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  log('party', 'stopped conducting');
}

// Rejoin after a reload: the code is persisted, the server says whether the party still exists
// On opening: a party one of the host's devices was running a few minutes ago (a reload, a
// restart mid-party) is rejoined; one left open since another night is not quietly taken over,
// since its watchdog would start resuming every pause. It waits behind a bar offering to open
// or end it.
const REJOIN_WITHIN_MS = 20 * 60 * 1000;
export async function resumePartyIfAny() {
  const code = party().code;
  const checked = (patch = {}) => usePartyStore.setState({ rejoinChecked: true, ...patch });
  if (!code || !token()) { checked(); return; }
  try {
    const { party: live, lastHeartbeatAt, serverTime } = await hostApi.current();
    if (live?.code === code) {
      const quietFor = (serverTime || Date.now()) - (lastHeartbeatAt || 0);
      if (lastHeartbeatAt && quietFor < REJOIN_WITHIN_MS) { checked({ dormant: false }); startConductor(); return; }
      log('party', 'a party is still open from earlier; not rejoining it by itself', code);
      checked({ dormant: true, party: live });
      return;
    }
  } catch { checked(); return; }
  party().clear();
  checked();
}

// Picking a party left open from earlier back up
export function rejoinParty() {
  usePartyStore.setState({ dormant: false });
  startConductor();
}

export async function endParty() {
  const code = party().code;
  if (code) await hostApi.op(code, { op: 'end' }).catch(() => {});
  stopConductor();
  party().clear();
}
