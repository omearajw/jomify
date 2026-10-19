// The play queue, carried out (redesign agreed 19 Oct 2026; the pure rules are in model.js).
// Jomify holds the queue and gives Spotify a list to play: the current song and up to 500 after
// it. Spotify plays through that list by itself. When the queue changes so that Spotify's next
// song is no longer the queue's, Jomify hands over a new list 0.3 s before the song ends (seamless
// on Jack's account; a list swapped mid-song drops ~0.3 s of music, so that is never done unasked).
//
// What Spotify actually plays is folded back in on every report (reconcile), so a skip from the
// lock screen, another app or a missed switch is taken as fact and the queue follows it. Playback
// started somewhere else from a playlist or album (the Spotify app, say) is adopted: its songs are
// loaded and the queue takes over at the next song change.
//
// Only one device carries the queue out: this browser when its own player is the one playing,
// otherwise the holder of the server lease, and never while another Jomify is the device playing.
// Behind the "New queue" setting until Jack has tried it; off, and during a party, the old path
// runs exactly as before.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as Q from './model';
import { loadSource, kindOf } from './sources';
import { pull, push } from './share';
import { usePlayerStore } from '../store/playerStore';
import { useUserStore } from '../store/userStore';
import { usePartyStore } from '../store/partyStore';
import { useQueueStore } from '../store/queueStore';
import { toast } from '../store/toastStore';
import { playList, playContext, addToQueue, toggleShuffleState, setRepeatMode, fetchArtistTopTracks, fetchPlaylistTrackArtists } from '../services/spotify/api';
import { REPEAT_NAMES } from '../services/spotify/playbackAdapter';
import { playOn, skipRaw, activateLocalPlayer, handlePlaybackError } from '../services/spotify/playbackController';
import { loadAllLikedSongs } from '../services/likedLibrary';
import { hostApi } from '../party/client';
import { askLease } from '../services/queueLease';
import { positionNow } from '../lib/playbackClock';
import { isSameTrack } from '../utils/spotifyUri';
import { log } from '../services/debugLog';

const SWITCH_LEAD_MS = 300;
const PLAN_AHEAD_MS = 20000;     // a switch is timed from this close to the end, so drift is small
const KEEP_SOURCE_SONGS = 1500;  // a longer source is stored on the device without its songs
const KEEP_THEN_SONGS = 600;
const LEASE_RENEW_MS = 10000;

// The queue: this device's copy (kept across reloads), and `rev`, the revision of the copy all
// the listener's devices share (api/queue.js) that this one was last in step with
export const useQueue = create(persist(() => ({ q: Q.emptyQueue(), given: null, rev: 0 }), {
  name: 'jomify-queue-v2',
  version: 1,
  partialize: ({ q, given, rev }) => ({ q: storable(q), given, rev })
}));

function storable(q) {
  let out = q;
  if (q.source && q.source.tracks.length > KEEP_SOURCE_SONGS) out = { ...out, source: { ...q.source, tracks: [], partial: true } };
  if (q.then.length > KEEP_THEN_SONGS) out = { ...out, then: q.then.slice(0, KEEP_THEN_SONGS) };
  return out;
}

const get = () => useQueue.getState();
const setQ = (q) => useQueue.setState({ q });
const player = () => usePlayerStore.getState();
const token = () => useUserStore.getState().token;
const current = () => player().playbackState?.track_window?.current_track || null;

export const engineOn = () => useUserStore.getState().playbackSettings?.queueEngine === true;
// A party (src/party): guests' requests are Next up, in the party's order, taken one at a time
// from the party server just before they are due; the backing playlist is Then. Only the
// device conducting the party carries it out.
const partyCode = () => usePartyStore.getState().code;
const REQUEST_AT_MS = 15000;
const dlog = (message, detail) => log('queue', message, detail);
const describeSong = (e) => (e ? `${e.name}${e.artists?.[0]?.name ? ` by ${e.artists[0].name}` : ''}` : 'nothing');

