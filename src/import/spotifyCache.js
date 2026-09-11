// Reads the folder tree straight out of Spotify's local cache, so nobody has to run the
// spotifyfolders CLI. This is a port of that tool (github.com/mikez/spotify-folders, MIT):
// the desktop app keeps the "rootlist" in a small LevelDB under
//   Windows  %LOCALAPPDATA%\Spotify\Users\<id>-user\
//            %LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\LocalState\Spotify\Users\
//   Mac      ~/Library/Application Support/Spotify/PersistentCache/Users/<id>-user/
// and the value under one key is a protobuf-ish blob whose playlist / start-group / end-group
// strings, read in order, describe the tree. We only need to find that one value, so this is a
// bare-bones LevelDB reader (log files + table files), not a general one.
//
// Pure and dependency-light so it runs under node for the tests: callers hand in
//   { path, lastModified, bytes: () => Promise<Uint8Array> }
// for each file, which is how a browser File and a node fixture both look.

import SnappyJS from 'snappyjs';

export class CacheReadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CacheReadError';
    Object.assign(this, details);
  }
}

const ACCOUNT_SUFFIX = '-user';
const TABLE_MAGIC = 0xdb4775248b80fb57n;
const FOOTER_LENGTH = 48;
const LOG_BLOCK_SIZE = 32 * 1024;
const LOG_HEADER_SIZE = 7;
const RECORD_FULL = 1;
const RECORD_LAST = 4;
const MAX_UNCOMPRESSED_BLOCK = 64 * 1024 * 1024;

const ascii = (s) => Uint8Array.from(s, c => c.charCodeAt(0));

