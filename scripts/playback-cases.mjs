// Case table for the playback adapter (Web API state -> SDK shape) and the history mirror.
// Run with: node scripts/playback-cases.mjs

import { toSdkShape, nextUid, resolveDeviceId, REPEAT_MODES } from '../src/services/spotify/playbackAdapter.js';

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const section = (t) => console.log(`\n-- ${t} --`);

const TRACK = {
  id: 't1', uri: 'spotify:track:t1', name: 'Song', type: 'track', duration_ms: 200000,
  artists: [{ id: 'a1', uri: 'spotify:artist:a1', name: 'Band' }],
  album: { name: 'Album', uri: 'spotify:album:al1', images: [{ url: 'x' }] }
};
const EPISODE = {
  id: 'e1', uri: 'spotify:episode:e1', name: 'Ep', type: 'episode', duration_ms: 3600000,
  images: [{ url: 'ep' }], show: { name: 'Show', uri: 'spotify:show:s1', images: [{ url: 'show' }] }
};
const webState = (over = {}) => ({
  is_playing: true, progress_ms: 5000, shuffle_state: false, repeat_state: 'off', timestamp: 1,
  context: { uri: 'spotify:playlist:p1' }, device: { id: 'd1', name: 'PC', type: 'Computer' }, item: TRACK, ...over
});

section('toSdkShape');
check('null in, null out', toSdkShape(null) === null);
const s = toSdkShape(webState());
check('paused is the inverse of is_playing', s.paused === false && toSdkShape(webState({ is_playing: false })).paused === true);
check('position and duration', s.position === 5000 && s.duration === 200000);
check('current track carries id, uri, name, artists, album images', s.track_window.current_track.id === 't1' && s.track_window.current_track.album.images[0].url === 'x' && s.track_window.current_track.artists[0].name === 'Band');
check('artists keep ids so TrackArtists can link them', s.track_window.current_track.artists[0].id === 'a1');
check('repeat_state maps to the SDK numbers', toSdkShape(webState({ repeat_state: 'context' })).repeat_mode === REPEAT_MODES.context && toSdkShape(webState({ repeat_state: 'track' })).repeat_mode === 2);
check('shuffle_state becomes shuffle', toSdkShape(webState({ shuffle_state: true })).shuffle === true);
check('context uri preserved', s.context.uri === 'spotify:playlist:p1');
check('remote flag set', s.remote === true);
const ep = toSdkShape(webState({ item: EPISODE }));
check('episode gets a synthesised album from its own art', ep.track_window.current_track.album.images[0].url === 'ep' && ep.track_window.current_track.album.name === 'Show');
check('episode artists fall back to the show', ep.track_window.current_track.artists[0].name === 'Show');
const noItem = toSdkShape(webState({ item: null }));
check('no item (private session) yields a null current track, not a throw', noItem.track_window.current_track === null && noItem.duration === 0);

section('nextUid');
const first = toSdkShape(webState());
const uid1 = first.track_window.current_track.uid;
check('uid minted with the remote prefix', typeof uid1 === 'string' && uid1.startsWith('remote:t1:'));
const later = toSdkShape(webState({ progress_ms: 9000 }), first);
check('same track, progress moved forward: uid kept', later.track_window.current_track.uid === uid1);
const restarted = toSdkShape(webState({ progress_ms: 100 }), later);
check('same track, progress jumped back: new uid (a replay)', restarted.track_window.current_track.uid !== uid1);
const other = toSdkShape(webState({ item: { ...TRACK, id: 't2' } }), later);
check('different track: new uid', other.track_window.current_track.uid !== uid1);
check('tiny backwards jitter within tolerance keeps the uid', nextUid(later, TRACK, 8000) === uid1);
check('same play keeps the same current_track object, so selectors see no change', later.track_window.current_track === first.track_window.current_track);
check('a new play gets a new current_track object', restarted.track_window.current_track !== later.track_window.current_track);

section('resolveDeviceId');
check('active device wins', resolveDeviceId({ activeDevice: { id: 'remote' }, sdkStatus: 'ready', deviceId: 'local' }) === 'remote');
check('falls back to the local SDK device when ready', resolveDeviceId({ activeDevice: null, sdkStatus: 'ready', deviceId: 'local' }) === 'local');
check('nothing when the SDK failed and nothing is active', resolveDeviceId({ activeDevice: null, sdkStatus: 'failed', deviceId: 'local' }) === null);
check('nothing when the SDK is still loading', resolveDeviceId({ activeDevice: null, sdkStatus: 'loading', deviceId: null }) === null);

section('history mirror');
// Stub enough of the browser for historySync + the store to load under node
const stack = [{ state: null }];
let index = 0;
const popListeners = [];
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  history: {
    pushState: (state) => { stack.splice(index + 1); stack.push({ state }); index = stack.length - 1; },
    replaceState: (state) => { stack[index] = { state }; },
    back: () => { if (index > 0) { index -= 1; setTimeout(() => popListeners.forEach(fn => fn({ state: stack[index].state })), 0); } }
  },
  addEventListener: (type, fn) => { if (type === 'popstate') popListeners.push(fn); },
  removeEventListener: (type, fn) => { const i = popListeners.indexOf(fn); if (i >= 0) popListeners.splice(i, 1); }
};
globalThis.localStorage = globalThis.window.localStorage;
const tick = () => new Promise(r => setTimeout(r, 5));

const { useUserStore } = await import('../src/store/userStore.js');
const { installHistorySync, syncSheetWithHistory } = await import('../src/pwa/historySync.js');
const store = useUserStore.getState;

const stop = installHistorySync();
check('base entry stamped', stack[0].state?.jomify === 0 && index === 0);

store().navigateToPlaylist('p1');
check('navigating pushes one browser entry', index === 1 && store().viewHistory.length === 1);
store().navigateToAlbum('al1');
check('second navigation pushes another', index === 2 && store().viewHistory.length === 2);

// Hardware back: browser pops, app follows
index -= 1; popListeners.forEach(fn => fn({ state: stack[index].state }));
await tick();
check('popstate walks the app back one view', store().currentView === 'playlist' && store().viewHistory.length === 1 && index === 1);

// In-app back: app pops, browser follows
store().goBack();
await tick();
check('in-app Back pulls the browser stack back too', store().currentView === 'home' && index === 0);

// Sheets
const unsub = syncSheetWithHistory((st) => st.isNowPlayingOpen, () => store().setNowPlayingOpen(false), { tag: 'np' });
store().setNowPlayingOpen(true);
check('opening a sheet pushes an entry', index === 1 && stack[1].state?.sheet === 'np');
index -= 1; popListeners.forEach(fn => fn({ state: stack[index].state }));
await tick();
check('popstate closes the sheet', store().isNowPlayingOpen === false && index === 0);
store().setNowPlayingOpen(true);
store().setNowPlayingOpen(false);
await tick();
check('closing from the UI pops the entry it pushed', index === 0);

const unsubGated = syncSheetWithHistory((st) => st.isQueueOpen, () => store().setQueueOpen(false), { tag: 'q', when: () => false });
store().setQueueOpen(true);
check('a sheet that opts out leaves history alone', index === 0);
store().setQueueOpen(false);
unsubGated();
unsub();
stop();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