// --- shared between the listener's devices ----------------------------------------------------
// The device playing the music sends the whole queue when it changes it (a "set", refused if
// another device changed it meanwhile, which is then folded in); an edit made anywhere (add,
// play next, remove, move, clear) is sent as just that edit, so two devices never overwrite each
// other. Other devices look for changes every 20 s while on screen, the playing one once per song
// shortly before it ends, and every device when it opens or comes back to the front.

const SHARE_SOURCE_SONGS = 400;
const SHARE_THEN_SONGS = 400;
const SHARE_PLAYED = 40;
const PULL_EVERY_MS = 20000;

function shareable(q) {
  let out = { ...q, played: q.played.slice(0, SHARE_PLAYED) };
  if (q.source && q.source.tracks.length > SHARE_SOURCE_SONGS) out = { ...out, source: { ...q.source, tracks: [], partial: true } };
  if (q.then.length > SHARE_THEN_SONGS) out = { ...out, then: q.then.slice(0, SHARE_THEN_SONGS) };
  return out;
}

// The shared copy, taken as this device's; a long source's songs, which the shared copy leaves
// out, kept from this device's own copy when it has them
function take(server) {
  if (!server) return;
  if (!server.q) { useQueue.setState({ rev: server.rev }); return; }
  const local = get().q.source;
  let q = server.q;
  if (q.source?.partial && local && !local.partial && local.uri && local.uri === q.source.uri && local.kind === q.source.kind) q = { ...q, source: local };
  useQueue.setState({ q, given: server.given ?? null, rev: server.rev });
  reloadPartial();
}

let setTimer = null;
const shareSoon = () => { if (!engineOn()) return; clearTimeout(setTimer); setTimer = setTimeout(() => shareNow(false), 800); };

async function shareNow(force) {
  clearTimeout(setTimer);
  setTimer = null;
  if (!engineOn()) return;
  const { q, given, rev } = get();
  const res = await push({ op: 'set', base: rev, force, args: { q: shareable(q), given } });
  if (!res) return;
  if (!res.conflict) { if (get().q === q) useQueue.setState({ rev: res.rev }); else shareSoon(); return; }
  // another device changed the queue: theirs, with what Spotify is playing here folded in
  if (!res.q) { useQueue.setState({ rev: res.rev }); shareSoon(); return; }
  take(res);
  const track = current();
  if (track) { const r = Q.reconcile(get().q, track); if (r.change !== 'same') setQ(r.queue); }
  dlog('folded in a change from another device');
  shareSoon();
}

function edited(op, args) {
  if (!engineOn()) return;
  const sent = get().q;
  push({ op, args }).then((res) => {
    // the shared copy, with this edit and any other device's, unless this device has moved on since
    if (res && !res.conflict && get().q === sent) take(res);
  });
}

async function pullNow() {
  if (!engineOn() || setTimer) return;
  const res = await pull(get().rev);
  if (res && res.rev !== get().rev && !setTimer) { take(res); dlog('the queue changed on another device'); }
}

// --- carrying it out --------------------------------------------------------------------------

let lease = { held: null, at: 0, asking: null };
async function inCharge() {
  const p = player();
  if (partyCode() && !usePartyStore.getState().conductor) return false;
  if (p.isLocalActive) return true;
  if (!p.activeDevice) return false;
  if (/^Jomify\b/.test(p.activeDevice.name || '')) return false;
  if (Date.now() - lease.at > LEASE_RENEW_MS && !lease.asking) {
    lease.asking = askLease(useQueueStore.getState().instanceId).then((held) => { lease = { held, at: Date.now(), asking: null }; });
  }
  if (lease.at === 0) await lease.asking;
  return lease.held !== false;
}

