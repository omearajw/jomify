// Translation between the shape the app renders from (arrays, in display order) and the shape
// the sync layer merges (maps keyed by id, with clocks). Kept separate from the engine so both
// directions can be read side by side and checked against each other.

// Explicit .js extension so plain node can import this too -- scripts/merge-cases.mjs exercises
// these transforms directly, without a bundler.
import { isFolderLive, isPinLive, emptyDoc } from './mergeSyncDoc.js';

const ZERO_FOLDER_CLOCKS = { name: 0, parentId: 0, order: 0, items: 0 };

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1);

// --- store -> document ------------------------------------------------------

export function storeToDoc(state, meta) {
  const doc = emptyDoc();

  for (const folder of state.customFolders || []) {
    doc.folders[folder.id] = {
      name: folder.name ?? '',
      parentId: folder.parentId ?? null,
      order: folder.order ?? 0,
      items: folder.playlistIds ?? [],
      t: { ...ZERO_FOLDER_CLOCKS, ...(meta.folders?.[folder.id] || {}) },
      deletedAt: null
    };
  }

  // Folders this device has deleted. A tombstone carries zeroed edit clocks, so any remote edit
  // newer than the delete will win and bring the folder back -- which is the intended rule.
  for (const [id, deletedAt] of Object.entries(meta.deletedFolders || {})) {
    if (doc.folders[id]) continue; // recreated locally since; the live copy wins
    doc.folders[id] = {
      name: '',
      parentId: null,
      order: 0,
      items: [],
      t: { ...ZERO_FOLDER_CLOCKS },
      deletedAt
    };
  }

  (state.pinnedItems || []).forEach((pin, index) => {
    doc.pins[pin.id] = {
      type: pin.type ?? 'playlist',
      order: (index + 1) * 1000,
      t: meta.pins?.[pin.id] ?? 0,
      deletedAt: null
    };
  });

  for (const [id, deletedAt] of Object.entries(meta.deletedPins || {})) {
    if (doc.pins[id]) continue;
    doc.pins[id] = { type: 'playlist', order: 0, t: 0, deletedAt };
  }

  doc.sevens = {
    v: { list: state.sevens || [], seeded: Boolean(state.sevensSeeded) },
    t: meta.sevensT ?? 0
  };
  doc.stagedSeven = { v: state.stagedSeven || [], t: meta.stagedSevenT ?? 0 };
  doc.unaddedCheckPlaylists = { v: state.unaddedCheckPlaylists || [], t: meta.unaddedT ?? 0 };

  for (const [playlistId, settings] of Object.entries(state.playlistSortSettings || {})) {
    doc.playlistSortSettings[playlistId] = { v: settings, t: meta.sortT?.[playlistId] ?? 0 };
  }

  return doc;
}

// --- document -> store ------------------------------------------------------

export function docToStore(doc) {
  const customFolders = Object.entries(doc.folders || {})
    .filter(([, folder]) => isFolderLive(folder))
    .map(([id, folder]) => ({
      id,
      name: folder.name,
      playlistIds: folder.items || [],
      parentId: folder.parentId ?? null,
      order: folder.order ?? 0
    }))
    .sort(byOrder);

  const pinnedItems = Object.entries(doc.pins || {})
    .filter(([, pin]) => isPinLive(pin))
    .map(([id, pin]) => ({ id, type: pin.type, order: pin.order ?? 0 }))
    .sort(byOrder)
    .map(({ id, type }) => ({ id, type })); // the store's pin shape has no order field

  const playlistSortSettings = {};
  for (const [playlistId, register] of Object.entries(doc.playlistSortSettings || {})) {
    if (register?.v) playlistSortSettings[playlistId] = register.v;
  }

  return {
    customFolders,
    pinnedItems,
    sevens: doc.sevens?.v?.list ?? [],
    sevensSeeded: Boolean(doc.sevens?.v?.seeded),
    stagedSeven: doc.stagedSeven?.v ?? [],
    unaddedCheckPlaylists: doc.unaddedCheckPlaylists?.v ?? [],
    playlistSortSettings
  };
}

// After applying a merged document we must adopt its clocks too. Without this the next diff
// would see "everything changed" and re-stamp the whole document as freshly edited on this
// device, which would let a stale device win every future conflict.
export function docToMetaClocks(doc, meta) {
  const folders = {};
  const deletedFolders = {};
  for (const [id, folder] of Object.entries(doc.folders || {})) {
    folders[id] = { ...ZERO_FOLDER_CLOCKS, ...(folder.t || {}) };
    if (folder.deletedAt) deletedFolders[id] = folder.deletedAt;
  }

  const pins = {};
  const deletedPins = {};
  for (const [id, pin] of Object.entries(doc.pins || {})) {
    pins[id] = pin.t ?? 0;
    if (pin.deletedAt) deletedPins[id] = pin.deletedAt;
  }

  const sortT = {};
  for (const [id, register] of Object.entries(doc.playlistSortSettings || {})) {
    sortT[id] = register?.t ?? 0;
  }

  return {
    ...meta,
    folders,
    deletedFolders,
    pins,
    deletedPins,
    sortT,
    sevensT: doc.sevens?.t ?? 0,
    stagedSevenT: doc.stagedSeven?.t ?? 0,
    unaddedT: doc.unaddedCheckPlaylists?.t ?? 0
  };
}

// Does this document contain anything at all? Used to decide whether a first sync needs to ask
// the user how to reconcile two populated devices.
export function docHasContent(doc) {
  if (!doc) return false;
  const liveFolders = Object.values(doc.folders || {}).filter(isFolderLive).length;
  const livePins = Object.values(doc.pins || {}).filter(isPinLive).length;
  return liveFolders > 0 || livePins > 0 || (doc.sevens?.v?.list?.length ?? 0) > 0;
}
