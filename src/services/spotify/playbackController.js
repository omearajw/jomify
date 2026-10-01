// One place that knows where music is playing. Two sources feed the same SDK-shaped
// playerStore.playbackState:
//   - this browser's Web Playback SDK, when Spotify says this browser is the active device
//     (events arrive instantly, no polling);
//   - GET /me/player polling, when playback lives on another device (the phone's Spotify app,
//     the PC, a speaker) and this page is a remote control.
// Every transport action goes to whichever of the two is live. Consumers never touch
// `player.*` directly any more, which is what lets the phone work at all: mobile browsers may
// refuse the SDK, and even when they run it the Spotify app is the better place to play.

import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { toast } from '../../store/toastStore';
import {
  fetchPlayerState, fetchDevices, transferPlayback, pausePlayback, resumePlayback,
  skipToNext, skipToPrevious, seekPlayback, setPlaybackVolume, setRepeatMode, toggleShuffleState
} from './api';
import { toSdkShape, toSdkTrack, resolveDeviceId, REPEAT_NAMES, describePlatform, playerNameFor, localDeviceLabel, sliderGain, startupGain } from './playbackAdapter';
import { isMobileViewport } from '../../hooks/useMediaQuery';
import { ensureFreshToken } from './session';
import { log } from '../debugLog';

const SDK_SCRIPT_ID = 'spotify-player-script';
const SDK_SCRIPT_SRC = 'https://sdk.scdn.co/spotify-player.js';
const SDK_READY_TIMEOUT_MS = 15000;
// The SDK device drops off Spotify Connect when a phone sleeps or the network flaps. Come back
// rather than leaving a dead player.
const SDK_RECONNECT_DELAY_MS = 2000;
// Attempts back off instead of running out. A phone leaves Connect every time it sleeps or the
// signal dips, and an evening of that used to exhaust a fixed budget of retries and leave the
// player dead until the app was reopened. Backing off keeps a genuinely broken player from
// spinning without ever giving up on one that would have come back.
const SDK_RECONNECT_MAX_DELAY_MS = 60000;
// A connection that lasted this long counts as good, so the next drop starts from the short delay
const SDK_STABLE_MS = 60000;
// How often returning to the app may spend a request checking the player is still on Connect
const SDK_ALIVE_CHECK_MS = 30000;
// A play tap in the first seconds after launch used to dead-end in a picker reporting no
// devices, while this browser's own player was still registering with Spotify Connect. Wait for
// it rather than asking a question the user cannot usefully answer.
const SDK_WAIT_FOR_DEVICE_MS = 8000;
// The player stops playing if it asks for a token and never gets one, so a slow renewal must
// not mean silence: past this we hand over the token we already hold
const SDK_TOKEN_DEADLINE_MS = 5000;

// Poll cadence while remote. Spotify's rate limit is shared with everything else the app does,
// so the fast tier only applies while someone is actually looking at the player.
const POLL_FAST_MS = 2000;
const POLL_NORMAL_MS = 5000;
const POLL_LOCAL_MS = 30000;
const POLL_MAX_BACKOFF_MS = 30000;
const REMOTE_REFRESH_DELAY_MS = 350;
const VOLUME_DEBOUNCE_MS = 250;

const PLATFORM = describePlatform();
// What Spotify Connect lists this browser as, everywhere; and what this browser calls itself
export const PLAYER_NAME = playerNameFor(PLATFORM);
const THIS_BROWSER = localDeviceLabel(PLATFORM);

const token = () => useUserStore.getState().token;
const player = () => usePlayerStore.getState();
const inCooldown = () => {
  const until = useUserStore.getState().apiCooldownUntil;
  return Boolean(until && Date.now() < until);
};
const interpolatedPosition = () => {
  const { playbackState, positionAt } = player();
  if (!playbackState) return 0;
  if (playbackState.paused) return playbackState.position;
  return Math.min(playbackState.duration || Infinity, playbackState.position + (Date.now() - positionAt));
};

let sdkInitialised = false;
let polling = false;
let pollTimer = null;
let backoffMs = 0;
let refreshInFlight = null;
let volumeTimer = null;
let activationInstalled = false;

