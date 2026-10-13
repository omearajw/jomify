// Jomify's queue, the pure parts: when the next song is handed to Spotify, how it is recognised
// when it plays, and how the list is edited.
import { slimTrack, isItem, feedDue, resolveFed, withoutQueued, removeKey, moveKey, indexOfTrack, migrateManual, FEED_AT_MS, FED_TIMEOUT_MS, FEED_RETRY_MS } from '../src/services/queueLogic.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

const song = (id, name, artist = 'A') => ({ id, uri: `spotify:track:${id}`, name, duration_ms: 200000, artists: [{ id: 'ar', name: artist }], album: { id: 'al', name: 'Al', images: [{ url: 'x', width: 640, height: 640 }, { url: 'y', width: 64, height: 64 }] } });
const items = [slimTrack(song('a', 'One')), slimTrack(song('b', 'Two')), slimTrack(song('c', 'Three'))];

check('a slimmed song keeps one image and its artists', items[0].album.images.length === 1 && items[0].artists[0].name === 'A' && typeof items[0].key === 'string');
check('keys are distinct', new Set(items.map((i) => i.key)).size === 3);

// recognising a queued song
check('by uri', isItem({ uri: 'spotify:track:a' }, items[0]));
check('by id', isItem({ id: 'a' }, items[0]));
check('a relinked copy, by what it was linked from', isItem({ uri: 'spotify:track:a-gb', linked_from: { uri: 'spotify:track:a' } }, items[0]));
check('a relinked copy with no linked_from, by name and artists', isItem({ uri: 'spotify:track:a-gb', name: 'One', artists: [{ name: 'A' }] }, items[0]));
check('a different song of the same name by someone else is not it', !isItem({ uri: 'spotify:track:z', name: 'One', artists: [{ name: 'B' }] }, items[0]));
check('nothing is not it', !isItem(null, items[0]));

// when to hand over
const playing = { paused: false, duration: 200000 };
const now = 1000000;
check('handed over with 15s left', feedDue({ state: playing, posMs: 200000 - FEED_AT_MS + 1000, now, fed: null, items }));
check('not with 30s left', !feedDue({ state: playing, posMs: 170000, now, fed: null, items }));
check('not while paused', !feedDue({ state: { ...playing, paused: true }, posMs: 190000, now, fed: null, items }));
check('not with nothing queued', !feedDue({ state: playing, posMs: 190000, now, fed: null, items: [] }));
check('not while one is already handed over', !feedDue({ state: playing, posMs: 190000, now, fed: { item: items[0], at: now }, items }));
check('not straight after a refusal', !feedDue({ state: playing, posMs: 190000, now, fed: null, items, lastFailAt: now - FEED_RETRY_MS + 1000 }));
check('again once the refusal is a while ago', feedDue({ state: playing, posMs: 190000, now, fed: null, items, lastFailAt: now - FEED_RETRY_MS - 1 }));
check('not with no song at all', !feedDue({ state: null, posMs: 0, now, fed: null, items }));

// what became of a handed-over song
const fed = { item: items[0], at: now };
check('heard playing: played', resolveFed(fed, { uri: 'spotify:track:a' }, now + 5000) === 'played');
check('something else playing, soon after: waiting', resolveFed(fed, { uri: 'spotify:track:x' }, now + 5000) === 'waiting');
check('something else playing, long after: timeout', resolveFed(fed, { uri: 'spotify:track:x' }, now + FED_TIMEOUT_MS + 1) === 'timeout');
check('nothing handed over: none', resolveFed(null, { uri: 'spotify:track:a' }, now) === 'none');

// the panel's "next from the playlist"
const spotifyQueue = [{ uri: 'spotify:track:a', name: 'One' }, { uri: 'spotify:track:p1', name: 'Playlist song' }, { uri: 'spotify:track:b', name: 'Two' }];
const rest = withoutQueued(spotifyQueue, items);
check("songs Jomify holds are taken out of Spotify's list", rest.length === 1 && rest[0].uri === 'spotify:track:p1');
check('each queued song takes out one copy only', withoutQueued([{ uri: 'spotify:track:a' }, { uri: 'spotify:track:a' }], [items[0]]).length === 1);

// editing
check('remove by key', removeKey(items, items[1].key).map((i) => i.id).join('') === 'ac');
check('move to the front', moveKey(items, items[2].key, 0).map((i) => i.id).join('') === 'cab');
check('move to the end', moveKey(items, items[0].key, 5).map((i) => i.id).join('') === 'bca');
check('moving an unknown key changes nothing', moveKey(items, 'nope', 0) === items);
check('the first matching item of a playing track', indexOfTrack(items, { uri: 'spotify:track:b' }) === 1);
check('a track not queued', indexOfTrack(items, { uri: 'spotify:track:zz' }) === -1);

// carrying the old record over
const migrated = migrateManual([{ uri: 'spotify:track:m', name: 'Old', artists: [] }, { name: 'no uri' }]);
check('the old hand-queued list comes over, songs without a uri dropped', migrated.length === 1 && migrated[0].uri === 'spotify:track:m' && migrated[0].addedAt === 0);
check('nothing to carry over gives an empty queue', migrateManual(null).length === 0);

console.log(`\nqueue: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