// Spotify's own shuffle stays off (Jomify does the shuffling) and its repeat is only ever "this
// song"; a list started with Spotify's shuffle on may not start where asked
async function modesFor(deviceId, q) {
  const t = token();
  const st = player().playbackState;
  const wantRepeat = q.repeat === 'one' ? 'track' : 'off';
  if (!st || st.shuffle !== false) await toggleShuffleState(t, deviceId, false).catch(() => {});
  if (!st || REPEAT_NAMES[st.repeat_mode] !== wantRepeat) await setRepeatMode(t, wantRepeat, deviceId).catch(() => {});
}

// Make q the queue and give Spotify its list, starting at positionMs into the first song
// `force`: an explicit action here (play, skip, a chosen song) wins over another device's edit
async function hand(q, { deviceId = null, positionMs = 0, why = '', force = true } = {}) {
  passive = false;
  setQ(q);
  const list = Q.toGive(q);
  if (!list) { shareNow(force); return; }
  await modesFor(deviceId, q);
  await playList(token(), deviceId, list.uris, positionMs);
  useQueue.setState({ given: list });
  dlog(`gave Spotify ${list.uris.length} song${list.uris.length === 1 ? '' : 's'} from ${describeSong(q.now)}`, why);
  shareNow(force);
}

// --- song changes -----------------------------------------------------------------------------

let lastUri = null;
let adopting = null;
// Spotify is playing songs this queue didn't give it (a list another Jomify handed over, a song
// played from the Spotify app): stand back and let it play, until it reaches a song of the queue's
// again or someone acts here. Until the queue is shared between devices (batch 6) this is what
// stops two Jomifys fighting over the music.
let passive = false;
let checkedElsewhere = false;

function onPlayerState() {
  if (!engineOn()) return;
  const st = player().playbackState;
  const track = st?.track_window?.current_track;
  if (track?.uri && track.uri !== lastUri && !String(track.uid || '').startsWith('pending:')) {
    lastUri = track.uri;
    const contextUri = st.context?.uri || null;
    const { q } = get();
    // Spotify playing a playlist or album of its own (started in its app, or before the queue was
    // switched on): take it over, unless it is the unreadable one the queue already let it play
    if (contextUri && kindOf(contextUri) && !(q.source?.readOnly && q.source.uri === contextUri)) adopt(contextUri, track, st.shuffle);
    else {
      const r = Q.reconcile(q, track);
      if (r.change === 'outside' && !contextUri && !checkedElsewhere) {
        // perhaps another device started it: its queue first, then decide
        checkedElsewhere = true;
        pullNow().finally(() => { lastUri = null; onPlayerState(); checkedElsewhere = false; });
        return;
      }
      const wasPassive = passive;
      passive = r.change === 'outside' && !contextUri;
      // a party request heard playing is done with (the queue may already have it as now, handed over)
      if (r.queue.now?.request && driving()) requestPlayed(r.queue.now);
      if (r.change !== 'same' && r.change !== 'none') {
        setQ(r.queue);
        if (!passive) shareSoon();
        dlog(`now ${describeSong(r.queue.now)}`, `${r.change}${passive && !wasPassive ? '; not from this queue, so it plays as Spotify was told' : ''}`);
      }
    }
  }
  plan();
}

// A source's name from the library, for one Jomify didn't start itself
function nameOf(uri) {
  const what = kindOf(uri);
  const user = useUserStore.getState();
  if (what?.kind === 'playlist') return (user.playlists || []).find((p) => p.id === what.id)?.name || '';
  if (what?.kind === 'album') return (user.albums || []).find((a) => a.id === what.id)?.name || '';
  if (what?.kind === 'liked') return 'Liked Songs';
  return '';
}

