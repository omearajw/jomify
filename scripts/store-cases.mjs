// Store smoke test for folder actions. Run with: node scripts/store-cases.mjs
//
// Imports the real Zustand store under node. zustand's persist reads window.localStorage, so a
// Map-backed stub is installed on both globals before the store module loads.

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};
globalThis.localStorage = storage;
globalThis.window = { localStorage: storage };

const { useUserStore } = await import('../src/store/userStore.js');
const { getMeta } = await import('../src/sync/meta.js');
const { childrenOf } = await import('../src/utils/library.js');

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);
const s = () => useUserStore.getState();
const byId = (id) => s().customFolders.find(f => f.id === id);
const names = (list) => list.map(f => f.name).join(',');

// Seed a tree by hand so ids are predictable: root R with children A, B; A has child C
useUserStore.setState({
  customFolders: [
    { id: 'R', name: 'R', playlistIds: ['p0'], parentId: null, order: 1000 },
    { id: 'A', name: 'A', playlistIds: ['p1'], parentId: 'R', order: 1000 },
    { id: 'B', name: 'B', playlistIds: [], parentId: 'R', order: 2000 },
    { id: 'C', name: 'C', playlistIds: ['p2'], parentId: 'A', order: 1000 },
    { id: 'S', name: 'S', playlistIds: [], parentId: null, order: 2000 }
  ],
  pinnedItems: [{ id: 'A', type: 'folder' }, { id: 'C', type: 'folder' }, { id: 'S', type: 'folder' }, { id: 'p1', type: 'playlist' }],
  activeFolderId: 'C',
  viewHistory: [{ view: 'library', folderId: 'A' }, { view: 'library', folderId: 'S' }]
});

section('createFolder with a parent');
s().createFolder('New under R', [], 'R');
const created = s().customFolders.find(f => f.name === 'New under R');
check('lands under the requested parent', created.parentId === 'R');
check('order is sibling-scoped (after B at 2000)', created.order === 3000);
s().createFolder('Orphan request', [], 'does-not-exist');
check('an unknown parent falls back to the root', s().customFolders.find(f => f.name === 'Orphan request').parentId === null);

section('moveFolder');
s().moveFolder('A', 'A');
check('moving onto itself is a no-op', byId('A').parentId === 'R');
s().moveFolder('A', 'C');
check('moving into a descendant is rejected', byId('A').parentId === 'R');
s().moveFolder('B', 'A');
check('a legal move reparents', byId('B').parentId === 'A');
check('...and appends after existing siblings', byId('B').order > byId('C').order);
s().moveFolder('B', null);
check('moving to the root works', byId('B').parentId === null);

section('reorderFolders among siblings');
const rootBefore = names(childrenOf(s().customFolders, null));
s().reorderFolders('S', 'R', 'before');
check('explicit before-position moves the folder first', names(childrenOf(s().customFolders, null)).startsWith('S'));
check('the first reorder changed the root order', names(childrenOf(s().customFolders, null)) !== rootBefore);
check('siblings under other parents are untouched', byId('C').parentId === 'A' && byId('C').order === 1000);
const afterFirst = names(childrenOf(s().customFolders, null));
s().reorderFolders('S', 'R'); // legacy two-arg: S is earlier, so it lands after R
check('legacy two-argument call mirrors the old splice (earlier drag lands after)', names(childrenOf(s().customFolders, null)).indexOf('R') < names(childrenOf(s().customFolders, null)).indexOf('S'));
check('the legacy call changed the order again', names(childrenOf(s().customFolders, null)) !== afterFirst);
s().reorderFolders('C', 'B', 'after');
check('a cross-parent reorder reparents to the drop target\'s parent', byId('C').parentId === (byId('B').parentId ?? null));
s().moveFolder('C', 'A');

section('deleteFolder cascades with one tombstone per descendant');
const before = Object.keys(getMeta().deletedFolders).length;
s().deleteFolder('R');
const deleted = getMeta().deletedFolders;
// R's subtree at this point: A and "New under R" directly, C under A
check('R, A, C and the new subfolder are all gone from the store', !byId('R') && !byId('A') && !byId('C') && !byId(created.id));
check('four tombstones were minted', Object.keys(deleted).length - before === 4);
check('all four carry the same timestamp', new Set(['R', 'A', 'C', created.id].map(id => deleted[id])).size === 1);
check('B survives (it was moved out first)', Boolean(byId('B')));
check('pinned A and C are unpinned; S and p1 keep their pins', s().pinnedItems.map(p => p.id).sort().join() === 'S,p1');
check('their pins carry explicit tombstones', getMeta().deletedPins.A > 0 && getMeta().deletedPins.C > 0);
check('activeFolderId falls back to the deleted root\'s parent (null)', s().activeFolderId === null);
check('history frames inside the subtree fall back too', s().viewHistory[0].folderId === null && s().viewHistory[1].folderId === 'S');

section('importFolderTree: replace');
useUserStore.setState({
  customFolders: [
    { id: 'J1', name: 'Jomify only', playlistIds: ['x1'], parentId: null, order: 1000 },
    { id: 'folder-sp-aaa', name: 'Old name', playlistIds: ['x2'], parentId: null, order: 2000 }
  ],
  pinnedItems: [{ id: 'J1', type: 'folder' }, { id: 'x1', type: 'playlist' }]
});
const plan = [
  { id: 'folder-sp-aaa', name: 'Rock', playlistIds: ['x2', 'x1'], parentId: null, order: 1000 },
  { id: 'folder-sp-bbb', name: '80s', playlistIds: ['x3'], parentId: 'folder-sp-aaa', order: 1000 }
];
const tombstonesBefore = Object.keys(getMeta().deletedFolders).length;
const result = s().importFolderTree(plan, { mode: 'replace' });
check('reports created/updated/removed', result.created === 1 && result.updated === 1 && result.removed === 1);
check('the Jomify-only folder is removed', !byId('J1'));
check('exactly the removed folder is tombstoned', Object.keys(getMeta().deletedFolders).length - tombstonesBefore === 1 && getMeta().deletedFolders.J1 > 0);
check('the updated folder is NOT tombstoned', getMeta().deletedFolders['folder-sp-aaa'] === undefined);
check('in-place update took the new name', byId('folder-sp-aaa').name === 'Rock');
check('nesting came through', byId('folder-sp-bbb').parentId === 'folder-sp-aaa');
check('the pin to the removed folder is dropped, the playlist pin stays', s().pinnedItems.map(p => p.id).join() === 'x1');

section('importFolderTree: merge keeps Jomify-only folders and moves playlists');
useUserStore.setState({
  customFolders: [
    { id: 'J2', name: 'Mine', playlistIds: ['y1', 'y2'], parentId: null, order: 1000 }
  ],
  pinnedItems: []
});
s().importFolderTree([{ id: 'folder-sp-ccc', name: 'Imported', playlistIds: ['y2'], parentId: null, order: 1000 }], { mode: 'merge' });
check('the Jomify-only folder survives', Boolean(byId('J2')));
check('a playlist claimed by the import moves out of it', byId('J2').playlistIds.join() === 'y1');
check('no tombstone in merge mode', getMeta().deletedFolders.J2 === undefined);
const snapshot = JSON.stringify(s().customFolders);
s().importFolderTree([{ id: 'folder-sp-ccc', name: 'Imported', playlistIds: ['y2'], parentId: null, order: 1000 }], { mode: 'merge' });
check('re-importing the same plan changes nothing', JSON.stringify(s().customFolders) === snapshot);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
