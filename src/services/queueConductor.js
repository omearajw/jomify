// Jomify's queue, carried out. Spotify's queue lives on the device, and a reconnect, a device
// change, a new playlist or a skip in the wrong moment loses it. So Jomify keeps the order
// (store/queueStore.js) and hands Spotify one song at a time: the head of the queue, fifteen
// seconds before the current song ends, or the moment before a skip. A handed-over song is
// confirmed when it is heard playing; one that Spotify forgot is handed over again.
//
// Only one of the listener's devices carries the queue out. The device the music plays on does
// it (its own player is the active device); another Jomify playing means that one does it and
// this one stands down; with the music on a device that is no Jomify (an Alexa, the Spotify app)
// or on nothing, the devices share a lease from the server and the holder does it. A device in a
// party stands down altogether: the party conductor runs the music there.
import { usePlayerStore } from '../store/playerStore';
import { useUserStore } from '../store/userStore';
import { useQueueStore } from '../store/queueStore';
import { usePartyStore } from '../store/partyStore';
import { addToQueue, fetchQueue, playUris } from './spotify/api';
import { askLease } from './queueLease';
import { positionNow } from '../lib/playbackClock';
import { log } from './debugLog';
import { feedDue, resolveFed, isItem, indexOfTrack } from './queueLogic';

const TICK_MS = 1000;
const LEASE_RENEW_MS = 10000;
let timer = null;
let lease = { held: null, at: 0, asking: null }; // the server's answer, and when
let fed = null;         // { item, at }: the song handed to Spotify, awaiting its start
let feeding = null;     // the hand-over in flight
let lastFailAt = 0;
let suspended = false;

const player = () => usePlayerStore.getState();
const token = () => useUserStore.getState().token;
const queue = () => useQueueStore.getState();
const currentTrack = () => player().playbackState?.track_window?.current_track || null;
const deviceId = () => player().activeDevice?.id || null;

export const handedOver = () => fed?.item || null;

const isJomifyDevice = (d) => Boolean(d?.name && /^Jomify\b/.test(d.name));

// Whether this device carries out the queue right now (see the note at the top)
export async function inCharge() {
  if (suspended || usePartyStore.getState().code) return false;
  const p = player();
  if (p.isLocalActive) return true;
  if (p.activeDevice && !p.activeDevice.isLocal && isJomifyDevice(p.activeDevice)) return false;
  const now = Date.now();
  if (now - lease.at > LEASE_RENEW_MS && !lease.asking) {
    lease.asking = askLease(queue().instanceId).then((held) => { lease = { held, at: Date.now(), asking: null }; if (held === false) fed = null; });
  }
  if (lease.held === null && lease.at === 0) await lease.asking;
  // the server could not say: carry on rather than let the music stop
  return lease.held !== false;
}

// Is the song already waiting in Spotify's queue? Then it need not be handed over twice
async function alreadyQueued(t, item) {
  try {
    const q = await fetchQueue(t);
    return (q?.queue || []).some((x) => isItem(x, item));
  } catch { return false; }
}

async function waitForQueued(t, item) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await alreadyQueued(t, item)) return true;
  }
  log('queue', `Spotify's queue never showed ${item.name}`);
  return false;
}

// Hand the head of the queue to Spotify
async function feed(reason, { waitUntilQueued = false } = {}) {
  if (feeding) return feeding;
  const t = token();
  const item = queue().items[0];
  if (!t || !item || fed) return null;
  feeding = (async () => {
    try {
      if (await alreadyQueued(t, item)) {
        fed = { item, at: Date.now() };
        log('queue', `${item.name} is already waiting with Spotify`, reason);
        return item;
      }
      await addToQueue(t, deviceId(), item.uri);
      fed = { item, at: Date.now() };
      log('queue', `handed ${item.name} to Spotify`, reason);
      if (waitUntilQueued) await waitForQueued(t, item);
      return item;
    } catch (err) {
      lastFailAt = Date.now();
      log('queue', `Spotify refused ${item.name}`, err?.message || String(err));
      return null;
    } finally {
      feeding = null;
    }
  })();
  return feeding;
}

// A song that has started: if it is one of ours it leaves the queue, handed over or not (it may
// have been started from the panel, or by another device)
export function onNowPlaying(track) {
  if (!track) return;
  const q = queue();
  const at = indexOfTrack(q.items, track);
  if (at >= 0) { q.remove(q.items[at].key); log('queue', `${track.name} started; ${q.items.length - 1} left in the queue`); }
  if (fed && isItem(track, fed.item)) fed = null;
}

// Spotify's copy of the queue is gone or in doubt: whatever was handed over is handed over again
// when it is due (a song Spotify did keep is found waiting and not sent twice)
export function onDeviceReset(why) {
  if (!fed) return;
  log('queue', `${fed.item.name} will be handed over again`, why);
  fed = null;
}

async function tick() {
  if (suspended || !token()) return;
  if (!(await inCharge())) return;
  const now = Date.now();
  const cur = currentTrack();
  if (fed) {
    const r = resolveFed(fed, cur, now);
    if (r === 'played') { onNowPlaying(cur); }
    else if (r === 'timeout') {
      // still waiting with Spotify: give it longer; gone: hand it over again when due
      if (await alreadyQueued(token(), fed.item)) fed.at = now;
      else { log('queue', `Spotify lost ${fed.item.name}; it will be handed over again`); fed = null; }
    }
  }
  const items = queue().items;
  if (!items.length) return;
  if (feedDue({ state: player().playbackState, posMs: positionNow(), now, fed, items, lastFailAt })) await feed('nearly over');
}

// Something was just queued: with nothing playing at all, start it now rather than wait for a
// song end that is not coming
export async function nudge() {
  if (suspended || usePartyStore.getState().code) return;
  const t = token();
  const item = queue().items[0];
  const st = player().playbackState;
  if (!t || !item || (st && st.track_window?.current_track)) return;
  try {
    await playUris(t, deviceId(), [item.uri], 0);
    log('queue', `nothing was playing; started ${item.name}`);
  } catch (err) { log('queue', `could not start ${item.name}`, err?.message || String(err)); }
}

// Before a skip: the next song goes in first, so the skip lands on it and not on the playlist.
// The skip was pressed here, so this device acts even without the lease.
export async function beforeSkip() {
  if (suspended || usePartyStore.getState().code || fed || !queue().items.length) return;
  await feed('skip', { waitUntilQueued: true });
}

// After a skip: Spotify can still land on the playlist's next song. Only its own queue says so
// reliably: when the handed-over song is still waiting at the front, skip once more.
export function afterSkip(skipAgain) {
  const wanted = fed?.item || null;
  if (!wanted) return;
  setTimeout(async () => {
    const t = token();
    if (!t) return;
    const q = await fetchQueue(t).catch(() => null);
    if (!q) return;
    if (isItem(q.currently_playing, wanted)) return;
    if (isItem(q.queue?.[0], wanted)) { log('queue', `the skip landed before ${wanted.name}; skipping once more`); skipAgain(); }
  }, 2500);
}

export function setSuspended(on) {
  suspended = Boolean(on);
  if (on) fed = null;
}

export function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch((err) => log('queue', 'tick failed', err?.message || String(err))); }, TICK_MS);
}
export function stop() {
  clearInterval(timer); timer = null; fed = null; feeding = null;
  if (lease.held) askLease(queue().instanceId, { release: true });
  lease = { held: null, at: 0, asking: null };
}
