// Case table for the playback adapter (Web API state -> SDK shape) and the history mirror.
// Run with: node scripts/playback-cases.mjs

import { toSdkShape, nextUid, resolveDeviceId, REPEAT_MODES, describePlatform, playerNameFor, localDeviceLabel, deviceTypeLabel, sliderGain, startupGain } from '../src/services/spotify/playbackAdapter.js';

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

section('startup volume');
check('the slider curve is cubic', Math.abs(sliderGain(50) - 0.125) < 1e-9 && sliderGain(100) === 1 && sliderGain(0) === 0);
check('a device with a slider starts at its saved setting', Math.abs(startupGain(50, true) - 0.125) < 1e-9);
check('a device with a slider and nothing saved starts at half', Math.abs(startupGain(undefined, true) - 0.125) < 1e-9);
check('a phone ignores the saved setting and runs at full gain', startupGain(50, false) === 1 && startupGain(10, false) === 1);

section('device naming');
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
check('Windows from the user agent', describePlatform({ userAgent: WIN_UA, platform: 'Win32' }) === 'Windows');
check('Windows from client hints', describePlatform({ userAgent: '', userAgentData: { platform: 'Windows' } }) === 'Windows');
check('Mac', describePlatform({ userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 }) === 'Mac');
check('iPad reports itself as a Mac with touch', describePlatform({ userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 5 }) === 'iPad');
check('Android beats the Linux in its user agent', describePlatform({ userAgent: ANDROID_UA, platform: 'Linux armv8l' }) === 'Android');
check('iPhone', describePlatform({ userAgent: IPHONE_UA, platform: 'iPhone' }) === 'iPhone');
check('unknown platform is empty', describePlatform({}) === '');
check('player name carries the platform', playerNameFor('Windows') === 'Jomify on Windows');
check('player name without a platform is plain', playerNameFor('') === 'Jomify');
check('phone label', localDeviceLabel('Android') === 'This phone' && localDeviceLabel('iPhone') === 'This phone');
check('tablet label', localDeviceLabel('iPad') === 'This tablet');
check('computer label', localDeviceLabel('Windows') === 'This computer' && localDeviceLabel('') === 'This computer');
check('type labels read as words', deviceTypeLabel('Smartphone') === 'Phone' && deviceTypeLabel('CastVideo') === 'Chromecast');
check('unknown type falls through', deviceTypeLabel('Toaster') === 'Toaster' && deviceTypeLabel(undefined) === 'Device');

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
