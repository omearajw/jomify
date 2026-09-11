// Case table for the spotifyfolders importer. Run with: node scripts/import-cases.mjs

import {
  parseSpotifyFolders,
  planImport,
  playlistIdFromUri,
  folderIdFromUri,
  ImportFormatError
} from '../src/import/spotifyFolders.js';

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);
const rejects = (text, message) => {
  try { parseSpotifyFolders(text); return false; }
  catch (err) { return err instanceof ImportFormatError && err.message === message; }
};

const SAMPLE = {
  type: 'folder',
  uri: 'spotify:user:jack:folder:0000000000000000',
  children: [
    { type: 'playlist', uri: 'spotify:playlist:rootlevel1' },
    {
      type: 'folder', name: 'Rock', uri: 'spotify:user:jack:folder:aaaaaaaaaaaaaaaa',
      children: [
        { type: 'playlist', uri: 'spotify:playlist:pl1' },
        {
          type: 'folder', name: '80s', uri: 'spotify:user:jack:folder:BBBBBBBBBBBBBBBB',
          children: [
            { type: 'playlist', uri: 'spotify:playlist:pl2' },
            { type: 'playlist', uri: 'spotify:user:someone:playlist:pl3' },
            { type: 'folder', name: 'Hair%20Metal', uri: 'spotify:user:jack:folder:cccccccccccccccc', children: [
              { type: 'playlist', uri: 'spotify:playlist:pl1' }, // duplicate of Rock's
              { type: 'playlist', uri: 'spotify:playlist:unfollowed' }
            ] }
          ]
        },
        { type: 'playlist', uri: 'spotify:playlist:pl4' }
      ]
    },
    { type: 'folder', name: '', children: [
      { type: 'episode', uri: 'spotify:episode:x' },                 // unknown type: dropped at parse
      { type: 'playlist', uri: 'spotify:album:notaplaylist' }        // playlist node, non-playlist uri: ignored at plan
    ] },
    { type: 'folder', name: 'Jazz', uri: 'spotify:user:jack:folder:dddddddddddddddd' } // no children key at all
  ]
};
const LIBRARY = ['pl1', 'pl2', 'pl3', 'pl4', 'rootlevel1'].map(id => ({ id }));

section('uri helpers');
check('playlist uri', playlistIdFromUri('spotify:playlist:abc123') === 'abc123');
check('legacy user-scoped playlist uri', playlistIdFromUri('spotify:user:u:playlist:abc') === 'abc');
check('non-playlist uri is null', playlistIdFromUri('spotify:album:abc') === null);
check('folder uri -> deterministic id', folderIdFromUri('spotify:user:u:folder:ABCDEF') === 'folder-sp-abcdef');
check('malformed folder uri is null', folderIdFromUri('spotify:user:u:folder:') === null);

section('rejections');
check('non-JSON', rejects('nope', "That isn't valid JSON."));
check('Jomify backup file', rejects(JSON.stringify({ app: 'jomify', kind: 'backup' }), "That's a Jomify backup, not spotifyfolders output. Use Restore in the sidebar for backups."));
check('raw jomify-storage blob', rejects(JSON.stringify({ state: { customFolders: [] } }), "That's a Jomify backup, not spotifyfolders output. Use Restore in the sidebar for backups."));
check('unrelated object', rejects('{"hello":"world"}', "This doesn't look like spotifyfolders output. Expected a root folder object with a 'children' array."));
const deep = (n) => (n === 0 ? { type: 'folder', name: 'x', children: [] } : { type: 'folder', name: 'x', children: [deep(n - 1)] });
check('too deep', rejects(JSON.stringify({ type: 'folder', children: [deep(40)] }), 'This folder tree is too large or too deeply nested to import.'));

section('parsing');
const { root, ignored } = parseSpotifyFolders(JSON.stringify(SAMPLE));
check('root children preserved', root.children.length === 4);
check('bare array accepted as root children', parseSpotifyFolders(JSON.stringify(SAMPLE.children)).root.children.length === 4);
check('missing children defaults to []', root.children[3].children.length === 0);
check('percent-encoded names are decoded', root.children[1].children[1].children[2].name === 'Hair Metal');
check('empty names become Untitled folder', root.children[2].name === 'Untitled folder');
check('unknown node types are counted as ignored', ignored === 1);
check('a literal % in a name does not throw', parseSpotifyFolders(JSON.stringify({ type: 'folder', children: [{ type: 'folder', name: '100% Bangers', children: [] }] })).root.children[0].name === '100% Bangers');

section('planning: replace');
const plan = planImport(root, { playlists: LIBRARY, existingFolders: [
  { id: 'folder-j1', name: 'Jomify only', parentId: null, order: 1000, playlistIds: [] },
  { id: 'folder-sp-aaaaaaaaaaaaaaaa', name: 'Old Rock', parentId: null, order: 2000, playlistIds: [] }
], pinnedItems: [{ id: 'folder-j1', type: 'folder' }], mode: 'replace' });
const byId = Object.fromEntries(plan.folders.map(f => [f.id, f]));
check('five folders planned (Rock, 80s, Hair Metal, Untitled, Jazz)', plan.folders.length === 5);
check('ids derive from the Spotify hex, lowercased', Boolean(byId['folder-sp-aaaaaaaaaaaaaaaa']) && Boolean(byId['folder-sp-bbbbbbbbbbbbbbbb']));
check('nesting chain is correct', byId['folder-sp-bbbbbbbbbbbbbbbb'].parentId === 'folder-sp-aaaaaaaaaaaaaaaa' && byId['folder-sp-cccccccccccccccc'].parentId === 'folder-sp-bbbbbbbbbbbbbbbb');
check('sibling order follows JSON order', byId['folder-sp-aaaaaaaaaaaaaaaa'].order < byId['folder-sp-dddddddddddddddd'].order);
check('legacy playlist uri accepted', byId['folder-sp-bbbbbbbbbbbbbbbb'].playlistIds.includes('pl3'));
check('a playlist in two folders is kept in the first', byId['folder-sp-aaaaaaaaaaaaaaaa'].playlistIds.includes('pl1') && !byId['folder-sp-cccccccccccccccc'].playlistIds.includes('pl1'));
check('unfollowed playlists are skipped and reported', plan.stats.skipped === 1 && plan.stats.skippedUris[0] === 'spotify:playlist:unfollowed');
check('non-playlist uris are reported as ignored', plan.stats.ignoredUris.length === 1);
check('root-level playlists are not put in a folder', plan.stats.rootPlaylists === 1 && !plan.folders.some(f => f.playlistIds.includes('rootlevel1')));
check('a folder without a uri gets a positional fallback id', Object.keys(byId).some(id => id.startsWith('folder-sp-root-')) && plan.stats.noUri === 1);
check('created/updated split against existing folders', plan.stats.created === 4 && plan.stats.updated === 1);
check('replace removes only existing folders not in the plan', plan.stats.removed === 1);
check('removed pinned count', plan.stats.removedPinned === 1);
check('playlist count', plan.stats.playlists === 4);

section('planning: merge');
const merged = planImport(root, { playlists: LIBRARY, existingFolders: [
  { id: 'folder-j1', name: 'Jomify only', parentId: null, order: 5000, playlistIds: [] }
], mode: 'merge' });
check('nothing is removed in merge mode', merged.stats.removed === 0);
check('imported roots are ordered after Jomify-only roots', merged.folders.filter(f => f.parentId === null).every(f => f.order > 5000));
check('nested folder orders are unaffected by the root offset', merged.folders.find(f => f.id === 'folder-sp-bbbbbbbbbbbbbbbb').order === 2000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