async function adopt(contextUri, track, shuffle) {
  if (adopting === contextUri) return;
  adopting = contextUri;
  const what = kindOf(contextUri);
  try {
    const name = nameOf(contextUri);
    const loaded = await loadSource(contextUri, { onFull: (all, total) => applyFull(contextUri, what.kind, name, all, total, { reshuffle: true }) });
    if (!loaded) return;
    const src = Q.source({ kind: what.kind, uri: contextUri, name, tracks: loaded.pairs, total: loaded.total });
    const at = src.tracks.find((e) => isSameTrack(e, track));
    const q = Q.play(get().q, src, { start: at ? at.i : null, shuffle: Boolean(shuffle) });
    setQ(at ? q : { ...q, now: Q.entry(track, 'outside') });
    useQueue.setState({ given: null });
    shareNow(true);
    if (shuffle) setShuffleShown(true);
    dlog(`took over ${what.kind} playing in Spotify`, `${src.tracks.length} of ${loaded.total} songs loaded; Jomify's list from the next song`);
    plan();
  } catch (err) {
    dlog('could not take over what Spotify is playing', err?.message || String(err));
  } finally {
    adopting = null;
  }
}

function applyFull(uri, kind, name, all, total, { reshuffle = false } = {}) {
  const { q } = get();
  if (q.source?.uri !== uri) return;
  setQ(Q.withFullSource(q, Q.source({ kind, uri, name: name || q.source.name, tracks: all, total }), { reshuffle }));
  shareSoon();
  dlog(`all ${all.length} songs of ${q.source.name || kind} loaded`);
}

// When the queue says Spotify needs a new list (or the "when a playlist ends" setting has more to
// play), time the hand-over for just before the song ends
let timer = null;
let planned = 0;
let prepared = null; // { key, promise } the continuation after the last song, worked out early
let pulledFor = null; // the song this device last looked for other devices' edits before
let requestTriedFor = null; // the song a party request was last taken for

// --- a party's requests -------------------------------------------------------------------------

const fromRequest = (item) => ({
  ...Q.entry({ uri: item.uri, id: item.uri.split(':').pop(), name: item.name, duration_ms: item.durationMs || 0, artists: String(item.artists || '').split(', ').filter(Boolean).map((name) => ({ name })), album: { images: item.image ? [{ url: item.image }] : [] } }, 'next'),
  request: item.id,
  by: item.guestName || ''
});

// The head of the party's queue, as it stands now (votes and pins up to the last moment), lined up
// to play next; the party server marks it handed over, so guests see it as next
let taking = null;
async function takeRequest() {
  const code = partyCode();
  if (!code) return null;
  if (taking) return taking;
  if (get().q.next.some((e) => e.request)) return null;
  taking = (async () => {
    try {
      const { item } = await hostApi.op(code, { op: 'next' });
      if (!item) return null;
      usePartyStore.setState((st) => ({ upNext: item, queue: (st.queue || []).filter((i) => i.id !== item.id) }));
      const e = fromRequest(item);
      setQ(Q.addEntries(get().q, [e], { first: true }));
      shareSoon();
      dlog(`lined up ${item.name} for ${item.guestName || 'a guest'}`);
      return e;
    } catch (err) {
      dlog('could not take the next request', err?.message || String(err));
      return null;
    } finally {
      taking = null;
    }
  })();
  return taking;
}

const confirmed = new Set();
function requestPlayed(e) {
  const code = partyCode();
  if (!code || !e?.request || confirmed.has(e.request)) return;
  confirmed.add(e.request);
  hostApi.op(code, { op: 'played', id: e.request }).then((res) => usePartyStore.getState().applyState(res)).catch(() => {});
}
function requestNotPlayed(e) {
  const code = partyCode();
  if (code && e?.request) hostApi.op(code, { op: 'unfed' }).catch(() => {});
}

// Songs added by hand wait while a party runs, and come back when it ends
function partyChanged(on) {
  if (!engineOn()) return;
  const { q } = get();
  if (on) {
    const mine = q.next.filter((e) => !e.request);
    if (!mine.length) return;
    setQ({ ...q, next: q.next.filter((e) => e.request), held: [...(q.held || []), ...mine] });
    dlog(`your ${mine.length} queued song${mine.length === 1 ? '' : 's'} will wait until the party ends`);
  } else {
    setQ({ ...q, next: [...(q.held || []), ...q.next.filter((e) => !e.request)], held: [] });
  }
  shareSoon();
}

