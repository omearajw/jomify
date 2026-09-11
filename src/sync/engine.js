import { shallow } from 'zustand/shallow';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import { pullDoc, pushDoc, SyncApiError } from '../services/sync/client';
import { mergeSyncDoc, isFolderLive } from './mergeSyncDoc';
import { storeToDoc, docToStore, docToMetaClocks, docHasContent } from './transform';
import {
  getMeta, saveMeta, resetMeta, setServerTime, syncNow,
  getDeviceId, getDataOwnerId, setDataOwnerId, markPinDeleted
} from './meta';

const PUSH_DEBOUNCE_MS = 1500;
const PUSH_MAX_WAIT_MS = 10000;
const PULL_THROTTLE_MS = 30000;
const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60000;

// --- module state -----------------------------------------------------------

let running = false;
let userId = null;
let unsubscribeStore = null;

// Nothing may be pushed until this session has completed a pull. Belt and braces on top of the
// server-side guarantee that a merge can never delete: even if the client were badly wrong, it
// would have to get past this first.
let pushUnlocked = false;

// Set while a remote document is being written into the store, so the change tracker can tell
// "the server told us this" apart from "the user did this".
let isApplyingRemote = false;

// A first-sync pull whose merge is waiting on the user to choose (both sides had folders).
// While it's set, no pull may apply and no push may run.
let pendingConflict = null;

let debounceTimer = null;
let maxWaitTimer = null;
let backoffTimer = null;
let backoffMs = BACKOFF_START_MS;
let lastPullAt = 0;
let dirty = false;
let inFlight = false;

// --- change tracking --------------------------------------------------------

const FOLDER_FIELD_MAP = [
  ['name', (f) => f.name],
  ['parentId', (f) => f.parentId ?? null],
  ['order', (f) => f.order ?? 0],
  ['items', (f) => JSON.stringify(f.playlistIds ?? [])]
];

function stampChanges(prev, next) {
  const at = syncNow();
  const meta = getMeta();
  const folders = { ...meta.folders };
  const patch = {};
  let changed = false;

  // --- folders: stamp only the fields that actually moved ---
  const prevById = new Map((prev.customFolders || []).map(f => [f.id, f]));
  for (const folder of next.customFolders || []) {
    const before = prevById.get(folder.id);
    const existing = folders[folder.id] || { name: 0, parentId: 0, order: 0, items: 0 };
    const updated = { ...existing };
    let touched = false;

    for (const [field, read] of FOLDER_FIELD_MAP) {
      if (!before || read(before) !== read(folder)) {
        updated[field] = at;
        touched = true;
      }
    }

    if (touched) {
      folders[folder.id] = updated;
      changed = true;
    }
  }

  // Folder REMOVALS are deliberately not inferred here. deleteFolder in userStore.js is the only
  // folder-removal path in the app and mints its own tombstone. Inferring a removal from a diff
  // is the one way a false tombstone could arise, and a false tombstone would delete a real
  // folder on every device at once.
  if (changed) patch.folders = folders;

  // --- pins: additions stamped, removals tombstoned (with a sanity clamp) ---
  const prevPinIds = new Set((prev.pinnedItems || []).map(p => p.id));
  const nextPinIds = new Set((next.pinnedItems || []).map(p => p.id));

  const pins = { ...meta.pins };
  let pinsChanged = false;
  for (const id of nextPinIds) {
    if (!prevPinIds.has(id) || pins[id] === undefined) {
      pins[id] = at;
      pinsChanged = true;
    }
  }
  if (pinsChanged) patch.pins = pins;

  const removedPins = [...prevPinIds].filter(id => !nextPinIds.has(id));
  if (removedPins.length > 0) {
    // A single user action removes one pin, or a handful via deleteFolder/deletePlaylist. A diff
    // that wipes most of the list is far more likely to be a bug than an intention.
    const looksWrong = removedPins.length > 2 && removedPins.length > prevPinIds.size / 2;
    if (looksWrong) {
      console.warn(`[sync] Refusing to tombstone ${removedPins.length} of ${prevPinIds.size} pins in one change.`);
    } else {
      removedPins.forEach(id => markPinDeleted(id, at));
    }
  }

  // --- whole-value registers ---
  if (prev.sevens !== next.sevens || prev.sevensSeeded !== next.sevensSeeded) {
    patch.sevensT = at;
  }
  if (prev.stagedSeven !== next.stagedSeven) {
    patch.stagedSevenT = at;
  }
  if (prev.unaddedCheckPlaylists !== next.unaddedCheckPlaylists) {
    patch.unaddedT = at;
  }
  if (prev.playlistSortSettings !== next.playlistSortSettings) {
    const sortT = { ...meta.sortT };
    for (const id of Object.keys(next.playlistSortSettings || {})) {
      if ((prev.playlistSortSettings || {})[id] !== next.playlistSortSettings[id]) sortT[id] = at;
    }
    patch.sortT = sortT;
  }

  if (Object.keys(patch).length > 0 || removedPins.length > 0) {
    saveMeta(patch);
    return true;
  }
  return false;
}

