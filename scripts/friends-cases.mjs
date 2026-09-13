// Case table for the friends feature: profile-link parsing, the store actions, navigation
// history and the sync round-trip. Run with: node scripts/friends-cases.mjs

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};
globalThis.localStorage = storage;
globalThis.window = { localStorage: storage };

const { userIdFromInput } = await import('../src/utils/spotifyUri.js');
const { useUserStore } = await import('../src/store/userStore.js');
const { storeToDoc, docToStore, docToMetaClocks } = await import('../src/sync/transform.js');
const { mergeSyncDoc } = await import('../src/sync/mergeSyncDoc.js');

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);
const s = () => useUserStore.getState();

section('userIdFromInput');
check('open.spotify.com link', userIdFromInput('https://open.spotify.com/user/jack123') === 'jack123');
check('link with share suffix', userIdFromInput('https://open.spotify.com/user/jack123?si=abc&nd=1') === 'jack123');
check('intl link', userIdFromInput('https://open.spotify.com/intl-de/user/jack123') === 'jack123');
check('no scheme', userIdFromInput('open.spotify.com/user/31abc') === '31abc');
check('uri', userIdFromInput('spotify:user:jack123') === 'jack123');
check('bare id', userIdFromInput('  jack123 ') === 'jack123');
check('percent-encoded id decoded', userIdFromInput('https://open.spotify.com/user/jack%20o') === 'jack o');
check('playlist link rejected', userIdFromInput('https://open.spotify.com/playlist/abc') === null);
check('sentence rejected', userIdFromInput('my friend jack') === null);
check('empty rejected', userIdFromInput('') === null && userIdFromInput(null) === null);

section('store');
useUserStore.setState({ friends: [], viewHistory: [], currentView: 'home', currentUserId: null });
s().addFriend({ id: 'anna', display_name: 'Anna', images: [{ url: 'a.png' }] });
check('addFriend stores id, name and image', s().friends.length === 1 && s().friends[0].name === 'Anna' && s().friends[0].image === 'a.png');
s().addFriend({ id: 'anna', display_name: 'Anna again' });
check('addFriend is idempotent', s().friends.length === 1 && s().friends[0].name === 'Anna');
s().addFriend({ id: 'ben', name: 'Ben' });
check('addFriend accepts the stored shape too', s().friends.length === 2 && s().friends[1].name === 'Ben');
s().removeFriend('anna');
check('removeFriend', s().friends.length === 1 && s().friends[0].id === 'ben');

section('navigation');
s().navigateToUser('ben');
check('navigateToUser opens the user view with a history frame', s().currentView === 'user' && s().currentUserId === 'ben' && s().viewHistory.length === 1);
s().navigateToUser('ben');
check('navigating to the same user twice pushes nothing', s().viewHistory.length === 1);
s().navigateToPlaylist('p1');
check('the playlist frame remembers which user we were on', s().viewHistory[1].userId === 'ben');
s().goBack();
check('goBack restores the user', s().currentView === 'user' && s().currentUserId === 'ben');
s().goBack();
check('goBack to home clears the user', s().currentView === 'home' && s().currentUserId === null);

section('sync round-trip');
useUserStore.setState({ friends: [{ id: 'ben', name: 'Ben', image: null, addedAt: 1 }], customFolders: [], pinnedItems: [] });
const meta = { folders: {}, pins: {}, deletedFolders: {}, deletedPins: {}, friendsT: 4200 };
const doc = storeToDoc(s(), meta);
check('storeToDoc carries friends with its clock', doc.friends.v.length === 1 && doc.friends.t === 4200);
const merged = mergeSyncDoc(doc, { friends: { v: [], t: 100 } });
check('an empty, older list does not erase friends', merged.friends.v.length === 1);
check('docToStore restores friends', docToStore(merged).friends[0].id === 'ben');
check('docToMetaClocks adopts friendsT', docToMetaClocks(merged, {}).friendsT === 4200);
check('docToStore tolerates a doc without friends', Array.isArray(docToStore({ folders: {}, pins: {} }).friends));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