async function plan() {
  clearTimeout(timer);
  timer = null;
  const ticket = ++planned;
  if (!engineOn() || passive) return;
  const st = player().playbackState;
  const { q, given } = get();
  if (!st || st.paused || !st.duration || !q.now || !isSameTrack(q.now, current())) return;
  const left = st.duration - positionNow();
  // a position past the end is a stale report, not a song about to end
  if (left < -2000) return;
  if (!(await inCharge()) || ticket !== planned) return;
  if (left > PLAN_AHEAD_MS) { timer = setTimeout(plan, left - PLAN_AHEAD_MS + 1000); return; }
  const key = q.now.key;
  // near the end: anything another device queued, and at a party the next request
  if (pulledFor !== key) { pulledFor = key; pullNow(); }
  if (partyCode() && requestTriedFor !== key && !q.next.some((e) => e.request) && (usePartyStore.getState().queue || []).length) {
    if (left > REQUEST_AT_MS) { timer = setTimeout(plan, left - REQUEST_AT_MS + 200); return; }
    requestTriedFor = key;
    takeRequest(); // the queue changes, and this plans again
    return;
  }
  const ending = !Q.nextUp(q) && q.repeat !== 'one';
  if (!Q.needsSwitch(q, given) && !(ending && continues())) return;
  if (ending && prepared?.key !== key) prepared = { key, promise: continuation(q).catch(() => null) };
  const wait = Math.max(0, left - SWITCH_LEAD_MS);
  const due = Date.now() + wait;
  timer = setTimeout(() => switchNow(key, due), wait);
}

async function switchNow(key, due = Date.now()) {
  const { q } = get();
  const st = player().playbackState;
  // how the timer kept time (a page off screen has its timers slowed), for the debug log
  const timing = `timer ${Date.now() - due} ms late, ${Math.round(st ? st.duration - positionNow() : 0)} ms of the song left, page ${document.visibilityState}`;
  if (!q.now || q.now.key !== key || !st || st.paused || !isSameTrack(q.now, current())) { dlog('no switch: the song had already changed', timing); return; }
  let after = Q.advance(q);
  if (!after.now) {
    after = prepared?.key === key ? await prepared.promise : null;
    if (!after?.now) return;
  }
  try {
    await hand(after, { deviceId: player().activeDevice?.id || null, why: `at the song change; ${timing}`, force: false });
  } catch (err) {
    dlog('could not hand Spotify the next list', err?.message || String(err));
    requestNotPlayed(after.now);
  }
}

// "When a playlist ends": what plays after the last song, as a new source
const continues = () => ['liked', 'artists'].includes(useUserStore.getState().playbackSettings?.whenPlaylistEnds);

async function continuation(q) {
  const setting = useUserStore.getState().playbackSettings?.whenPlaylistEnds;
  const t = token();
  const ended = Q.advance(q);
  if (setting === 'liked') {
    const userId = useUserStore.getState().profile?.id;
    if (!userId) return null;
    const tracks = await loadAllLikedSongs(t, userId);
    dlog('the playlist ran out; carrying on into Liked Songs');
    return Q.play(ended, Q.source({ kind: 'liked', uri: `spotify:user:${userId}:collection`, name: 'Liked Songs', tracks }), { shuffle: true });
  }
  if (setting === 'artists') {
    const playlistId = /^spotify:playlist:(.+)$/.exec(q.source?.uri || '')?.[1];
    if (!playlistId) return null;
    const own = await fetchPlaylistTrackArtists(t, playlistId);
    const mine = new Set(own.map((x) => x.id));
    const names = new Map(own.flatMap((x) => x.artists.map((a) => [a.id, a.name])));
    const artistIds = [...names.keys()].sort(() => Math.random() - 0.5).slice(0, 8);
    const pool = [];
    for (const id of artistIds) pool.push(...(await fetchArtistTopTracks(t, id, names.get(id))).filter((x) => x?.uri && !mine.has(x.id)));
    const seen = new Set();
    const tracks = pool.filter((x) => !seen.has(x.uri) && seen.add(x.uri)).sort(() => Math.random() - 0.5).slice(0, 60);
    if (!tracks.length) return null;
    dlog("the playlist ran out; carrying on with songs by its artists", `${artistIds.length} artists, ${tracks.length} songs`);
    return Q.play(ended, Q.source({ kind: 'list', name: `More from ${q.source?.name || 'the playlist'}'s artists`, tracks }), { shuffle: false });
  }
  return null;
}

