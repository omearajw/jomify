// Case table for the sync merge. Run with: node scripts/merge-cases.mjs
//
// mergeSyncDoc.js is dependency-free ESM, so node can import it directly -- no test runner and
// no bundler needed. The merge is the whole feature, and it must never ship without this passing.

import { deepStrictEqual } from 'node:assert';
import {
  mergeSyncDoc,
  emptyDoc,
  isFolderLive,
  isPinLive,
  clampFutureTimestamps,
  findForbiddenKey
} from '../src/sync/mergeSyncDoc.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition) {
  if (condition) { pass++; return; }
  fail++;
  failures.push(name);
  console.log(`  FAIL  ${name}`);
}

function checkEqual(name, actual, expected) {
  try {
    deepStrictEqual(actual, expected);
    pass++;
  } catch {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

function section(title) {
  console.log(`\n-- ${title} --`);
}

// --- builders ---------------------------------------------------------------

function folder(name, { t = 1000, items = [], order = 1000, deletedAt = null } = {}) {
  return {
    name,
    parentId: null,
    order,
    items,
    t: { name: t, parentId: t, order: t, items: t },
    deletedAt
  };
}

function docWith(folders = {}, extra = {}) {
  return { ...emptyDoc(), folders, ...extra };
}

// A document representing a well-populated PC
const PC = docWith({
  'folder-1-aaa': folder('Rock', { t: 5000, items: ['pl1', 'pl2'], order: 1000 }),
  'folder-2-bbb': folder('Jazz', { t: 5000, items: ['pl3'], order: 2000 }),
  'folder-3-ccc': folder('Chill', { t: 5000, items: [], order: 3000 })
}, {
  pins: { pl1: { type: 'playlist', order: 1000, t: 5000, deletedAt: null } },
  sevens: { v: { list: [{ playlistId: 's1' }], seeded: true }, t: 5000 }
});

// --- the headline case ------------------------------------------------------

section('absence is not deletion (the empty-phone case)');
{
  const phone = emptyDoc();

  checkEqual('merge(empty, PC) keeps every folder', mergeSyncDoc(phone, PC).folders, PC.folders);
  checkEqual('merge(PC, empty) keeps every folder', mergeSyncDoc(PC, phone).folders, PC.folders);
  checkEqual('argument order is irrelevant', mergeSyncDoc(phone, PC), mergeSyncDoc(PC, phone));
  checkEqual('pins survive an empty side too', mergeSyncDoc(phone, PC).pins, PC.pins);
  check('sevens survive an empty side too',
    mergeSyncDoc(phone, PC).sevens.v.list.length === 1);

  // The same property one level down: a device that knows about SOME folders must not delete
  // the ones it hasn't heard of.
  const partial = docWith({ 'folder-1-aaa': folder('Rock', { t: 9000, items: ['pl1'] }) });
  const merged = mergeSyncDoc(partial, PC);
  check('a partially-informed device deletes nothing', Object.keys(merged.folders).length === 3);
  check('...and its own newer edit still wins', merged.folders['folder-1-aaa'].items.length === 1);
}

// --- algebraic properties ---------------------------------------------------

section('commutative and idempotent');
{
  checkEqual('merge(a, a) is a', mergeSyncDoc(PC, PC), mergeSyncDoc(PC, emptyDoc()));
  checkEqual('merge(merge(a,b), b) === merge(a,b)',
    mergeSyncDoc(mergeSyncDoc(PC, emptyDoc()), emptyDoc()),
    mergeSyncDoc(PC, emptyDoc()));

  // Fuzz: random document pairs must merge to the same result in either order
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pickOne = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  const randomDoc = () => {
    const folders = {};
    const count = Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const id = `folder-${Math.floor(rnd() * 5)}-x`;
      folders[id] = folder(pickOne(['A', 'B', 'C']), {
        t: Math.floor(rnd() * 5) * 1000,
        items: rnd() > 0.5 ? ['p1'] : ['p1', 'p2'],
        order: Math.floor(rnd() * 3) * 1000,
        deletedAt: rnd() > 0.75 ? Math.floor(rnd() * 5) * 1000 : null
      });
    }
    return docWith(folders, {
      sevens: { v: { list: [], seeded: rnd() > 0.5 }, t: Math.floor(rnd() * 5) * 1000 }
    });
  };

  let commutative = true;
  let idempotent = true;
  for (let i = 0; i < 500; i++) {
    const a = randomDoc();
    const b = randomDoc();
    try {
      deepStrictEqual(mergeSyncDoc(a, b), mergeSyncDoc(b, a));
    } catch { commutative = false; break; }
    try {
      const once = mergeSyncDoc(a, b);
      deepStrictEqual(mergeSyncDoc(once, b), once);
    } catch { idempotent = false; break; }
  }
  check('commutative over 500 random document pairs', commutative);
  check('idempotent over 500 random document pairs', idempotent);
}

// --- the five scenarios -----------------------------------------------------

section('scenario (a) fresh device, first run');
{
  const merged = mergeSyncDoc(emptyDoc(), PC);
  check('adopts all remote folders', Object.keys(merged.folders).length === 3);
  check('adds nothing of its own', Object.keys(merged.folders).every(id => id in PC.folders));
}

section('scenario (b) offline device with local edits');
{
  const offline = docWith({
    'folder-1-aaa': folder('Rock Renamed', { t: 9000, items: ['pl1', 'pl2'] })
  });
  const merged = mergeSyncDoc(offline, PC);
  check('its edit wins for the folder it touched', merged.folders['folder-1-aaa'].name === 'Rock Renamed');
  check('folders it never saw are untouched', merged.folders['folder-2-bbb'].name === 'Jazz');
  check('nothing was lost', Object.keys(merged.folders).length === 3);
}

section('scenario (c) same folder edited on two devices');
{
  // Different fields, so both edits should survive
  const pcSide = { ...folder('Renamed On PC', { t: 1000, items: ['pl1'] }) };
  pcSide.t = { name: 9000, parentId: 0, order: 1000, items: 1000 };

  const phoneSide = { ...folder('Rock', { t: 1000, items: ['pl1', 'pl9'] }) };
  phoneSide.t = { name: 1000, parentId: 0, order: 1000, items: 9000 };

  const merged = mergeSyncDoc(
    docWith({ f: pcSide }),
    docWith({ f: phoneSide })
  ).folders.f;

  check('the rename survives', merged.name === 'Renamed On PC');
  check('the concurrent item change also survives', merged.items.length === 2);

  // Same field: later wins
  const older = docWith({ f: folder('Older', { t: 1000 }) });
  const newer = docWith({ f: folder('Newer', { t: 2000 }) });
  check('same-field conflict resolves to the later write',
    mergeSyncDoc(older, newer).folders.f.name === 'Newer');
  check('...regardless of argument order',
    mergeSyncDoc(newer, older).folders.f.name === 'Newer');
}

section('scenario (d) delete on one device, edit on another');
{
  const deleted = docWith({ f: folder('Gone', { t: 2000, deletedAt: 5000 }) });
  const staleEdit = docWith({ f: folder('Stale', { t: 1000 }) });
  const freshEdit = docWith({ f: folder('Revived', { t: 9000 }) });

  check('a stale laptop cannot resurrect a deleted folder',
    !isFolderLive(mergeSyncDoc(deleted, staleEdit).folders.f));
  check('...in either argument order',
    !isFolderLive(mergeSyncDoc(staleEdit, deleted).folders.f));
  check('the tombstone is retained so other devices learn of it',
    mergeSyncDoc(deleted, staleEdit).folders.f.deletedAt === 5000);
  check('an edit made after the delete brings it back',
    isFolderLive(mergeSyncDoc(deleted, freshEdit).folders.f));

  const livePin = { type: 'playlist', order: 1000, t: 9000, deletedAt: null };
  const deadPin = { type: 'playlist', order: 1000, t: 1000, deletedAt: 5000 };
  check('pin tombstones behave the same way',
    !isPinLive(mergeSyncDoc(docWith({}, { pins: { p: deadPin } }), docWith({}, { pins: { p: { ...deadPin, t: 1000 } } })).pins.p));
  check('a pin re-added after deletion comes back',
    isPinLive(mergeSyncDoc(docWith({}, { pins: { p: deadPin } }), docWith({}, { pins: { p: livePin } })).pins.p));
}

section('scenario (e) reorder conflicts');
{
  const a = docWith({
    f1: folder('One', { t: 1000, order: 500 }),
    f2: folder('Two', { t: 1000, order: 2000 })
  });
  const b = docWith({
    f1: folder('One', { t: 1000, order: 1000 }),
    f2: folder('Two', { t: 9000, order: 100 })
  });

  const merged = mergeSyncDoc(a, b);
  check('a reorder on one folder does not disturb the other', merged.folders.f1.order === 500 || merged.folders.f1.order === 1000);
  check('the later reorder wins for the folder that moved', merged.folders.f2.order === 100);
}

// --- the seeded latch -------------------------------------------------------

section('sevensSeeded is a one-way latch');
{
  const seeded = docWith({}, { sevens: { v: { list: [], seeded: true }, t: 1000 } });
  const fresh = docWith({}, { sevens: { v: { list: [], seeded: false }, t: 9999 } });

  check('a newer unseeded device cannot unset it', mergeSyncDoc(seeded, fresh).sevens.v.seeded === true);
  check('...in either argument order', mergeSyncDoc(fresh, seeded).sevens.v.seeded === true);
  check('two unseeded sides stay unseeded', mergeSyncDoc(fresh, fresh).sevens.v.seeded === false);
}

// --- registers --------------------------------------------------------------

section('registers');
{
  const a = docWith({}, {
    stagedSeven: { v: [{ uri: 'a' }], t: 5000 },
    unaddedCheckPlaylists: { v: ['x'], t: 5000 },
    playlistSortSettings: { p1: { v: { sortBy: 'name' }, t: 5000 } }
  });
  const b = docWith({}, {
    stagedSeven: { v: [{ uri: 'b' }, { uri: 'c' }], t: 9000 },
    playlistSortSettings: { p2: { v: { sortBy: 'added' }, t: 1000 } }
  });

  const merged = mergeSyncDoc(a, b);
  check('stagedSeven takes the later draft whole', merged.stagedSeven.v.length === 2);
  check('an empty side does not clear a register', mergeSyncDoc(a, emptyDoc()).unaddedCheckPlaylists.v.length === 1);
  check('sort settings union across devices', Object.keys(merged.playlistSortSettings).length === 2);
}

// --- clock clamping ---------------------------------------------------------

section('clock clamping');
{
  const serverNow = 1000000;
  const future = docWith({ f: folder('Future', { t: serverNow + 999999999 }) });
  const clamped = clampFutureTimestamps(JSON.parse(JSON.stringify(future)), serverNow);
  check('a wildly future clock is pulled back to now', clamped.folders.f.t.name === serverNow);

  const near = docWith({ f: folder('Near', { t: serverNow + 30000 }) });
  const untouched = clampFutureTimestamps(JSON.parse(JSON.stringify(near)), serverNow);
  check('mild skew inside the tolerance is left alone', untouched.folders.f.t.name === serverNow + 30000);
}

// --- secret rejection -------------------------------------------------------

section('credential rejection');
{
  check('a top-level token is caught', findForbiddenKey({ token: 'abc' }) === 'token');
  check('a nested refreshToken is caught', findForbiddenKey({ a: { b: { refreshToken: 'x' } } }) === 'refreshToken');
  check('one inside an array is caught', findForbiddenKey({ list: [{ verifier: 'x' }] }) === 'verifier');
  check('a clean document passes', findForbiddenKey(PC) === null);
}

// --- store <-> document round trip ------------------------------------------

section('transform round trip');
{
  const { storeToDoc, docToStore, docToMetaClocks } = await import('../src/sync/transform.js');

  const state = {
    customFolders: [
      { id: 'folder-a', name: 'Rock', playlistIds: ['pl1', 'pl2'], parentId: null, order: 1000 },
      { id: 'folder-b', name: 'Jazz', playlistIds: ['pl3'], parentId: null, order: 2000 }
    ],
    pinnedItems: [{ id: 'pl1', type: 'playlist' }, { id: 'folder-a', type: 'folder' }],
    sevens: [{ playlistId: 's1', partnerId: 'alice', active: true }],
    sevensSeeded: true,
    stagedSeven: [{ uri: 'spotify:track:1' }],
    playlistSortSettings: { pl1: { sortBy: 'name', sortOrder: 'asc' } },
    unaddedCheckPlaylists: ['pl9']
  };

  const meta = {
    folders: { 'folder-a': { name: 100, parentId: 0, order: 100, items: 200 } },
    deletedFolders: {},
    pins: { pl1: 300 },
    deletedPins: {},
    sevensT: 400, stagedSevenT: 500, unaddedT: 600,
    sortT: { pl1: 700 }
  };

  const doc = storeToDoc(state, meta);
  const back = docToStore(doc);

  check('folders survive the round trip', back.customFolders.length === 2);
  check('folder order is preserved', back.customFolders.map(f => f.name).join() === 'Rock,Jazz');
  check('folder contents are preserved', back.customFolders[0].playlistIds.join() === 'pl1,pl2');
  check('parentId survives', back.customFolders.every(f => f.parentId === null));
  check('pins survive with their types', back.pinnedItems.length === 2 && back.pinnedItems.some(p => p.type === 'folder'));
  check('pin order is preserved', back.pinnedItems[0].id === 'pl1');
  check('sevens survive', back.sevens.length === 1 && back.sevens[0].partnerId === 'alice');
  check('sevensSeeded survives', back.sevensSeeded === true);
  check('stagedSeven survives', back.stagedSeven.length === 1);
  check('sort settings survive', back.playlistSortSettings.pl1.sortBy === 'name');
  check('unadded list survives', back.unaddedCheckPlaylists.join() === 'pl9');
  check('clocks are carried into the document', doc.folders['folder-a'].t.items === 200);

  // A locally deleted folder must reach the document as a tombstone, not simply be absent --
  // absence would mean "no opinion" and the server would keep serving it back.
  const withTombstone = storeToDoc(
    { ...state, customFolders: [state.customFolders[0]] },
    { ...meta, deletedFolders: { 'folder-b': 9000 } }
  );
  check('a deleted folder becomes an explicit tombstone', withTombstone.folders['folder-b']?.deletedAt === 9000);
  check('the tombstone is not live', !docToStore(withTombstone).customFolders.some(f => f.id === 'folder-b'));

  // The empty-device case, end to end through the transforms
  const emptyDevice = storeToDoc({
    customFolders: [], pinnedItems: [], sevens: [], sevensSeeded: false,
    stagedSeven: [], playlistSortSettings: {}, unaddedCheckPlaylists: []
  }, { folders: {}, deletedFolders: {}, pins: {}, deletedPins: {}, sortT: {} });

  const afterMerge = docToStore(mergeSyncDoc(emptyDevice, doc));
  check('an empty device merging with a full account adopts everything', afterMerge.customFolders.length === 2);
  check('...and deletes nothing', afterMerge.pinnedItems.length === 2);

  // Adopting the merged clocks must not look like a fresh local edit next time round
  const adopted = docToMetaClocks(doc, meta);
  check('adopted clocks match the document', adopted.folders['folder-a'].items === 200);
}

// --- report -----------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`\nFailing cases:\n${failures.map(f => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
console.log('');