// --- applying a remote document ---------------------------------------------

function applyRemoteDoc(doc) {
  isApplyingRemote = true;
  try {
    // One setState across every synced slice, so the tracker sees a single transition
    useUserStore.setState(docToStore(doc));
  } finally {
    isApplyingRemote = false;
  }

  // Adopt the merged document's clocks. Without this the next diff would read "everything
  // changed" and re-stamp the whole document as freshly edited on this device.
  saveMeta(docToMetaClocks(doc, getMeta()));
}

// --- pushing ----------------------------------------------------------------

function clearTimers() {
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  clearTimeout(backoffTimer);
  debounceTimer = null;
  maxWaitTimer = null;
  backoffTimer = null;
}

function schedulePush() {
  if (!running || !pushUnlocked) return;

  dirty = true;
  useSyncStore.getState().setPendingChanges(true);

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPush, PUSH_DEBOUNCE_MS);

  // A long drag-and-drop session would otherwise keep resetting the debounce and never save
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(flushPush, PUSH_MAX_WAIT_MS);
  }
}

async function flushPush({ keepalive = false } = {}) {
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  debounceTimer = null;
  maxWaitTimer = null;

  if (!running || !pushUnlocked || !dirty || inFlight || pendingConflict) return;
  if (getDataOwnerId() !== userId) return; // never push one account's data under another's token

  inFlight = true;
  useSyncStore.getState().setStatus('pushing');

  try {
    const doc = storeToDoc(useUserStore.getState(), getMeta());
    doc.ownerId = userId;

    const result = await pushDoc(doc, getDeviceId(), { keepalive });
    setServerTime(result.serverTime);

    // The server returns what it actually stored, so applying it keeps the client and server
    // in exact agreement -- no second round trip, no divergence.
    applyRemoteDoc(result.doc);
    saveMeta({ lastRevision: result.revision, lastSyncedAt: Date.now() });

    dirty = false;
    backoffMs = BACKOFF_START_MS;
    useSyncStore.getState().markSynced();
  } catch (err) {
    handleFailure(err, 'push');
  } finally {
    inFlight = false;
  }
}

