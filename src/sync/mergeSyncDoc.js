// The merge function. This file is imported by BOTH the browser client and the serverless
// function in api/, so there is exactly one definition of what a correct merge is.
//
// It must stay dependency-free and side-effect-free: no imports, no globals, no Date.now().
// Timestamps always arrive as arguments so the result is reproducible and testable.
//
// THE PROPERTY THAT MATTERS:
//   Absence is not deletion. If one side has no entry for a key, the other side's entry survives
//   untouched. A phone with no folders has no *opinion* about the PC's folders. There is no
//   branch in this file that removes an entity because the other side lacked it -- deletion is
//   only ever expressed as an explicit `deletedAt` tombstone.
//
// Two further properties, both covered by scripts/merge-cases.mjs:
//   Commutative: merge(a, b) deep-equals merge(b, a). This is what lets the client and the
//                server each run the merge independently and still agree.
//   Idempotent:  merge(merge(a, b), b) === merge(a, b).
//
// Both properties depend on two rules that are easy to break by accident:
//   1. Every tiebreak is TOTAL and VALUE-BASED. Nothing tiebreaks on device identity -- a device
//      id survives a merge as a single collapsed value, so it cannot reproduce its own decision
//      on a re-merge, which silently costs you idempotence.
//   2. Output is always CANONICAL. Even when one side is adopted wholesale, it is normalised
//      first, so merging an already-merged document changes nothing.

export const SCHEMA_VERSION = 1;

// Keys that must never appear in a synced document at any depth. The client builds documents
// from an explicit whitelist, so this is a second line of defence rather than the first.
const FORBIDDEN_KEYS = ['token', 'refreshToken', 'accessToken', 'verifier', 'code_verifier'];

const FOLDER_FIELDS = ['name', 'parentId', 'order', 'items'];

export function emptyDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    folders: {},
    pins: {},
    sevens: { v: { list: [], seeded: false }, t: 0 },
    stagedSeven: { v: [], t: 0 },
    playlistSortSettings: {},
    unaddedCheckPlaylists: { v: [], t: 0 }
  };
}

// Key-sorted JSON, used as the final tiebreak. Sorting matters: without it two structurally
// identical objects with different key order would compare unequal, and the merge would stop
// being commutative.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// The core last-write-wins rule. The fallback is value-based rather than device-based, which is
// what keeps the whole merge both commutative and idempotent.
function pickValue(av, at, bv, bt) {
  if (at !== bt) return at > bt ? av : bv;
  return stableStringify(av) <= stableStringify(bv) ? av : bv;
}

// --- canonical shapes -------------------------------------------------------

function normalizeFolder(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const t = source.t && typeof source.t === 'object' ? source.t : {};
  const deletedAt = num(source.deletedAt);

  return {
    name: typeof source.name === 'string' ? source.name : '',
    parentId: source.parentId ?? null,
    order: num(source.order),
    items: Array.isArray(source.items) ? source.items : [],
    t: {
      name: num(t.name),
      parentId: num(t.parentId),
      order: num(t.order),
      items: num(t.items)
    },
    deletedAt: deletedAt > 0 ? deletedAt : null
  };
}

function normalizePin(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const deletedAt = num(source.deletedAt);

  return {
    type: typeof source.type === 'string' ? source.type : 'playlist',
    order: num(source.order),
    t: num(source.t),
    deletedAt: deletedAt > 0 ? deletedAt : null
  };
}

function normalizeRegister(raw, fallbackValue) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    v: source.v === undefined ? fallbackValue : source.v,
    t: num(source.t)
  };
}

// --- merges -----------------------------------------------------------------

function mergeRegister(aRaw, bRaw, fallbackValue) {
  const a = normalizeRegister(aRaw, fallbackValue);
  const b = normalizeRegister(bRaw, fallbackValue);

  return {
    v: pickValue(a.v, a.t, b.v, b.t),
    t: Math.max(a.t, b.t)
  };
}

function mergeRegisterMap(aRaw, bRaw) {
  const out = {};
  const a = aRaw && typeof aRaw === 'object' ? aRaw : {};
  const b = bRaw && typeof bRaw === 'object' ? bRaw : {};

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) { out[key] = normalizeRegister(b[key], null); continue; }
    if (!(key in b)) { out[key] = normalizeRegister(a[key], null); continue; }
    out[key] = mergeRegister(a[key], b[key], null);
  }
  return out;
}

function mergeFolder(aRaw, bRaw) {
  const a = normalizeFolder(aRaw);
  const b = normalizeFolder(bRaw);
  const merged = { t: {} };

  for (const field of FOLDER_FIELDS) {
    merged[field] = pickValue(a[field], a.t[field], b[field], b.t[field]);
    merged.t[field] = Math.max(a.t[field], b.t[field]);
  }

  // Tombstones are monotonic: once a delete is recorded, every device learns about it.
  const deletedAt = Math.max(num(a.deletedAt), num(b.deletedAt));
  merged.deletedAt = deletedAt > 0 ? deletedAt : null;

  return merged;
}