// --- shuffle and repeat, as shown -------------------------------------------------------------

function setShuffleShown(on) { player().setShuffle(on); }
function setRepeatShown(mode) { player().setRepeatMode({ off: 0, all: 1, one: 2 }[mode] ?? 0); }

// --- what the rest of the app calls ----------------------------------------------------------

// Whether this device's queue is the one playing: this browser is the player, or the music is on
// a device that is no Jomify (an Alexa, the Spotify app); never while another Jomify plays it
const driving = () => {
  const p = player();
  if (partyCode() && !usePartyStore.getState().conductor) return false;
  return p.isLocalActive || Boolean(p.activeDevice && !/^Jomify\b/.test(p.activeDevice.name || ''));
};
// Whether this device's copy of the queue describes what is playing. Explicit actions (skip, back,
// a chosen song) work from any device, the queue being shared; one not carrying the queue out
// looks for the latest copy first.
const synced = (q) => !passive && Boolean(q.now && isSameTrack(q.now, current()));
const fresh = async () => { if (!driving()) await pullNow(); return get().q; };

// Press play on something. desc: { uri, kind, name, tracks, start, startUri, shuffle, track }:
// `tracks` when the screen already has every song (a list, an album, a sorted view), else they
// are loaded from `uri`. `start`: the index of the song to start on (in `tracks`' order).
export async function playSource(desc) {
  activateLocalPlayer(); // while still inside the tap
  if (!token()) return;
  const { q } = get();
  const shuffle = desc.shuffle ?? q.shuffle;
  const kind = desc.kind || kindOf(desc.uri)?.kind || 'list';
  let start = desc.start ?? null;
  let src;
  if (desc.tracks) {
    if (start === null && desc.startUri) start = Math.max(0, desc.tracks.findIndex((t) => t?.uri === desc.startUri));
    src = Q.source({ kind, uri: desc.uri || null, name: desc.name || '', tracks: desc.tracks });
  } else {
    let loaded = null;
    try {
      loaded = await loadSource(desc.uri, { start: start ?? (shuffle ? 'random' : null), onFull: (all, total) => applyFull(desc.uri, kind, desc.name, all, total, { reshuffle: true }) });
    } catch (err) {
      dlog(`could not load ${desc.name || desc.uri}`, err?.message || String(err));
    }
    if (!loaded) return playReadOnly(desc, kind, start);
    start = loaded.start;
    src = Q.source({ kind, uri: desc.uri, name: desc.name || '', tracks: loaded.pairs, total: loaded.total });
  }
  const next = Q.play(q, src, { start, shuffle });
  if (!next.now) { toast("None of these songs can be played here", { tone: 'info' }); return; }
  if (shuffle !== q.shuffle) setShuffleShown(shuffle);
  dlog(`play ${src.kind}${src.name ? ` ${src.name}` : ''}`, `${src.tracks.length}${src.total > src.tracks.length ? ` of ${src.total}` : ''} songs, from ${describeSong(next.now)}${shuffle ? ', shuffled' : ''}`);
  if (desc.deviceId) return hand(next, { deviceId: desc.deviceId, why: 'play' });
  return playOn((deviceId) => hand(next, { deviceId, why: 'play' }), { track: desc.track || next.now });
}

