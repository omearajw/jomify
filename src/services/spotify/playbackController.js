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
import { toSdkShape, resolveDeviceId, REPEAT_NAMES, describePlatform, playerNameFor, localDeviceLabel } from './playbackAdapter';

const SDK_SCRIPT_ID = 'spotify-player-script';
const SDK_SCRIPT_SRC = 'https://sdk.scdn.co/spotify-player.js';
const SDK_READY_TIMEOUT_MS = 15000;

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
    // Nothing active anywhere. Keep the last track on screen but show it stopped.
    store.setActiveDevice(null);
    store.setIsLocalActive(false);
    if (store.playbackState && !store.playbackState.paused) {
      store.setPlaybackState({ ...store.playbackState, paused: true, position: interpolatedPosition() });
    }
    return;
  }

  const device = state.device || null;
  const isLocal = Boolean(device?.id && device.id === store.deviceId);
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

function pollInterval() {
  if (backoffMs) return backoffMs;
  if (player().isLocalActive) return POLL_LOCAL_MS;
  const { isNowPlayingOpen, isQueueOpen, isDevicePickerOpen } = useUserStore.getState();
  return (isNowPlayingOpen || isQueueOpen || isDevicePickerOpen) ? POLL_FAST_MS : POLL_NORMAL_MS;
}

function schedulePoll(delay = pollInterval()) {
  clearTimeout(pollTimer);
  if (!polling || (typeof document !== 'undefined' && document.hidden)) return;
  pollTimer = setTimeout(async () => {
    if (token()) await refreshRemoteState();
    schedulePoll();
  }, delay);
}

function onVisibilityChange() {
  if (document.hidden) clearTimeout(pollTimer);
  else { refreshRemoteState(); schedulePoll(); }
}

// --- Local SDK -----------------------------------------------------------------------------

function initLocalPlayer() {
  if (sdkInitialised || typeof window === 'undefined') return;
  sdkInitialised = true;
  const store = player();
  store.setSdkStatus('loading');

  let readyTimer = null;
  const fail = (message) => {
    clearTimeout(readyTimer);
    if (player().sdkStatus === 'ready') return;
    player().setSdkStatus('failed', message);
    console.warn('[playback] Web Playback SDK unavailable:', message);
  };

  // Defined before the script is injected so the callback can never be missed
  window.onSpotifyWebPlaybackSDKReady = () => {
    const sdkPlayer = new window.Spotify.Player({
      name: PLAYER_NAME,
      // Read the token live so a refreshed token flows through without a reconnect
      getOAuthToken: (cb) => cb(useUserStore.getState().token),
      volume: 0.5
    });

    sdkPlayer.addListener('ready', async ({ device_id }) => {
      clearTimeout(readyTimer);
      const s = player();
      s.setDeviceId(device_id);
      s.setSdkStatus('ready');

      // Apply the persisted volume; the SDK starts at its own default regardless of the slider.
      // The cubic curve must match setVolume below.
      const savedVolume = useUserStore.getState().savedVolume;
      if (typeof savedVolume === 'number') sdkPlayer.setVolume(Math.pow(savedVolume / 100, 3)).catch(() => {});

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
      const s = player();
      if (s.isLocalActive) { s.setIsLocalActive(false); refreshSoon(); }
    });

    sdkPlayer.addListener('player_state_changed', (state) => {
      const s = player();
      if (!state) {
        // The SDK reports null when this device stops being the active one
        if (s.isLocalActive) { s.setIsLocalActive(false); refreshSoon(); }
        return;
      }
      s.setPlaybackState(state);
      syncMediaSession(state);
      if (!s.isLocalActive) {
        s.setIsLocalActive(true);
        s.setActiveDevice({ id: s.deviceId, name: THIS_BROWSER, type: 'Computer', isLocal: true, supportsVolume: true, volumePercent: null });
      }
    });

    for (const event of ['initialization_error', 'authentication_error', 'account_error']) {
      sdkPlayer.addListener(event, ({ message }) => fail(`${event}: ${message}`));
    }
    sdkPlayer.addListener('playback_error', ({ message }) => console.warn('[playback] SDK playback error:', message));
    sdkPlayer.addListener('autoplay_failed', () => {
      toast('Tap play to start audio in this browser', { tone: 'info' });
    });

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
// await, and once is enough per page. Installed on capture so no stopPropagation can hide it.
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
    try { ms.setActionHandler(action, handler); } catch { /* action not supported here */ }
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
  const target = resolveDeviceId(player());
  if (!target) useUserStore.getState().setDevicePickerOpen(true);
  return target;
}

// --- Starting playback -----------------------------------------------------------------------
// A play request that finds no device used to open the picker and forget the song, so choosing
// a device there merely made it active and silent. The request is parked instead and re-run on
// whichever device is picked; /me/player/play?device_id starts an idle device directly, so no
// transfer is needed first.
let pendingPlay = null;

function parkPlay(play) {
  pendingPlay = play;
  useUserStore.getState().setDevicePickerOpen(true);
}

export async function playOn(play) {
  if (!token()) return;
  const target = resolveDeviceId(player());
  if (!target) { parkPlay(play); return; }
  try {
    await play(target);
  } catch (err) {
    if (err?.code === 'NO_ACTIVE_DEVICE') parkPlay(play);
    else handlePlaybackError(err);
  }
}

export const hasPendingPlay = () => pendingPlay !== null;
export function clearPendingPlay() { pendingPlay = null; }

export async function playPendingOn(deviceId) {
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
  const sdk = localSdk();
  if (sdk) return sdk.togglePlay().catch(console.error);
  const paused = player().playbackState?.paused ?? true;
  return remote(paused ? resumePlayback : pausePlayback, () => patchState({ paused: !paused }));
}

export function next() {
  const sdk = localSdk();
  if (sdk) return sdk.nextTrack().catch(console.error);
  return remote(skipToNext);
}

export function previous() {
  const sdk = localSdk();
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
    s.player?.setVolume(Math.pow(clamped / 100, 3)).catch(() => {});
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