function mergeFolderMap(aRaw, bRaw) {
  const out = {};
  const a = aRaw && typeof aRaw === 'object' ? aRaw : {};
  const b = bRaw && typeof bRaw === 'object' ? bRaw : {};

  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // THE EMPTY-DEVICE CASE. One side simply doesn't know about this folder, which is not the
    // same as wanting it gone. Take the side that has it (normalised, never merged away).
    if (!(id in a)) { out[id] = normalizeFolder(b[id]); continue; }
    if (!(id in b)) { out[id] = normalizeFolder(a[id]); continue; }
    out[id] = mergeFolder(a[id], b[id]);
  }
  return out;
}

function mergePin(aRaw, bRaw) {
  const a = normalizePin(aRaw);
  const b = normalizePin(bRaw);
  const deletedAt = Math.max(num(a.deletedAt), num(b.deletedAt));

  return {
    type: pickValue(a.type, a.t, b.type, b.t),
    order: pickValue(a.order, a.t, b.order, b.t),
    t: Math.max(a.t, b.t),
    deletedAt: deletedAt > 0 ? deletedAt : null
  };
}

function mergePinMap(aRaw, bRaw) {
  const out = {};
  const a = aRaw && typeof aRaw === 'object' ? aRaw : {};
  const b = bRaw && typeof bRaw === 'object' ? bRaw : {};

  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(id in a)) { out[id] = normalizePin(b[id]); continue; }
    if (!(id in b)) { out[id] = normalizePin(a[id]); continue; }
    out[id] = mergePin(a[id], b[id]);
  }
  return out;
}

export function mergeSyncDoc(aRaw, bRaw) {
  const a = aRaw && typeof aRaw === 'object' ? aRaw : {};
  const b = bRaw && typeof bRaw === 'object' ? bRaw : {};

  const sevens = mergeRegister(a.sevens, b.sevens, { list: [], seeded: false });

  // `seeded` is a one-way latch merged as a logical OR, ignoring clocks entirely. Without this,
  // a fresh device carrying seeded:false would win on recency, re-run seedLegacySevens, and
  // resurrect the legacy Sevens the user deliberately removed.
  sevens.v = {
    list: Array.isArray(sevens.v?.list) ? sevens.v.list : [],
    seeded: Boolean(a.sevens?.v?.seeded) || Boolean(b.sevens?.v?.seeded)
  };

  const doc = {
    schemaVersion: SCHEMA_VERSION,
    folders: mergeFolderMap(a.folders, b.folders),
    pins: mergePinMap(a.pins, b.pins),
    sevens,
    stagedSeven: mergeRegister(a.stagedSeven, b.stagedSeven, []),
    playlistSortSettings: mergeRegisterMap(a.playlistSortSettings, b.playlistSortSettings),
    unaddedCheckPlaylists: mergeRegister(a.unaddedCheckPlaylists, b.unaddedCheckPlaylists, [])
  };

  // Sorted rather than "first non-empty" so that merge stays commutative even in the
  // pathological case where the two sides disagree about the owner.
  const owner = [a.ownerId, b.ownerId].filter(Boolean).sort()[0];
  if (owner) doc.ownerId = owner;

  return doc;
}

// --- liveness ---------------------------------------------------------------

// A folder is live unless it was deleted more recently than it was last edited. Editing a folder
// after deleting it brings it back -- chosen over "delete always wins" because in a single-user
// app the alternative silently discards work done seconds ago.
export function isFolderLive(folder) {
  if (!folder) return false;
  if (!folder.deletedAt) return true;
  const newestEdit = Math.max(...FOLDER_FIELDS.map(f => num(folder.t?.[f])));
  return newestEdit > folder.deletedAt;
}

export function isPinLive(pin) {
  if (!pin) return false;
  if (!pin.deletedAt) return true;
  return num(pin.t) > pin.deletedAt;
}

// --- hygiene ----------------------------------------------------------------

// Clamps timestamps that claim to be from the future. A device whose clock is a week fast would
// otherwise win every conflict forever; this bounds the damage to `skewMs`.
export function clampFutureTimestamps(doc, serverNow, skewMs = 60000) {
  if (!doc || typeof doc !== 'object') return doc;
  const ceiling = serverNow + skewMs;
  const clamp = (value) => (num(value) > ceiling ? serverNow : value);

  for (const folder of Object.values(doc.folders || {})) {
    for (const field of FOLDER_FIELDS) {
      if (folder.t) folder.t[field] = clamp(folder.t[field]);
    }
    if (folder.deletedAt) folder.deletedAt = clamp(folder.deletedAt);
  }
  for (const pin of Object.values(doc.pins || {})) {
    pin.t = clamp(pin.t);
    if (pin.deletedAt) pin.deletedAt = clamp(pin.deletedAt);
  }
  for (const register of [doc.sevens, doc.stagedSeven, doc.unaddedCheckPlaylists]) {
    if (register) register.t = clamp(register.t);
  }
  for (const register of Object.values(doc.playlistSortSettings || {})) {
    if (register) register.t = clamp(register.t);
  }

  return doc;
}

// Walks the document looking for anything credential-shaped. Returns the offending key, or null.
export function findForbiddenKey(value, depth = 0) {
  if (depth > 12 || !value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return key;
    const found = findForbiddenKey(child, depth + 1);
    if (found) return found;
  }
  return null;
}