// A playlist Jomify may not read (one of Spotify's own): Spotify plays it its own way, read-only
function playReadOnly(desc, kind, start) {
  if (!desc.uri) return undefined;
  const { q } = get();
  setQ({ ...q, source: { kind, uri: desc.uri, name: desc.name || '', readOnly: true, tracks: [] }, then: [], out: [] });
  useQueue.setState({ given: null });
  shareNow(true);
  dlog(`play ${desc.name || desc.uri} the Spotify way`, "Jomify can't read its songs");
  return playOn((deviceId) => playContext(token(), deviceId, desc.uri, typeof start === 'number' ? start : 0), { track: desc.track });
}

export function add(tracks) {
  const { q } = get();
  const entries = tracks.filter((t) => t?.uri).map((t) => Q.entry(t, 'next'));
  const next = Q.addEntries(q, entries);
  setQ(next);
  edited('add', { entries });
  if (q.source?.readOnly) tracks.forEach((t) => addToQueue(token(), player().activeDevice?.id || null, t.uri).catch(() => {}));
  // nothing on screen at all: start the first of them now rather than wait for a song end that
  // won't come (a paused song on screen waits for Play, as it should)
  if (!player().playbackState?.track_window?.current_track) {
    const started = Q.advance({ ...next, now: null });
    if (started.now) playOn((deviceId) => hand(started, { deviceId, why: 'queued with nothing playing' }), { track: started.now });
  }
}

export function playNext(tracks) {
  const entries = tracks.filter((t) => t?.uri).map((t) => Q.entry(t, 'next'));
  setQ(Q.addEntries(get().q, entries, { first: true }));
  edited('playNext', { entries });
}
export function promote(key) { setQ(Q.promote(get().q, key)); edited('promote', { key }); }
export function remove(key) { setQ(Q.remove(get().q, key)); edited('remove', { key }); }
export function move(key, toIndex) { setQ(Q.move(get().q, key, toIndex)); edited('move', { key, to: toIndex }); }
export function clear() { setQ(Q.clear(get().q)); edited('clear', {}); }

export async function jumpTo(key) {
  activateLocalPlayer();
  const next = Q.jumpTo(await fresh(), key);
  if (!next.now) return undefined;
  return playOn((deviceId) => hand(next, { deviceId, why: 'chosen in the queue' }), { track: next.now });
}

// Next: Spotify's own skip when the list it holds already has the queue's next song (instant),
// a new list when it doesn't
export async function next() {
  activateLocalPlayer(); // while still inside the tap
  let q = await fresh();
  if (!synced(q)) return skipRaw();
  // at a party a skip goes to the next request, taken now
  if (partyCode() && !q.next.some((e) => e.request) && (usePartyStore.getState().queue || []).length) { await takeRequest(); q = get().q; }
  const { given } = get();
  let after = Q.advance(q);
  if (!after.now) {
    after = await continuation(q).catch(() => null);
    if (!after?.now) return skipRaw();
  }
  const at = given ? given.keys.indexOf(q.now.key) : -1;
  if (at >= 0 && given.keys[at + 1] === after.now.key) { setQ(after); shareNow(true); return skipRaw(); }
  return playOn((deviceId) => hand(after, { deviceId, why: 'next' }), { track: after.now });
}

// Previous, once the restart-the-song rule has had its say (playbackController)
export const canGoBack = () => engineOn() && synced(get().q) && get().q.played.length > 0;
export async function previous() {
  const back = Q.back(await fresh());
  return playOn((deviceId) => hand(back, { deviceId, why: 'previous' }), { track: back.now });
}

// Play after Spotify dropped the session, or the first play since opening: the queue's own song,
// where it was, and everything after it. Never a playlist "at" a song it might not hold.
export const canResume = () => engineOn() && Boolean(get().q.now);
export function resumeHere(deviceId, positionMs) {
  return hand(get().q, { deviceId, positionMs, why: 'resume' });
}

// A song Spotify skipped because the connection went (errorSkip.js), put back where it was
export async function restoreLost(lost, deviceId) {
  const { q } = get();
  const song = { uri: lost.uri, id: lost.uri?.split(':').pop(), name: lost.song || '', artists: [] };
  let back = q;
  if (q.played[0] && isSameTrack(q.played[0], song)) back = Q.back(q);
  else if (!(q.now && isSameTrack(q.now, song))) back = { ...q, now: Q.entry(song, 'outside') };
  await hand(back, { deviceId, positionMs: lost.positionMs, why: 'putting back a song the connection lost' });
}