// --- Remote state --------------------------------------------------------------------------

function applyRemoteState(state) {
  const store = player();
  if (state === null) {
    // Spotify answers 204 for a moment now and then, including while this browser's own player
    // is mid-song. The player itself is the authority on that, so believe it over the poll.
    if (store.isLocalActive && store.playbackState && !store.playbackState.paused) {
      log('playback', "Spotify reported nothing playing; believing this browser's player instead");
      return;
    }
    // Nothing active anywhere. Keep the last track on screen but show it stopped.
    if (store.activeDevice) log('playback', 'nothing playing on any device');
    store.setActiveDevice(null);
    store.setIsLocalActive(false);
    if (store.playbackState && !store.playbackState.paused) {
      store.setPlaybackState({ ...store.playbackState, paused: true, position: interpolatedPosition() });
    }
    return;
  }

  const device = state.device || null;
  const isLocal = Boolean(device?.id && device.id === store.deviceId);
  if ((device?.id || null) !== (store.activeDevice?.id || null)) {
    log('playback', 'playing on', device ? `${isLocal ? THIS_BROWSER : device.name} (${device.type})` : 'nothing');
  }
  store.setActiveDevice(device ? {
    id: device.id,
    name: isLocal ? THIS_BROWSER : device.name,
    type: device.type,
    isLocal,
    supportsVolume: device.supports_volume !== false,
    volumePercent: device.volume_percent ?? null
  } : null);
  store.setIsLocalActive(isLocal);
  if (isLocal) return; // the SDK's own events are richer and instant; don't fight them

  store.setRemoteVolume(device?.volume_percent ?? null);
  store.setPlaybackState(toSdkShape(state, store.playbackState));
}

