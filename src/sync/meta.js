// Sync bookkeeping: per-field clocks, tombstones, this device's identity, and which Spotify
// account the local data belongs to.
//
// This lives in its own localStorage key rather than in the Zustand store on purpose. The change
// tracker stamps a clock on every mutation; if those clocks lived in the store, stamping one
// would itself count as a mutation and re-trigger the tracker. Keeping this module free of any
// import from userStore.js makes that loop structurally impossible.

const KEY = 'jomify_sync_meta';
export const META_VERSION = 1;

// Difference between the server's clock and ours, learned from every API response. Held in memory
// only -- a stale offset from a previous session is worse than no offset at all.
let clockOffset = 0;

export function setServerTime(serverTime) {
  if (typeof serverTime === 'number' && Number.isFinite(serverTime)) {
    clockOffset = serverTime - Date.now();
  }
}

// Every timestamp written anywhere in the sync layer comes from here, never from Date.now().
export function syncNow() {
  return Date.now() + clockOffset;
}

function freshMeta() {
  return {
    metaVersion: META_VERSION,
    deviceId: `dev-${Math.random().toString(36).slice(2, 10)}`,
    dataOwnerId: null,
    folders: {},          // id -> { name, parentId, order, items } clocks
    deletedFolders: {},   // id -> deletedAt
    pins: {},             // id -> clock
    deletedPins: {},      // id -> deletedAt
    sevensT: 0,
    stagedSevenT: 0,
    unaddedT: 0,
    sortT: {},            // playlistId -> clock
    lastRevision: 0,
    lastSyncedAt: null,
    firstSyncDone: false
  };
}

let cache = null;

export function getMeta() {
  if (cache) return cache;

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // An unrecognised version is treated as no metadata at all. Losing clocks is harmless --
      // they all fall back to 0, and a zero clock never destroys data, it just loses conflicts.
      cache = parsed?.metaVersion === META_VERSION ? { ...freshMeta(), ...parsed } : freshMeta();
    } else {
      cache = freshMeta();
    }
  } catch {
    cache = freshMeta();
  }

  return cache;
}

export function saveMeta(patch) {
  cache = { ...getMeta(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    // Out of quota or private-mode restrictions. Sync still works this session; the clocks just
    // won't survive a reload, which degrades to "loses conflicts" rather than "loses data".
    console.warn('Could not persist sync metadata:', err);
  }
  return cache;
}

export function resetMeta() {
  cache = freshMeta();
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Non-fatal
  }
  return cache;
}

export function clearMeta() {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Non-fatal
  }
}

// --- clocks -----------------------------------------------------------------

export function stampFolderFields(folderId, fields, at = syncNow()) {
  const meta = getMeta();
  const existing = meta.folders[folderId] || { name: 0, parentId: 0, order: 0, items: 0 };
  const updated = { ...existing };
  fields.forEach((field) => { updated[field] = at; });

  // Re-stamping a folder means it is alive again; drop any tombstone we were holding for it so
  // this device stops advertising a delete it has just undone.
  const deletedFolders = { ...meta.deletedFolders };
  if (deletedFolders[folderId] && at > deletedFolders[folderId]) delete deletedFolders[folderId];

  return saveMeta({ folders: { ...meta.folders, [folderId]: updated }, deletedFolders });
}

export function stampPin(pinId, at = syncNow()) {
  const meta = getMeta();
  const deletedPins = { ...meta.deletedPins };
  if (deletedPins[pinId] && at > deletedPins[pinId]) delete deletedPins[pinId];

  return saveMeta({ pins: { ...meta.pins, [pinId]: at }, deletedPins });
}

export function stampSortSetting(playlistId, at = syncNow()) {
  const meta = getMeta();
  return saveMeta({ sortT: { ...meta.sortT, [playlistId]: at } });
}

// --- tombstones -------------------------------------------------------------

// Folder tombstones are minted in exactly two places -- deleteFolder (which cascades to
// subfolders) and importFolderTree in replace mode -- both in userStore.js, and both are the
// only code paths that remove folders. Deliberately never inferred from diffing two states: a
// false tombstone is the one bug that could delete real folders, and inference is the only way
// one could arise.
export function markFolderDeleted(folderId, at = syncNow()) {
  return markFoldersDeleted([folderId], at);
}

export function markFoldersDeleted(folderIds, at = syncNow()) {
  const meta = getMeta();
  const deletedFolders = { ...meta.deletedFolders };
  folderIds.forEach((id) => { deletedFolders[id] = at; });
  return saveMeta({ deletedFolders });
}

export function markPinDeleted(pinId, at = syncNow()) {
  return markPinsDeleted([pinId], at);
}

export function markPinsDeleted(pinIds, at = syncNow()) {
  const meta = getMeta();
  const deletedPins = { ...meta.deletedPins };
  pinIds.forEach((id) => { deletedPins[id] = at; });
  return saveMeta({ deletedPins });
}

// --- identity ---------------------------------------------------------------

export function getDeviceId() {
  return getMeta().deviceId;
}

export function getDataOwnerId() {
  return getMeta().dataOwnerId;
}

export function setDataOwnerId(userId) {
  return saveMeta({ dataOwnerId: userId });
}