function handleFailure(err, phase) {
  const status = err instanceof SyncApiError ? err.status : 0;
  const retryable = err instanceof SyncApiError ? err.isRetryable : true;

  console.warn(`[sync] ${phase} failed:`, err?.message);

  if (!retryable) {
    // 400 or 413: retrying cannot help and would spin forever
    useSyncStore.getState().setStatus('error', err.message);
    pushUnlocked = false;
    return;
  }

  useSyncStore.getState().setStatus(status === 0 ? 'offline' : 'error', err?.message);

  // Stay dirty and try again. Because every push sends the whole document and the merge is
  // idempotent, the local state IS the retry queue -- there is nothing to replay in order.
  clearTimeout(backoffTimer);
  backoffTimer = setTimeout(() => {
    if (dirty) flushPush();
    else pull();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}

// --- pulling ----------------------------------------------------------------

async function pull({ force = false, apply = true } = {}) {
  if (!running || inFlight || pendingConflict) return null;
  if (!force && Date.now() - lastPullAt < PULL_THROTTLE_MS) return null;

  inFlight = true;
  lastPullAt = Date.now();
  useSyncStore.getState().setStatus('pulling');

  try {
    const result = await pullDoc();
    setServerTime(result.serverTime);

    const local = storeToDoc(useUserStore.getState(), getMeta());
    const merged = mergeSyncDoc(local, result.doc);
    if (apply) {
      applyRemoteDoc(merged);
      saveMeta({ lastRevision: result.revision });
    }

    backoffMs = BACKOFF_START_MS;
    return { remote: result.doc, merged, revision: result.revision };
  } catch (err) {
    handleFailure(err, 'pull');
    return null;
  } finally {
    inFlight = false;
  }
}

// --- lifecycle --------------------------------------------------------------

const onVisibilityChange = () => {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') {
    pull();
  } else if (dirty) {
    // Leaving the tab: get what we have to the server now. sendBeacon can't set an
    // Authorization header, so this is a keepalive fetch instead.
    flushPush({ keepalive: true });
  }
};

const onOnline = () => {
  if (dirty) flushPush();
  else pull({ force: true });
};

const onPageHide = () => {
  if (dirty) flushPush({ keepalive: true });
};

export async function start(currentUserId) {
  if (running && userId === currentUserId) return;
  stop();

  running = true;
  userId = currentUserId;
  pushUnlocked = false;
  dirty = false;
  backoffMs = BACKOFF_START_MS;

  // --- owner check: whose data is sitting in this browser? ---
  const owner = getDataOwnerId();
  if (!owner) {
    // First run for this install. Adopting is correct: whatever is here was created by the
    // person now signing in -- this is the path that carries an existing PC's folders up.
    setDataOwnerId(currentUserId);
  } else if (owner !== currentUserId) {
    // A different Spotify account signed in on this device. Clear the previous account's synced
    // data locally rather than uploading it under the new account. The old account's server-side
    // document is untouched.
    console.info('[sync] Different account detected; clearing locally cached data for the previous user.');
    isApplyingRemote = true;
    try {
      useUserStore.setState({
        customFolders: [], pinnedItems: [], sevens: [], sevensSeeded: false,
        stagedSeven: [], playlistSortSettings: {}, unaddedCheckPlaylists: []
      });
    } finally {
      isApplyingRemote = false;
    }
    resetMeta();
    setDataOwnerId(currentUserId);
  }

  // --- change tracking ---
  unsubscribeStore = useUserStore.subscribe(
    (state) => ({
      customFolders: state.customFolders,
      pinnedItems: state.pinnedItems,
      sevens: state.sevens,
      sevensSeeded: state.sevensSeeded,
      stagedSeven: state.stagedSeven,
      playlistSortSettings: state.playlistSortSettings,
      unaddedCheckPlaylists: state.unaddedCheckPlaylists
    }),
    (next, prev) => {
      if (isApplyingRemote) return;
      // Stamping runs synchronously and undebounced so a burst of writes (the loop in
      // ContextMenu.jsx, or a drag-and-drop flurry) gets one correct clock each. Only the
      // network push is debounced.
      if (stampChanges(prev, next)) schedulePush();
    },
    { equalityFn: shallow }
  );

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
  }

  // --- first pull, then unlock pushing ---
  const localBefore = storeToDoc(useUserStore.getState(), getMeta());
  // On a device's very first sync with folders of its own, don't apply anything until we know
  // whether the account also has folders -- if it does, the user chooses how to reconcile.
  const needsChoice = !getMeta().firstSyncDone && docHasContent(localBefore);

  const result = await pull({ force: true, apply: !needsChoice });

  if (!result) {
    // The pull failed. Stay in local-only mode: DO NOT push. A device that has not heard from
    // the server has no idea what it would be merging against.
    return;
  }

  if (needsChoice && docHasContent(result.remote)) {
    pendingConflict = result;
    useSyncStore.getState().setFirstSyncConflict({
      localFolders: countLiveFolders(localBefore),
      remoteFolders: countLiveFolders(result.remote)
    });
    useSyncStore.getState().setStatus('idle');
    return;
  }

  if (needsChoice) {
    applyRemoteDoc(result.merged);
    saveMeta({ lastRevision: result.revision });
  }

  finishFirstSync(result);
}

function countLiveFolders(doc) {
  return Object.values(doc?.folders || {}).filter(isFolderLive).length;
}

function finishFirstSync(result) {
  if (!getMeta().firstSyncDone) saveMeta({ firstSyncDone: true });
  pushUnlocked = true;

  // If this device contributed anything the server didn't have, send the merged result up.
  const mergedDoc = storeToDoc(useUserStore.getState(), getMeta());
  if (JSON.stringify(mergedDoc) !== JSON.stringify(result.remote)) {
    dirty = true;
    flushPush();
  } else {
    useSyncStore.getState().markSynced();
  }
}

export function resolveFirstSyncConflict(choice) {
  if (!pendingConflict || !running) return;
  const result = pendingConflict;
  pendingConflict = null;

  // 'useRemote' adopts the account's document as-is: this device's own folders are dropped
  // locally, and because they never had tombstones nothing about them reaches the server.
  applyRemoteDoc(choice === 'useRemote' ? result.remote : result.merged);
  saveMeta({ lastRevision: result.revision });
  useSyncStore.getState().setFirstSyncConflict(null);
  finishFirstSync(result);
}

export function stop() {
  running = false;
  pushUnlocked = false;
  userId = null;
  pendingConflict = null;
  useSyncStore.getState().setFirstSyncConflict(null);
  clearTimers();

  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', onPageHide);
  }
}

// Exposed for the "Disconnect Account" flow, which must not wipe local data unless it is
// demonstrably already on the server.
export function isSafeToHardLogout() {
  const meta = getMeta();
  return Boolean(meta.firstSyncDone && meta.lastSyncedAt);
}

export function syncNowIfPending() {
  if (dirty) flushPush();
}