export async function refreshRemoteState() {
  if (refreshInFlight) return refreshInFlight;
  const t = token();
  if (!t || inCooldown()) return null;
  refreshInFlight = (async () => {
    try {
      const state = await fetchPlayerState(t);
      backoffMs = 0;
      applyRemoteState(state);
      return state;
    } catch (err) {
      backoffMs = Math.min(POLL_MAX_BACKOFF_MS, (backoffMs || POLL_FAST_MS) * 2);
      if (err?.message !== 'RATE_LIMITED') console.debug('[playback] state refresh failed:', err?.message || err);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const refreshSoon = () => setTimeout(refreshRemoteState, REMOTE_REFRESH_DELAY_MS);

// Spotify needs a moment to report a song we just asked for, and the first answer is sometimes
// still the previous one, so ask twice. Without this the UI sat on the old song until the next
// scheduled poll, which is what made a screen showing both disagree with itself.
function confirmPlayback() {
  refreshSoon();
  setTimeout(refreshRemoteState, 1500);
}

// Show the song that was just asked for, without waiting to be told. Spotify takes a moment to
// report a change and until then every screen keeps naming the song before it, which is what
// made Sort mode's card and the controls under it disagree. confirmPlayback above replaces this
// with Spotify's own account a moment later.
function showTrackOptimistically(track) {
  const shaped = track?.uri ? toSdkTrack(track, `pending:${track.uri}`) : null;
  if (!shaped) return;
  const s = player();
  const window_ = { ...(s.playbackState?.track_window || {}), current_track: shaped };
  if (!s.playbackState) {
    s.setPlaybackState({
      paused: false, position: 0, duration: shaped.duration_ms, shuffle: false, repeat_mode: 0,
      context: null, timestamp: Date.now(), track_window: window_, remote: true
    });
    return;
  }
  patchState({ paused: false, position: 0, duration: shaped.duration_ms, track_window: window_ });
}

// Screens that show what is playing next to something else can ask for the quicker cadence, so
// the two do not sit disagreeing for a poll interval
let fastPollers = 0;
export function requestFastPlaybackUpdates() {
  fastPollers += 1;
  schedulePoll(POLL_FAST_MS);
  let released = false;
  return () => { if (released) return; released = true; fastPollers = Math.max(0, fastPollers - 1); };
}

function pollInterval() {
  if (backoffMs) return backoffMs;
  if (player().isLocalActive) return POLL_LOCAL_MS;
  if (fastPollers > 0) return POLL_FAST_MS;
  const { isNowPlayingOpen, isQueueOpen, isDevicePickerOpen } = useUserStore.getState();
  return (isNowPlayingOpen || isQueueOpen || isDevicePickerOpen) ? POLL_FAST_MS : POLL_NORMAL_MS;
}

function schedulePoll(delay = pollInterval()) {
  clearTimeout(pollTimer);
  if (!polling || (typeof document !== 'undefined' && document.hidden)) return;
  pollTimer = setTimeout(async () => {
    // The next poll is scheduled whatever happens to this one; a single request that never
    // settles used to end polling for the rest of the session
    try { if (token()) await refreshRemoteState(); }
    finally { schedulePoll(); }
  }, delay);
}

// Assigned once the SDK exists. A page frozen in the background can miss its own drop, so
// coming back to the app is the moment to make sure the player is still there.
let reviveLocalPlayer = null;

function onVisibilityChange() {
  if (document.hidden) clearTimeout(pollTimer);
  else {
    refreshRemoteState();
    schedulePoll();
    if (reviveLocalPlayer) reviveLocalPlayer().catch(() => {});
  }
}

// --- Local SDK -----------------------------------------------------------------------------

function initLocalPlayer() {
  if (sdkInitialised || typeof window === 'undefined') return;
  sdkInitialised = true;
  const store = player();
  store.setSdkStatus('loading');
  log('sdk', 'loading the player');

  let sdkPlayer = null;
  let readyTimer = null;
  let reconnectTimer = null;
  let attempts = 0;
  let readyAt = 0;
  let lastAliveCheckAt = 0;
  // Nothing is worth retrying after these two: the browser cannot run the player at all, or the
  // account may not use it. Every other failure is the network having a moment.
  let permanentlyFailed = false;

  // Each attempt waits longer than the last. Clearing the count on every 'ready' let a device
  // that dropped a second after connecting loop at the shortest delay, so it only clears once a
  // connection has actually held.
  const reconnectDelay = () => {
    if (readyAt && Date.now() - readyAt > SDK_STABLE_MS) attempts = 0;
    const delay = Math.min(SDK_RECONNECT_MAX_DELAY_MS, SDK_RECONNECT_DELAY_MS * 2 ** attempts);
    attempts += 1;
    return delay;
  };
  const reconnect = (delay = reconnectDelay()) => {
    log('sdk', 'reconnecting', `in ${delay}ms, attempt ${attempts}`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { sdkPlayer?.connect().catch(() => {}); }, delay);
  };
  const fail = (message, permanent = false) => {
    clearTimeout(reconnectTimer);
    clearTimeout(readyTimer);
    if (permanent) permanentlyFailed = true;
    if (player().sdkStatus === 'ready') return;
    player().setSdkStatus('failed', message);
    console.warn('[playback] Web Playback SDK unavailable:', message);
  };

  // Defined before the script is injected so the callback can never be missed
  window.onSpotifyWebPlaybackSDKReady = () => {
    sdkPlayer = new window.Spotify.Player({
      name: PLAYER_NAME,
      // The SDK asks for a token whenever it needs to renew the stream. Handing it the stored
      // one meant handing it an expired one after an hour asleep, which Spotify answers with an
      // authentication error and the player dies mid-song. Renew first, every time.
      getOAuthToken: (cb) => {
        let answered = false;
        const answer = (value, how) => {
          if (answered) return;
          answered = true;
          log('sdk', 'player asked for a token', how);
          cb(value || useUserStore.getState().token);
        };
        // Answer with the stored token rather than leave the player waiting. A token that turns
        // out to be expired raises authentication_error, which recovers below; no answer at all
        // is silence with nothing to recover from.
        const deadline = setTimeout(() => answer(null, 'renewal too slow, gave it the stored one'), SDK_TOKEN_DEADLINE_MS);
        ensureFreshToken()
          .then((fresh) => { clearTimeout(deadline); answer(fresh, 'gave it a current token'); })
          .catch((err) => { clearTimeout(deadline); answer(null, `renewal failed (${err?.message || err}), gave it the stored one`); });
      },
      // Phones have no volume slider, so the hardware buttons own loudness and the player runs
      // at full gain; the stored desktop setting used to make them quiet with no way to fix it
      volume: startupGain(useUserStore.getState().savedVolume, !isMobileViewport())
    });

    sdkPlayer.addListener('ready', async ({ device_id }) => {
      clearTimeout(readyTimer);
      clearTimeout(reconnectTimer);
      readyAt = Date.now();
      log('sdk', 'ready on Spotify Connect', `device ${String(device_id).slice(0, 8)}`);
      const s = player();
      s.setDeviceId(device_id);
      s.setSdkStatus('ready');

      // Apply the volume again once ready; the SDK sometimes starts at its own default regardless
      sdkPlayer.setVolume(startupGain(useUserStore.getState().savedVolume, !isMobileViewport())).catch(() => {});

      // Take over playback only when nothing is playing anywhere. Grabbing it unconditionally
      // (the old behaviour) would yank a phone's Spotify app to silence every time the PWA opened.
      const t = token();
      if (!t) return;
      let state;
      try { state = await fetchPlayerState(t); } catch { return; }
      if (state === null) transferPlayback(t, device_id, false).catch(() => {});
      else applyRemoteState(state);
    });

    sdkPlayer.addListener('not_ready', () => {
      log('sdk', 'dropped off Spotify Connect');
      const s = player();
      if (s.isLocalActive) { s.setIsLocalActive(false); refreshSoon(); }
      reconnect();
    });

    sdkPlayer.addListener('player_state_changed', (state) => {
      const s = player();
      const before = s.playbackState;
      if (!state && s.isLocalActive) log('playback', 'this browser stopped being the device playing');
      if (state) {
        const track = state.track_window?.current_track;
        if (track?.uri !== before?.track_window?.current_track?.uri) {
          log('playback', 'now playing', `${track?.name || '?'} by ${track?.artists?.map((a) => a.name).join(', ') || '?'}`);
        } else if (Boolean(state.paused) !== Boolean(before?.paused)) {
          log('playback', state.paused ? 'paused' : 'resumed', `at ${Math.round((state.position || 0) / 1000)}s of ${Math.round((state.duration || 0) / 1000)}s`);
        }
      }
      if (!state) {
        // The SDK reports null when this device stops being the active one
        if (s.isLocalActive) { s.setIsLocalActive(false); refreshSoon(); }
        return;
      }
      s.setPlaybackState(state);
      syncMediaSession(state);
      if (!s.isLocalActive) {
        log('playback', 'playing on', `${THIS_BROWSER} (this device)`);
        s.setIsLocalActive(true);
        s.setActiveDevice({ id: s.deviceId, name: THIS_BROWSER, type: 'Computer', isLocal: true, supportsVolume: true, volumePercent: null });
      }
    });

    // A browser that cannot run the player and an account that cannot use it are both permanent
    for (const event of ['initialization_error', 'account_error']) {
      sdkPlayer.addListener(event, ({ message }) => fail(`${event}: ${message}`, true));
    }

    // An expired token is not permanent: renew it and reconnect instead of killing the player
    sdkPlayer.addListener('authentication_error', ({ message }) => {
      console.warn('[playback] SDK token rejected; renewing and reconnecting');
      // A token Spotify keeps rejecting must not mean a tight loop of renewals, so the retry
      // waits the same growing delay as any other reconnect
      const delay = reconnectDelay();
      ensureFreshToken({ force: true })
        .then(() => reconnect(delay))
        .catch(() => fail(`authentication_error: ${message}`));
    });
    sdkPlayer.addListener('playback_error', ({ message }) => console.warn('[playback] SDK playback error:', message));
    // The browser refused to start audio (a play command from Spotify's servers counts as
    // autoplay on iOS). The element was activated in the tap that asked for the song, so one
    // resume usually goes through; only if it doesn't is the user asked to tap play.
    sdkPlayer.addListener('autoplay_failed', () => {
      log('sdk', 'browser refused to start audio by itself; retrying');
      sdkPlayer.resume().catch(() => {});
      setTimeout(() => {
        if (player().playbackState?.paused !== false) toast('Tap play to start audio in this browser', { tone: 'info' });
      }, 600);
    });

    reviveLocalPlayer = async () => {
      // Still starting up: the first connect is in flight and has its own deadline
      if (permanentlyFailed || !sdkPlayer || player().sdkStatus === 'loading') return;
      if (player().sdkStatus === 'ready') {
        // Still believed to be connected, which a page that was frozen mid-drop would also
        // believe. Spotify's device list is the only reliable word on whether it is really there.
        const id = player().deviceId;
        if (!id || Date.now() - lastAliveCheckAt < SDK_ALIVE_CHECK_MS) return;
        lastAliveCheckAt = Date.now();
        if ((await refreshDevices()).some(d => d.id === id)) { log('sdk', 'back in the app: player still on Spotify Connect'); return; }
        log('sdk', 'back in the app: player had silently left Spotify Connect, reconnecting');
      } else {
        log('sdk', `back in the app: player was ${player().sdkStatus}, reconnecting`);
      }
      // The user is looking at the app, so connect now rather than waiting out a backoff
      clearTimeout(reconnectTimer);
      sdkPlayer.connect().catch(() => {});
    };

    readyTimer = setTimeout(() => fail('the player did not become ready in time'), SDK_READY_TIMEOUT_MS);
    sdkPlayer.connect().then((ok) => { if (!ok) fail('connect() was refused'); }).catch((err) => fail(String(err)));
    store.setPlayer(sdkPlayer);
  };

  if (!document.getElementById(SDK_SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SCRIPT_SRC;
    script.async = true;
    script.onerror = () => fail('the SDK script could not be loaded');
    document.body.appendChild(script);
  } else if (window.Spotify) {
    window.onSpotifyWebPlaybackSDKReady();
  }
}

// Browsers (iOS in particular) only let media start from inside a user gesture. The SDK exposes
// activateElement() for exactly this; it has to run synchronously in the handler, before any
// await. It is called from the first gesture on the page and again at the start of every play
// action, since Safari on iOS can forget the activation between taps. Installed on capture so
// no stopPropagation can hide it.
export function activateLocalPlayer() {
  const s = player();
  const sdkPlayer = s.player;
  if (!sdkPlayer?.activateElement) return;
  // Only worth doing before this browser starts making sound. Called while the SDK is already
  // playing, it re-primes the audio element, which is what made a track run silent and then
  // restart a few seconds later.
  if (s.isLocalActive && s.playbackState && !s.playbackState.paused) return;
  try { sdkPlayer.activateElement(); } catch { /* not fatal */ }
}

function installActivation() {
  if (activationInstalled || typeof document === 'undefined') return;
  activationInstalled = true;
  const onFirstGesture = () => {
    const sdkPlayer = player().player;
    if (!sdkPlayer?.activateElement) return; // keep listening until the player exists
    try { sdkPlayer.activateElement(); } catch { /* not fatal */ }
    document.removeEventListener('pointerdown', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);
  };
  document.addEventListener('pointerdown', onFirstGesture, true);
  document.addEventListener('keydown', onFirstGesture, true);
}

// --- Media Session -------------------------------------------------------------------------
// Lock screen, Bluetooth displays and headset buttons. Only meaningful while this device plays
// audio (the SDK); when playback lives elsewhere the phone has no media session to show.

let mediaSessionInstalled = false;

function installMediaSession() {
  if (mediaSessionInstalled || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  mediaSessionInstalled = true;
  const ms = navigator.mediaSession;
  const handlers = [
    ['play', () => { if (player().playbackState?.paused) togglePlay(); }],
    ['pause', () => { if (player().playbackState && !player().playbackState.paused) togglePlay(); }],
    ['previoustrack', () => previous()],
    ['nexttrack', () => next()],
    ['seekto', (d) => { if (typeof d?.seekTime === 'number') seek(d.seekTime * 1000); }],
    ['seekbackward', (d) => seek(Math.max(0, interpolatedPosition() - (d?.seekOffset || 10) * 1000))],
    ['seekforward', (d) => seek(interpolatedPosition() + (d?.seekOffset || 10) * 1000)]
  ];
  for (const [action, handler] of handlers) {
    // A pause from here is the phone's doing (a headset unplugged, another app taking audio),
    // which is worth telling apart from the music simply stopping
    const logged = (details) => { log('media session', action); handler(details); };
    try { ms.setActionHandler(action, logged); } catch { /* action not supported here */ }
  }
}

function syncMediaSession(state) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const track = state?.track_window?.current_track;
  if (!track) { ms.metadata = null; return; }
  try {
    ms.metadata = new MediaMetadata({
      title: track.name || '',
      artist: (track.artists || []).map(a => a.name).join(', '),
      album: track.album?.name || '',
      artwork: (track.album?.images || [])
        .filter(i => i?.url)
        .map(i => ({ src: i.url, sizes: i.width && i.height ? `${i.width}x${i.height}` : '640x640', type: 'image/jpeg' }))
    });
    ms.playbackState = state.paused ? 'paused' : 'playing';
    if (typeof ms.setPositionState === 'function' && state.duration > 0) {
      ms.setPositionState({ duration: state.duration / 1000, position: Math.min(state.position, state.duration) / 1000, playbackRate: 1 });
    }
  } catch (err) {
    console.debug('[playback] media session update failed:', err?.message || err);
  }
}

// --- Lifecycle -----------------------------------------------------------------------------

export function startPlaybackController() {
  initLocalPlayer();
  installActivation();
  installMediaSession();
  if (!polling) {
    polling = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    refreshRemoteState();
    schedulePoll();
  }
  return () => {
    polling = false;
    clearTimeout(pollTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

// --- Actions -------------------------------------------------------------------------------

export function handlePlaybackError(err) {
  if (!err) return;
  log('playback', 'request failed', err.code || err.message);
  if (err.message === 'RATE_LIMITED') {
    // A tap during the cooldown used to do nothing at all, which reads as a broken button
    const until = useUserStore.getState().apiCooldownUntil;
    const seconds = until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 10;
    toast(`Spotify is rate-limiting Jomify. Try again in ${seconds}s`, { tone: 'error' });
    return;
  }
  if (err.code === 'NO_ACTIVE_DEVICE') {
    useUserStore.getState().setDevicePickerOpen(true);
    return;
  }
  if (err.code === 'PREMIUM_REQUIRED') {
    toast('Spotify Premium is needed to control playback', { tone: 'error' });
    return;
  }
  console.error(err);
}

// The device a play request should target, or null after opening the picker so the user can
// choose one. Replaces the old `if (!deviceId) return` guards that silently did nothing.
export function resolvePlaybackDeviceId() {
  const target = pickDevice();
  if (!target) useUserStore.getState().setDevicePickerOpen(true);
  return target;
}

// The device the user last chose. Spotify only reports an active device once it has actually
// started playing, so without this a second tap during those few seconds looked like "nowhere to
// play" all over again and reopened the picker.
let preferredDeviceId = null;

export function rememberDevice(deviceId) {
  if (deviceId) preferredDeviceId = deviceId;
}

// Where a play should go without troubling the user: whatever is already playing, this browser's
// own player, the last device they chose, or the only one there is.
function pickDevice() {
  const direct = resolveDeviceId(player());
  if (direct) return direct;
  const devices = player().devices || [];
  if (preferredDeviceId && devices.some((d) => d.id === preferredDeviceId)) return preferredDeviceId;
  if (devices.length === 1) return devices[0].id;
  return null;
}

// Resolves with this browser's device id once the player has registered, or null if it does not
// within the wait. The store is the only thing that knows, so watch it rather than poll.
function waitForLocalDevice(ms = SDK_WAIT_FOR_DEVICE_MS) {
  const readyId = () => {
    const s = player();
    return s.sdkStatus === 'ready' && s.deviceId ? s.deviceId : null;
  };
  const already = readyId();
  if (already) return Promise.resolve(already);
  if (player().sdkStatus === 'failed') return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (value) => { clearTimeout(timer); unsubscribe(); resolve(value); };
    const timer = setTimeout(() => finish(null), ms);
    const unsubscribe = usePlayerStore.subscribe(() => {
      const id = readyId();
      if (id) finish(id);
      else if (player().sdkStatus === 'failed') finish(null);
    });
  });
}

// --- Starting playback -----------------------------------------------------------------------
// A play request that finds no device used to open the picker and forget the song, so choosing
// a device there merely made it active and silent. The request is parked instead and re-run on
// whichever device is picked; /me/player/play?device_id starts an idle device directly, so no
// transfer is needed first.
let pendingPlay = null;

function parkPlay(play) {
  log('playback', 'no device to play on; asked where to play');
  pendingPlay = play;
  useUserStore.getState().setDevicePickerOpen(true);
}

export async function playOn(play, { track } = {}) {
  activateLocalPlayer(); // synchronously, while still inside the tap
  if (!token()) return;

  // Name the song straight away. Finding a device can take a round trip, and a tap that shows
  // nothing for half a second reads as a button that did not work.
  showTrackOptimistically(track);

  let target = pickDevice();
  if (!target) {
    // The device list goes stale between plays; ask Spotify before bothering the user, since
    // the answer is often "there is only one, use that"
    await refreshDevices();
    target = pickDevice();
  }
  if (!target) {
    // Just after launch the only device that will ever appear is this browser's own player,
    // still registering with Spotify Connect.
    log('playback', "nowhere to play yet; waiting for this browser's player");
    target = await waitForLocalDevice();
    log('playback', target ? "this browser's player arrived" : "this browser's player did not arrive in time");
  }
  if (!target) { parkPlay(play); return; }

  try {
    await play(target);
    rememberDevice(target);
    confirmPlayback();
  } catch (err) {
    // Whatever was shown optimistically was a guess; let Spotify correct it
    refreshSoon();
    if (err?.code !== 'NO_ACTIVE_DEVICE') { handlePlaybackError(err); return; }

    // Whatever we aimed at has gone away. Forget it, look again, and only ask if there is a
    // real choice to make; this is the loop where picking a device led straight back to the
    // picker on the next tap.
    if (preferredDeviceId === target) preferredDeviceId = null;
    await refreshDevices();
    const retry = pickDevice();
    if (retry && retry !== target) {
      try {
        await play(retry);
        rememberDevice(retry);
        confirmPlayback();
        return;
      } catch { /* fall through to the picker */ }
    }
    parkPlay(play);
  }
}

export const hasPendingPlay = () => pendingPlay !== null;
export function clearPendingPlay() { pendingPlay = null; }

export async function playPendingOn(deviceId) {
  activateLocalPlayer();
  rememberDevice(deviceId);
  const play = pendingPlay;
  pendingPlay = null;
  if (!play || !deviceId) return false;
  try {
    await play(deviceId);
  } catch (err) {
    handlePlaybackError(err);
    return false;
  }
  if (deviceId !== player().deviceId) player().setIsLocalActive(false);
  setTimeout(refreshRemoteState, 600);
  setTimeout(refreshDevices, 800);
  return true;
}

const localSdk = () => {
  const s = player();
  return s.isLocalActive && s.player ? s.player : null;
};

const patchState = (patch) => {
  const s = player();
  if (s.playbackState) s.setPlaybackState({ ...s.playbackState, position: interpolatedPosition(), ...patch });
};

async function remote(action, optimistic) {
  const t = token();
  if (!t) return;
  if (optimistic) optimistic();
  try {
    await action(t, player().activeDevice?.id || null);
    refreshSoon();
  } catch (err) {
    handlePlaybackError(err);
    refreshSoon();
  }
}

export function togglePlay() {
  activateLocalPlayer();
  const sdk = localSdk();
  log('transport', player().playbackState?.paused ? 'play' : 'pause', sdk ? 'this browser' : 'remote device');
  if (sdk) return sdk.togglePlay().catch(console.error);
  const paused = player().playbackState?.paused ?? true;
  return remote(paused ? resumePlayback : pausePlayback, () => patchState({ paused: !paused }));
}

export function next() {
  activateLocalPlayer();
  const sdk = localSdk();
  log('transport', 'next', sdk ? 'this browser' : 'remote device');
  if (sdk) return sdk.nextTrack().catch(console.error);
  return remote(skipToNext);
}

export function previous() {
  activateLocalPlayer();
  const sdk = localSdk();
  log('transport', 'previous', sdk ? 'this browser' : 'remote device');
  if (sdk) return sdk.previousTrack().catch(console.error);
  return remote(skipToPrevious);
}

export function seek(positionMs) {
  const sdk = localSdk();
  if (sdk) return sdk.seek(positionMs).catch(console.error);
  return remote((t, d) => seekPlayback(t, positionMs, d), () => patchState({ position: positionMs }));
}

// Slider value 0-100 -> audible level. Locally the cubic curve makes the slider feel linear;
// remote devices take the percentage as-is.
export function setVolume(percent) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const s = player();
  if (s.isLocalActive) {
    useUserStore.getState().setSavedVolume(clamped);
    s.player?.setVolume(sliderGain(clamped)).catch(() => {});
    return;
  }
  s.setRemoteVolume(clamped);
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    const t = token();
    if (t) setPlaybackVolume(t, clamped, player().activeDevice?.id || null).catch(handlePlaybackError);
  }, VOLUME_DEBOUNCE_MS);
}

// Shuffle and repeat have no SDK setters; they always go through the Web API, with the flip
// shown immediately and undone if Spotify refuses.
export function setShuffle(on, deviceId = null) {
  const t = token();
  const s = player();
  const nextValue = Boolean(on);
  if (!t || s.isShuffled === nextValue) return Promise.resolve();
  const previous_ = s.isShuffled;
  s.setShufflePending(true);
  s.setShuffle(nextValue);
  return toggleShuffleState(t, deviceId || s.activeDevice?.id || null, nextValue)
    .catch((err) => { handlePlaybackError(err); player().setShuffle(previous_); throw err; })
    .finally(() => { player().setShufflePending(false); if (!player().isLocalActive) refreshSoon(); });
}

export function toggleShuffle() {
  return setShuffle(!player().isShuffled).catch(() => {});
}

export function cycleRepeat() {
  const t = token();
  const s = player();
  if (!t) return;
  const previousMode = s.repeatMode;
  const nextMode = (previousMode + 1) % REPEAT_NAMES.length;
  s.setRepeatMode(nextMode);
  setRepeatMode(t, REPEAT_NAMES[nextMode], s.activeDevice?.id || null)
    .catch((err) => { handlePlaybackError(err); player().setRepeatMode(previousMode); });
}

export async function refreshDevices() {
  const t = token();
  if (!t || inCooldown()) return [];
  try {
    const devices = await fetchDevices(t);
    player().setDevices(devices.map(d => ({
      id: d.id,
      name: d.id === player().deviceId ? THIS_BROWSER : d.name,
      type: d.type,
      isActive: Boolean(d.is_active),
      supportsVolume: d.supports_volume !== false,
      volumePercent: d.volume_percent ?? null,
      isLocal: d.id === player().deviceId
    })));
    return player().devices;
  } catch (err) {
    if (err?.message !== 'RATE_LIMITED') console.debug('[playback] device list failed:', err?.message || err);
    return player().devices;
  }
}

export async function transferTo(deviceId, { play } = {}) {
  const t = token();
  if (!t || !deviceId) return;
  rememberDevice(deviceId);
  const s = player();
  const shouldPlay = typeof play === 'boolean' ? play : Boolean(s.playbackState && !s.playbackState.paused);
  try {
    await transferPlayback(t, deviceId, shouldPlay);
    // The SDK announces itself through player_state_changed; anything else shows up on the next poll
    if (deviceId !== s.deviceId) { s.setIsLocalActive(false); }
    setTimeout(refreshRemoteState, 600);
    setTimeout(refreshDevices, 800);
  } catch (err) {
    handlePlaybackError(err);
  }
}