export function setShuffle(on) {
  setQ(Q.setShuffle(get().q, on));
  setShuffleShown(on);
  shareNow(true);
}

export function cycleRepeat() {
  const order = ['off', 'all', 'one'];
  const { q } = get();
  const mode = order[(order.indexOf(q.repeat) + 1) % order.length];
  setQ(Q.setRepeat(q, mode));
  setRepeatShown(mode);
  shareNow(true);
  const deviceId = player().activeDevice?.id || null;
  setRepeatMode(token(), mode === 'one' ? 'track' : 'off', deviceId).catch(handlePlaybackError);
}

// The next songs, for a screen that only shows them (null with the new queue off, or in a party)
export function upcomingSongs(n = 10) {
  if (!engineOn()) return null;
  const { q } = get();
  return Q.upcoming(q).slice(0, n);
}

// --- start and stop ---------------------------------------------------------------------------

let unsubs = [];
export function start() {
  if (unsubs.length) return;
  usePlayerStore.setState({ modesFromQueue: engineOn() });
  unsubs = [
    usePlayerStore.subscribe((s, prev) => { if (s.playbackState !== prev.playbackState) onPlayerState(); }),
    useQueue.subscribe((s, prev) => { if (s.q !== prev.q || s.given !== prev.given) plan(); }),
    useUserStore.subscribe((s, prev) => { if (s.playbackSettings?.queueEngine !== prev.playbackSettings?.queueEngine) switchedOver(); }),
    usePartyStore.subscribe((s, prev) => { if (Boolean(s.code) !== Boolean(prev.code)) partyChanged(Boolean(s.code)); })
  ];
  const onVisible = () => { if (document.visibilityState === 'visible') pullNow(); };
  document.addEventListener('visibilitychange', onVisible);
  // the device carrying the queue out looks once per song (plan); the others while on screen
  const leading = () => player().isLocalActive || (lease.held === true && Boolean(player().activeDevice) && !/^Jomify\b/.test(player().activeDevice.name || ''));
  const every = setInterval(() => { if (document.visibilityState === 'visible' && !leading()) pullNow(); }, PULL_EVERY_MS);
  unsubs.push(() => document.removeEventListener('visibilitychange', onVisible), () => clearInterval(every));
  switchedOver();
}

export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  clearTimeout(timer);
}

// The setting was turned on or off (or the app opened with it on)
function switchedOver() {
  const on = engineOn();
  usePlayerStore.setState({ modesFromQueue: on });
  if (!on) { clearTimeout(timer); return; }
  const { q } = get();
  // songs added under the old queue come across, once
  const old = useQueueStore.getState().items;
  if (old.length && !q.next.length) { add(old); useQueueStore.getState().clear(); dlog(`brought ${old.length} queued song${old.length === 1 ? '' : 's'} over from the old queue`); }
  setShuffleShown(get().q.shuffle);
  setRepeatShown(get().q.repeat);
  reloadPartial();
  lastUri = null;
  pullNow().finally(() => { setShuffleShown(get().q.shuffle); setRepeatShown(get().q.repeat); onPlayerState(); });
}

// A long source kept without its songs (on the device, or in the shared copy): load them again
// behind the scenes
let reloading = null;
function reloadPartial() {
  const src = get().q.source;
  if (!src?.partial || !src.uri || reloading === src.uri) return;
  reloading = src.uri;
  loadSource(src.uri, { onFull: (all, total) => applyFull(src.uri, src.kind, src.name, all, total) })
    .then((loaded) => { if (loaded?.complete) applyFull(src.uri, src.kind, src.name, loaded.pairs.map(([, t]) => t), loaded.total); })
    .catch(() => {})
    .finally(() => { reloading = null; });
}
