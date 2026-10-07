import { frameToPath, pathToFrame, sameFrame } from '../src/pwa/routes.js';
let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const f = (view, extra = {}) => ({ view, playlistId: null, artistId: null, albumId: null, folderId: null, userId: null, ...extra });
check('home is /', frameToPath(f('home')) === '/');
check('playlist path', frameToPath(f('playlist', { playlistId: 'p1' })) === '/playlist/p1');
check('folder path', frameToPath(f('library', { folderId: 'f 1' })) === '/library/folder/f%201');
check('search with query', frameToPath(f('browse'), { query: 'tame impala' }) === '/search?q=tame%20impala');
check('liked songs', frameToPath(f('liked-songs')) === '/liked');
for (const [view, extra] of [['home'], ['library'], ['sevens'], ['friends'], ['party'], ['liked-songs'], ['playlist', { playlistId: 'abc' }], ['album', { albumId: 'x1' }], ['artist', { artistId: 'a' }], ['user', { userId: "j.o'meara" }], ['library', { folderId: 'f1' }]]) {
  const frame = f(view, extra);
  const back = pathToFrame(frameToPath(frame));
  check(`${view} round-trips`, sameFrame(frame, back));
}
check('search keeps the query', pathToFrame('/search', '?q=hello%20there').query === 'hello there');
check('unknown path is null', pathToFrame('/nothing/here') === null);
check('api path is null', pathToFrame('/api/sync') === null);
check('trailing slash tolerated', pathToFrame('/library/').view === 'library');
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
console.log('');
