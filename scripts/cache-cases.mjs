// Case table for the in-browser Spotify cache reader. Builds synthetic LevelDB .log and .ldb
// files (the tool has no real cache to hand) and checks the tree that comes out.
// Run with: node scripts/cache-cases.mjs

import SnappyJS from 'snappyjs';
import {
  extractSpotifyFolders,
  groupCacheFiles,
  parseRootlist,
  rootlistKey,
  encodeVarint,
  CacheReadError,
  NOT_A_USERS_FOLDER,
  NO_ROOTLIST
} from '../src/import/spotifyCache.js';

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);

const bytes = (s) => Uint8Array.from(s, c => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const u32 = (n) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const u64 = (n) => concat(u32(n), u32(0));

// --- fixtures ---------------------------------------------------------------------------------

const rootlist = (parts) => bytes('\x00\xf1\xa4\x36\xa4\x01\x15\x0a' + parts.map(p => p + '\x12').join('') + '\x10trailing junk spotify:nothing');

const TREE_V1 = rootlist([
  'spotify:playlist:rootlevel1',
  'spotify:start-group:aaaaaaaaaaaaaaaa:Rock',
  'spotify:playlist:pl1',
  'spotify:start-group:bbbbbbbb:80s+Hair%20Metal',
  'spotify:playlist:pl2',
  'spotify:end-group:bbbbbbbb',
  'spotify:end-group:aaaaaaaaaaaaaaaa',
  'spotify:start-group:cccccccccccccccc:Caf\xc3\xa9',
  'spotify:playlist:pl3'
]);
const TREE_V2 = rootlist(['spotify:start-group:dddddddddddddddd:Newer', 'spotify:playlist:pl9', 'spotify:end-group:dddddddddddddddd']);

// A write batch: sequence(8) count(4) then records of type(1) varint key varint value
function batch(records) {
  const body = records.map(({ key, value, del }) => (
    del ? concat(Uint8Array.of(0), encodeVarint(key.length), key)
        : concat(Uint8Array.of(1), encodeVarint(key.length), key, encodeVarint(value.length), value)
  ));
  return concat(u64(1), u32(records.length), ...body);
}

// A .log file: 32KB blocks of [crc(4) length(2) type(1) data] fragments, batches split across blocks
function logFile(batches) {
  const BLOCK = 32 * 1024;
  const out = [];
  let inBlock = 0;
  const header = (len, type) => Uint8Array.of(0, 0, 0, 0, len & 255, len >> 8, type);
  for (const b of batches) {
    let offset = 0;
    let first = true;
    while (offset < b.length || first) {
      if (BLOCK - inBlock < 7) { out.push(new Uint8Array(BLOCK - inBlock)); inBlock = 0; }
      const room = BLOCK - inBlock - 7;
      const take = Math.min(room, b.length - offset);
      const last = offset + take === b.length;
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3;
      out.push(header(take, type), b.subarray(offset, offset + take));
      inBlock += 7 + take;
      offset += take;
      first = false;
      if (inBlock === BLOCK) inBlock = 0;
    }
  }
  return concat(...out);
}

// A block: entries with no prefix sharing, one restart point, then the trailer
function block(entries) {
  const body = entries.map(({ key, value }) => concat(encodeVarint(0), encodeVarint(key.length), encodeVarint(value.length), key, value));
  return concat(...body, u32(0), u32(1));
}
const internalKey = (userKey, seq, type = 1) => concat(userKey, Uint8Array.of(type, seq & 255, (seq >> 8) & 255, 0, 0, 0, 0, 0));

// A .ldb table: data blocks, metaindex, index, footer with the magic number
function tableFile(dataBlocks) {
  const parts = [];
  const handles = [];
  let offset = 0;
  const push = (blk, compression) => {
    const payload = compression === 1 ? SnappyJS.compress(blk) : blk;
    parts.push(payload, Uint8Array.of(compression, 0, 0, 0, 0));
    const handle = { offset, size: payload.length };
    offset += payload.length + 5;
    return handle;
  };
  for (const { entries, compression } of dataBlocks) handles.push(push(block(entries), compression));
  const metaHandle = push(block([]), 0);
  const indexEntries = dataBlocks.map((d, i) => ({
    key: d.entries[d.entries.length - 1]?.key ?? bytes('z'),
    value: concat(encodeVarint(handles[i].offset), encodeVarint(handles[i].size))
  }));
  const indexHandle = push(block(indexEntries), 0);
  let footer = concat(encodeVarint(metaHandle.offset), encodeVarint(metaHandle.size), encodeVarint(indexHandle.offset), encodeVarint(indexHandle.size));
  footer = concat(footer, new Uint8Array(40 - footer.length), Uint8Array.of(0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb));
  return concat(...parts, footer);
}

const file = (path, data, lastModified = 1000) => ({ path, lastModified, bytes: async () => data });
const KEY = rootlistKey('jack');
const NOISE = bytes('!pl#slc#\x05other#');

// --- cases ------------------------------------------------------------------------------------

section('key and varints');
check('varint small', encodeVarint(5).length === 1 && encodeVarint(5)[0] === 5);
check('varint two bytes', Array.from(encodeVarint(300)).join(',') === '172,2');
check('rootlist key matches the CLI layout', String.fromCharCode(...KEY) === '!pl#slc#\x1aspotify:user:jack:rootlist#');

section('parseRootlist');
const tree = parseRootlist(TREE_V1, 'jack');
check('root-level playlist kept at the top', tree.children[0].type === 'playlist' && tree.children[0].uri === 'spotify:playlist:rootlevel1');
check('folder gets a uri padded to 16 hex', tree.children[1].uri === 'spotify:user:jack:folder:aaaaaaaaaaaaaaaa' && tree.children[1].children[1].uri === 'spotify:user:jack:folder:00000000bbbbbbbb');
check('nesting is rebuilt', tree.children[1].name === 'Rock' && tree.children[1].children[1].children[0].uri === 'spotify:playlist:pl2');
check('names are unquote_plus decoded', tree.children[1].children[1].name === '80s Hair Metal');
check('utf-8 names survive', tree.children[2].name === 'Café');
check('unclosed group is closed at the end', tree.children[2].children[0].uri === 'spotify:playlist:pl3' && tree.children.length === 3);
check('junk after the list is ignored', !JSON.stringify(tree).includes('nothing'));

section('groupCacheFiles');
const grouped = groupCacheFiles([
  file('Users\\jack-user\\000003.log', TREE_V1, 5),
  file('Users\\jack-user\\000001.ldb', TREE_V1, 9),
  file('Users\\jack-user\\LOCK', TREE_V1),
  file('Users\\jack-user\\MANIFEST-000002', TREE_V1),
  file('Users/anna-user/000001.log', TREE_V1),
  file('Users\\prefs', TREE_V1),
  file('PersistentCache/Storage/ab/abcd.file', TREE_V1)
]);
check('accounts come from the -user directory name, both slash styles', [...grouped.keys()].sort().join(',') === 'anna,jack');
check('only .log and .ldb files are kept', grouped.get('jack').length === 2 && grouped.get('anna').length === 1);
check('newest file first', grouped.get('jack')[0].path.endsWith('.ldb'));

section('extract from a .log');
const logOnly = await extractSpotifyFolders([file('Users\\jack-user\\000003.log', logFile([batch([{ key: NOISE, value: bytes('x') }, { key: KEY, value: TREE_V1 }])]))], { userId: 'jack' });
check('tree read from a log batch', logOnly.root.children[1].name === 'Rock' && logOnly.userId === 'jack');
const twoBatches = logFile([batch([{ key: KEY, value: TREE_V1 }]), batch([{ key: KEY, value: TREE_V2 }])]);
check('later batch in the same log wins', (await extractSpotifyFolders([file('Users/jack-user/1.log', twoBatches)], { userId: 'jack' })).root.children[0].name === 'Newer');
const bigValue = concat(TREE_V2, new Uint8Array(70000).fill(120));
const spanning = logFile([batch([{ key: NOISE, value: new Uint8Array(20000) }]), batch([{ key: KEY, value: bigValue }])]);
check('batch spanning several 32KB blocks is reassembled', (await extractSpotifyFolders([file('Users/jack-user/1.log', spanning)], { userId: 'jack' })).root.children[0].name === 'Newer');

section('extract from a .ldb');
const compressedTable = tableFile([
  { compression: 0, entries: [{ key: internalKey(NOISE, 3), value: bytes('noise') }] },
  { compression: 1, entries: [{ key: internalKey(KEY, 9), value: TREE_V1 }, { key: internalKey(KEY, 4), value: TREE_V2 }] }
]);
const fromTable = await extractSpotifyFolders([file('Users\\jack-user\\000005.ldb', compressedTable)], { userId: 'jack' });
check('snappy-compressed data block is read', fromTable.root.children[1].name === 'Rock');
check('first (newest) entry for the key wins', fromTable.root.children[0].uri === 'spotify:playlist:rootlevel1');
const deletedFirst = tableFile([{ compression: 0, entries: [{ key: internalKey(KEY, 9, 0), value: new Uint8Array(0) }, { key: internalKey(KEY, 4), value: TREE_V2 }] }]);
check('an empty (deleted) entry is skipped for the older value', (await extractSpotifyFolders([file('Users/jack-user/2.ldb', deletedFirst)], { userId: 'jack' })).root.children[0].name === 'Newer');

section('precedence and resilience');
const logThenTable = [
  file('Users/jack-user/9.ldb', tableFile([{ compression: 0, entries: [{ key: internalKey(KEY, 1), value: TREE_V1 }] }]), 999),
  file('Users/jack-user/3.log', logFile([batch([{ key: KEY, value: TREE_V2 }])]), 1)
];
check('log files are consulted before tables regardless of mtime', (await extractSpotifyFolders(logThenTable, { userId: 'jack' })).root.children[0].name === 'Newer');
const garbage = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 255);
const damagedFirst = [
  file('Users/jack-user/8.log', garbage, 50),
  file('Users/jack-user/7.ldb', garbage, 40),
  file('Users/jack-user/2.log', logFile([batch([{ key: KEY, value: TREE_V1 }])]), 1)
];
check('damaged files are skipped', (await extractSpotifyFolders(damagedFirst, { userId: 'jack' })).source.endsWith('2.log'));
check('unreadable file is skipped', (await extractSpotifyFolders([
  { path: 'Users/jack-user/5.log', lastModified: 9, bytes: async () => { throw new Error('locked'); } },
  file('Users/jack-user/2.log', logFile([batch([{ key: KEY, value: TREE_V1 }])]), 1)
], { userId: 'jack' })).source.endsWith('2.log'));