export function encodeVarint(n) {
  const out = [];
  let rest = n;
  while (rest >= 0x80) { out.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
  out.push(rest);
  return Uint8Array.from(out);
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// LevelDB key of the rootlist value: "!pl#slc#" + varint(len) + "spotify:user:<id>:rootlist" + "#"
export function rootlistKey(userId) {
  const id = ascii(`spotify:user:${userId}:rootlist`);
  return concat(ascii('!pl#slc#'), encodeVarint(id.length), id, ascii('#'));
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
  }
  left() { return Math.max(0, this.end - this.pos); }
  take(n) {
    if (this.pos + n > this.end) throw new RangeError('read past end');
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  uint(n) {
    let value = 0;
    const b = this.take(n);
    for (let i = n - 1; i >= 0; i--) value = value * 256 + b[i];
    return value;
  }
  varint() {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = this.take(1)[0];
      value += (byte & 0x7f) * shift;
      if (!(byte & 0x80)) return value;
      shift *= 128;
    }
  }
}

// --- .log files: 32KB blocks of fragments; joined fragments form a write batch -----------------

function* logBatches(bytes) {
  let batch = [];
  for (let blockStart = 0; blockStart < bytes.length; blockStart += LOG_BLOCK_SIZE) {
    const r = new Reader(bytes, blockStart, Math.min(blockStart + LOG_BLOCK_SIZE, bytes.length));
    while (r.left() >= LOG_HEADER_SIZE) {
      r.take(4); // crc, not verified
      const length = r.uint(2);
      const type = r.uint(1);
      if (type === 0) break; // zero-filled block trailer
      if (length > r.left()) return; // truncated file: stop rather than guess
      batch.push(r.take(length));
      if (type === RECORD_FULL || type === RECORD_LAST) {
        yield concat(...batch);
        batch = [];
      }
    }
  }
}

function findInLog(bytes, targetKey) {
  let found = null;
  for (const batch of logBatches(bytes)) {
    try {
      const r = new Reader(batch);
      r.uint(8); // sequence number
      const count = r.uint(4);
      for (let i = 0; i < count; i++) {
        const type = r.uint(1);
        const key = r.take(r.varint());
        if (type === 1) {
          const value = r.take(r.varint());
          if (bytesEqual(key, targetKey)) found = value;
        }
      }
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
  }
  return found && found.length ? found : null;
}

// --- .ldb table files: footer -> index block -> data blocks ------------------------------------

function blockHandle(r) {
  return { offset: r.varint(), size: r.varint() };
}

function readBlock(bytes, handle) {
  const { offset, size } = handle;
  if (offset + size + 1 > bytes.length) throw new RangeError('block handle past end');
  const compression = bytes[offset + size];
  const raw = bytes.subarray(offset, offset + size);
  if (compression === 0) return raw;
  if (compression === 1) return SnappyJS.uncompress(raw, MAX_UNCOMPRESSED_BLOCK);
  throw new CacheReadError(`Unsupported LevelDB block compression ${compression}.`);
}

// Entries share a prefix with the previous key; a trailer lists restart points we don't need
function* blockEntries(block) {
  if (block.length < 4) return;
  const restarts = new Reader(block, block.length - 4).uint(4);
  const end = block.length - (1 + restarts) * 4;
  if (end < 0) return;
  const r = new Reader(block, 0, end);
  let lastKey = new Uint8Array(0);
  while (r.left() > 0) {
    const shared = r.varint();
    const unshared = r.varint();
    const valueLength = r.varint();
    if (shared > lastKey.length) return;
    const key = concat(lastKey.subarray(0, shared), r.take(unshared));
    const value = r.take(valueLength);
    lastKey = key;
    yield { key, value };
  }
}

function findInTable(bytes, targetKey) {
  if (bytes.length < FOOTER_LENGTH) return null;
  const footer = new Reader(bytes, bytes.length - FOOTER_LENGTH);
  const magic = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8).getBigUint64(0, true);
  if (magic !== TABLE_MAGIC) return null;
  blockHandle(footer); // metaindex, unused
  const indexHandle = blockHandle(footer);

  // Spotify uses a custom key comparator, so instead of a binary search we walk every data
  // block. The account database is a few hundred KB at most.
  for (const { value: handleBytes } of blockEntries(readBlock(bytes, indexHandle))) {
    const dataBlock = readBlock(bytes, blockHandle(new Reader(handleBytes)));
    for (const { key, value } of blockEntries(dataBlock)) {
      // Internal key = user key + 8 bytes (sequence << 8 | type). Same user keys sort newest
      // first, so the first non-empty hit is the current value.
      if (key.length < 8) continue;
      const userKey = key.subarray(0, key.length - 8);
      if (bytesEqual(userKey, targetKey) && value.length) return value;
    }
  }
  return null;
}

// --- Rootlist blob -> folder tree ------------------------------------------------------------

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const utf8FromLatin1 = (s) => new TextDecoder().decode(ascii(s));

function decodeName(raw) {
  const text = utf8FromLatin1(raw).replace(/\+/g, ' ');
  try { return decodeURIComponent(text); } catch { return text; }
}

// Mirrors the CLI's parse(): split on "spotify:" and read playlist / start-group / end-group
// entries in order; a 0x12 byte ends each string's payload.
export function parseRootlist(bytes, userId = 'unknown') {
  const rows = latin1(bytes).split(/spotify:(?=[pse])/);
  let folder = { type: 'folder', children: [] };
  const stack = [];

  for (const rawRow of rows) {
    const row = rawRow.split('\x12', 1)[0];
    if (row.startsWith('playlist:')) {
      folder.children.push({ type: 'playlist', uri: `spotify:${row}` });
    } else if (row.startsWith('start-group:')) {
      const tags = row.split(':');
      const hex = (tags[1] || '').padStart(16, '0');
      stack.push(folder);
      folder = {
        type: 'folder',
        name: decodeName(tags.slice(2).join(':')),
        uri: `spotify:user:${userId}:folder:${hex}`,
        children: []
      };
    } else if (row.startsWith('end-group:')) {
      if (stack.length === 0) continue;
      const parent = stack.pop();
      parent.children.push(folder);
      folder = parent;
    }
  }

  // Close any group the file left open; the CLI notes real files sometimes do this
  while (stack.length) {
    const parent = stack.pop();
    parent.children.push(folder);
    folder = parent;
  }
  return folder;
}

// --- Entry point ------------------------------------------------------------------------------

const extensionOf = (path) => path.slice(path.lastIndexOf('.')).toLowerCase();

function accountOf(path) {
  for (const segment of path.split(/[\\/]/)) {
    if (segment.endsWith(ACCOUNT_SUFFIX)) return segment.slice(0, -ACCOUNT_SUFFIX.length);
  }
  return null;
}

// Which files matter, grouped by Spotify account. Everything else in a picked directory (audio
// cache, settings, lock files) is ignored without being read.
export function groupCacheFiles(files) {
  const accounts = new Map();
  for (const file of files) {
    const account = accountOf(file.path);
    const ext = extensionOf(file.path);
    if (!account || (ext !== '.log' && ext !== '.ldb')) continue;
    if (!accounts.has(account)) accounts.set(account, []);
    accounts.get(account).push({ ...file, ext });
  }
  for (const list of accounts.values()) list.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  return accounts;
}

export const NOT_A_USERS_FOLDER = "That doesn't look like Spotify's Users folder. It should contain a folder whose name ends in \"-user\".";
export const NO_ROOTLIST = "Couldn't find any folder data in there. Quit Spotify completely, then try again.";

export async function extractSpotifyFolders(files, { userId = null } = {}) {
  const accounts = groupCacheFiles(files);
  if (accounts.size === 0) throw new CacheReadError(NOT_A_USERS_FOLDER, { accounts: [] });

  const found = [...accounts.keys()];
  let account = userId;
  if (userId && !accounts.has(userId)) {
    throw new CacheReadError(
      `Spotify on this computer is signed in as ${found.join(', ')}, not ${userId}. Sign in to Spotify with the same account, let it load, quit it, then try again.`,
      { accounts: found, userId }
    );
  }
  if (!account) {
    // No hint about who we are: take the account whose files changed most recently
    account = found.sort((a, b) => (accounts.get(b)[0].lastModified || 0) - (accounts.get(a)[0].lastModified || 0))[0];
  }

  const key = rootlistKey(account);
  const list = accounts.get(account);
  // Logs hold the newest writes and never need decompressing, so they go first, as in the CLI
  for (const ext of ['.log', '.ldb']) {
    for (const file of list) {
      if (file.ext !== ext) continue;
      let bytes;
      try { bytes = await file.bytes(); } catch { continue; }
      let value;
      try {
        value = ext === '.log' ? findInLog(bytes, key) : findInTable(bytes, key);
      } catch (err) {
        if (err instanceof CacheReadError) throw err;
        continue; // a damaged or half-written file; the next one may be fine
      }
      if (value) return { root: parseRootlist(value, account), userId: account, source: file.path };
    }
  }
  throw new CacheReadError(NO_ROOTLIST, { accounts: found, userId: account });
}