section('account selection and errors');
const rejects = async (files, opts, test) => {
  try { await extractSpotifyFolders(files, opts); return false; }
  catch (err) { return err instanceof CacheReadError && test(err); }
};
check('no -user folders', await rejects([file('Spotify/prefs', TREE_V1)], {}, e => e.message === NOT_A_USERS_FOLDER));
check('wrong account names the ones found', await rejects([file('Users/anna-user/1.log', logFile([batch([{ key: rootlistKey('anna'), value: TREE_V1 }])]))], { userId: 'jack' },
  e => e.message.includes('signed in as anna, not jack') && e.accounts.join() === 'anna'));
check('files present but no rootlist', await rejects([file('Users/jack-user/1.log', logFile([batch([{ key: NOISE, value: bytes('x') }])]))], { userId: 'jack' }, e => e.message === NO_ROOTLIST));
const noHint = await extractSpotifyFolders([
  file('Users/anna-user/1.log', logFile([batch([{ key: rootlistKey('anna'), value: TREE_V2 }])]), 5),
  file('Users/jack-user/1.log', logFile([batch([{ key: KEY, value: TREE_V1 }])]), 50)
]);
check('without a hint the most recently modified account is used', noHint.userId === 'jack' && noHint.root.children[1].name === 'Rock');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
