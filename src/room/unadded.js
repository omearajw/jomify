import { create } from 'zustand';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { toast } from '../store/toastStore';
import { playOn } from '../services/spotify/playbackController';
import { fetchPlaylistDetails, fetchMoreTracks, playUris, addTracksToPlaylist, removeTrackFromPlaylist } from '../services/spotify/api';
import { isSameTrack } from '../utils/spotifyUri';
import { log } from '../services/debugLog';
import { isPile, planUnaddedCheck, applyUnaddedPlan } from '../utils/unaddedSync';
import { noteTrackSorted } from '../views/Library/useUnaddedSuggestions';

// Unadded as a mode (DESIGN.md §8): the pile is a playlist you play, and the playing song is the
// card. Its state lives here, outside React, because the pile (the layer's list), the targets
// (the open thing) and the room's own column all read it, and the logic that follows playback
// has to run whether or not any of them is on screen. UnaddedEngine starts and stops it.
//
// Decisions about a song: skipped (remembered in the store, so on every device) or filed into
// one or more playlists. A song with neither is waiting. The card is named by its song; null
// means "the first song still waiting". A song just filed stays the card until you move on, so
// it can be undone or added to a second playlist.

const PLAY_AHEAD = 50;        // the card and this many waiting songs behind it, in one play request
const SETTLE_MS = 300;        // a run of skips asks Spotify for one song, not every one passed
const HOLD_FOLLOW_MS = 8000;  // after we move the card, how long Spotify may go on naming the old song
const GHOST_MS = 10000;       // how long the song that just left stays under the tiles
const FINISHED_MS = 3000;     // leaving a song this close to its end is the song ending, not a skip

export const useUnaddedStore = create(() => ({
  pileId: null, pile: [], total: 0, loading: false, loadError: '',
  cardUri: null,
  placed: {},            // uri -> [playlistId]
  lastAction: null,      // { uri, item, playlistId }
  ghost: null,           // { item, left } with left counting down in seconds
  busy: false,
  suggestionsByTrack: new Map(), targets: [], suggestionStatus: 'idle', suggestionsAttempt: 0,
  checking: false, checkStatus: '', plan: null
}));
const S = useUnaddedStore;
const get = () => S.getState();
const set = (patch) => S.setState(patch);

export const pileIdOf = (playlists) => (playlists || []).find(isPile)?.id || null;
const token = () => useUserStore.getState().token;
const nowPlaying = () => usePlayerStore.getState().playbackState?.track_window?.current_track || null;
const skipsOf = (pileId) => new Set(useUserStore.getState().sortSkips[pileId] || []);

export function isDecided(uri, state = get(), skips = skipsOf(state.pileId)) {
  return skips.has(uri) || (state.placed[uri] || []).length > 0;
}
export function cardOf(state = get()) {
  const skips = skipsOf(state.pileId);
  const pinned = state.cardUri ? state.pile.find((i) => i?.track?.uri === state.cardUri) : null;
  return pinned || state.pile.find((i) => i?.track?.uri && !isDecided(i.track.uri, state, skips)) || null;
}
export function waitingCount(state = get()) {
  const skips = skipsOf(state.pileId);
  return state.pile.filter((i) => i?.track?.uri && !isDecided(i.track.uri, state, skips)).length;
}
// The songs still waiting after an index, wrapping round, the index itself never counted
function waitingAfter(index, limit = 1, state = get()) {
  const skips = skipsOf(state.pileId);
  const found = [];
  const n = state.pile.length;
  for (let k = 1; k < n && found.length < limit; k++) {
    const uri = state.pile[(index + k) % n]?.track?.uri;
    if (uri && !isDecided(uri, state, skips)) found.push(uri);
  }
  return found;
}
const indexOf = (uri, state = get()) => state.pile.findIndex((i) => i?.track?.uri === uri);

// --- the pile ---
let loadGeneration = 0;
export async function loadPile(pileId) {
  const mine = ++loadGeneration;
  const t = token();
  if (!t || !pileId) return;
  set({ pileId, loading: true, loadError: '' });
  try {
    const data = await fetchPlaylistDetails(t, pileId);
    if (mine !== loadGeneration) return;
    let items = (data.tracks?.items || []).filter((i) => i?.track?.uri);
    set({ pile: items, total: data.tracks?.total ?? items.length });
    let next = data.tracks?.next;
    while (next) {
      const page = await fetchMoreTracks(t, next);
      if (mine !== loadGeneration) return;
      items = [...items, ...(page.items || []).filter((i) => i?.track?.uri)];
      set({ pile: items });
      next = page.next;
    }
    set({ loading: false });
  } catch (err) {
    if (mine !== loadGeneration) return;
    set({ loading: false, loadError: err?.message || "Couldn't load the pile" });
  }
}

// --- the card ---
let hold = 0;          // until when playback naming another song is not followed
let heard = false;     // the card has been heard playing since it became the card
let lastPos = 0, lastDur = 0, maxPos = 0;
let settleTimer = null, ghostTimer = null;

function setCard(uri, { followed = false, why = '' } = {}) {
  const before = cardOf();
  if (!followed) hold = Date.now() + HOLD_FOLLOW_MS;
  heard = false; maxPos = 0;
  set({ cardUri: uri });
  if (why) log('unadded', why, uri || 'nothing waiting');
  const after = cardOf();
  if (before && after?.track?.uri !== before.track?.uri) leaveGhost(before);
  scheduleAutoplay();
}
function leaveGhost(item) {
  clearInterval(ghostTimer);
  set({ ghost: { item, left: GHOST_MS / 1000 } });
  ghostTimer = setInterval(() => {
    const g = get().ghost;
    if (!g || g.left <= 1) { clearInterval(ghostTimer); set({ ghost: null }); tidy(); return; }
    set({ ghost: { ...g, left: g.left - 1 } });
  }, 1000);
}
// Filed songs leave the list once they are neither the card nor the ghost; skipped ones stay,
// dimmed, because they are still in the pile. Every song decided: the skips have done their job.
function tidy() {
  const st = get();
  const card = cardOf(st);
  const keep = new Set([card?.track?.uri, st.ghost?.item?.track?.uri].filter(Boolean));
  const pile = st.pile.filter((i) => keep.has(i.track.uri) || !(st.placed[i.track.uri] || []).length);
  if (pile.length !== st.pile.length) set({ pile });
  if (!st.loading && st.pile.length && waitingCount(st) === 0) useUserStore.getState().setSortSkips(st.pileId, []);
}
const nextCard = (state = get()) => { const c = cardOf(state); return c ? waitingAfter(indexOf(c.track.uri, state), 1, state)[0] || null : null; };

export function playFrom(uri) {
  const st = get();
  const at = indexOf(uri, st);
  if (at < 0 || !token()) return;
  const uris = [uri, ...waitingAfter(at, PLAY_AHEAD - 1, st)];
  const item = st.pile[at];
  clearTimeout(settleTimer);
  setCard(uri, { why: 'playing' });
  playOn((deviceId) => {
    if (cardOf()?.track?.uri !== uri) return Promise.resolve();
    return playUris(token(), deviceId, uris, 0);
  }, { track: item.track });
}
function scheduleAutoplay() {
  clearTimeout(settleTimer);
  if (!useUserStore.getState().sortModeSettings?.autoplay) return;
  const card = cardOf();
  if (!card || isSameTrack(nowPlaying(), card.track)) return;
  settleTimer = setTimeout(() => {
    const c = cardOf();
    if (c && c.track.uri === card.track.uri && !isSameTrack(nowPlaying(), c.track)) {
      const at = indexOf(c.track.uri);
      const uris = [c.track.uri, ...waitingAfter(at, PLAY_AHEAD - 1)];
      log('unadded', 'playing the card', `${c.track.name}, ${uris.length - 1} more behind it`);
      playOn((deviceId) => (cardOf()?.track?.uri === c.track.uri ? playUris(token(), deviceId, uris, 0) : Promise.resolve()), { track: c.track });
    }
  }, SETTLE_MS);
}

// The card follows playback through the pile: when a song ends and the next waiting one plays,
// or Next is pressed, the card moves with it. Leaving a waiting song before its end is a skip,
// remembered. Songs from outside the pile leave the card alone.
function follow(state) {
  const st = get();
  const card = cardOf(st);
  if (!card) return;
  const pb = state.playbackState;
  const now = pb?.track_window?.current_track;
  if (!pb || !now || String(now.uid || '').startsWith('pending:')) return;
  if (isSameTrack(now, card.track)) {
    hold = 0;
    lastPos = pb.position || 0; lastDur = pb.duration || 0; maxPos = Math.max(maxPos, lastPos);
    if (!get().cardUri) set({ cardUri: card.track.uri });
    if (!pb.paused) { heard = true; return; }
    // paused at 0 is the song having ended only once it has been well into it; a fresh start
    // can report 0 and paused for a moment
    const finished = (lastPos === 0 && maxPos > 10000) || (lastDur > 0 && lastPos >= lastDur - 1500);
    if (heard && finished) { heard = false; setCard(nextCard(), { why: 'song finished' }); }
    return;
  }
  if (Date.now() < hold) return;
  const hit = st.pile.find((i) => i?.track && isSameTrack(i.track, now));
  if (!hit) return;
  if (heard && !(st.placed[card.track.uri] || []).length && lastDur > 0 && lastPos < lastDur - FINISHED_MS) {
    const skips = skipsOf(st.pileId); skips.add(card.track.uri);
    useUserStore.getState().setSortSkips(st.pileId, [...skips]);
    log('unadded', 'skipped by Next', card.track.name);
  }
  heard = false;
  if (!isDecided(hit.track.uri, st)) { setCard(hit.track.uri, { followed: true, why: 'followed playback' }); return; }
  setCard(nextCard(), { why: 'playback ran on into a song already dealt with' });
}

// --- deciding ---
export function skip() {
  const st = get();
  const card = cardOf(st);
  if (!card) return;
  if (!(st.placed[card.track.uri] || []).length) {
    const skips = skipsOf(st.pileId); skips.add(card.track.uri);
    useUserStore.getState().setSortSkips(st.pileId, [...skips]);
  }
  setCard(nextCard(st), { why: 'skipped' });
}

export async function fileInto(uri, playlistId) {
  if (!get().cardUri && cardOf()?.track?.uri === uri) set({ cardUri: uri });
  const st = get();
  const t = token();
  const item = st.pile.find((i) => i?.track?.uri === uri) || (st.ghost?.item?.track?.uri === uri ? st.ghost.item : null);
  const target = st.targets.find((x) => x.id === playlistId);
  if (!item || !target || st.busy || !t || (st.placed[uri] || []).includes(playlistId)) return;
  const first = !(st.placed[uri] || []).length;
  set({ busy: true });
  try {
    await addTracksToPlaylist(t, playlistId, [uri]);
    if (first) await removeTrackFromPlaylist(t, st.pileId, uri);
  } catch (err) {
    console.error('Filing the song failed:', err);
    toast(`Couldn't add "${item.track.name}" to ${target.name}`, { tone: 'error' });
    set({ busy: false });
    return;
  }
  set({ busy: false, placed: { ...get().placed, [uri]: [...(get().placed[uri] || []), playlistId] }, lastAction: { uri, item, playlistId }, total: first ? Math.max(0, get().total - 1) : get().total });
  noteTrackSorted(playlistId, item.track);
  toast(`Added to ${target.name}`, { tone: 'success', duration: 1500 });
  log('unadded', 'filed', `${item.track.name} into ${target.name}`);
  if (cardOf()?.track?.uri === uri && useUserStore.getState().sortModeSettings?.advance) setCard(nextCard(), { why: 'moved on after filing' });
  else tidy();
}

// Back out of a playlist, from Undo or from a tile the song is already in. The first filing
// took it out of the pile, so leaving its last playlist puts it back.
export async function takeOut(uri, playlistId) {
  const st = get();
  const t = token();
  const inPlaylists = st.placed[uri] || [];
  if (!inPlaylists.includes(playlistId) || st.busy || !t) return false;
  const item = st.pile.find((i) => i?.track?.uri === uri) || st.lastAction?.item || st.ghost?.item;
  const target = st.targets.find((x) => x.id === playlistId);
  const name = item?.track?.name || 'the song';
  const last = inPlaylists.length === 1;
  set({ busy: true });
  try {
    await removeTrackFromPlaylist(t, playlistId, uri);
    if (last) await addTracksToPlaylist(t, st.pileId, [uri]);
  } catch (err) {
    console.error('Taking the song back out failed:', err);
    toast(`Couldn't remove "${name}" from ${target?.name || 'that playlist'}`, { tone: 'error' });
    set({ busy: false });
    return false;
  }
  const after = get();
  const pile = after.pile.some((i) => i?.track?.uri === uri) || !item ? after.pile : [...after.pile, item];
  set({ busy: false, pile, placed: { ...after.placed, [uri]: inPlaylists.filter((id) => id !== playlistId) }, lastAction: after.lastAction?.uri === uri && after.lastAction.playlistId === playlistId ? null : after.lastAction, total: last ? after.total + 1 : after.total });
  toast(last ? `Removed from ${target?.name || 'the playlist'}, back in the pile` : `Removed from ${target?.name || 'the playlist'}`, { tone: 'info', duration: 1800 });
  log('unadded', last ? 'took out of its last playlist, back in the pile' : 'took out', `${name} from ${target?.name || playlistId}`);
  return true;
}

export async function undo() {
  const { lastAction } = get();
  if (!lastAction) return;
  if (await takeOut(lastAction.uri, lastAction.playlistId)) setCard(lastAction.uri, { why: 'undone' });
}

// --- the check ---
export async function findSongs() {
  const st = get();
  const t = token();
  if (!t || !st.pileId || st.checking) return;
  set({ checking: true, checkStatus: 'Starting', plan: null });
  try {
    const plan = await planUnaddedCheck({ token: t, pileId: st.pileId, checkIds: useUserStore.getState().unaddedCheckPlaylists, onStatus: (checkStatus) => set({ checkStatus }) });
    set({ checking: false, checkStatus: '' });
    if (!plan.remove.length && !plan.add.length) { toast('Already up to date: nothing to add or remove.'); return; }
    set({ plan });
  } catch (err) {
    console.error('Error planning the unadded check:', err);
    set({ checkStatus: err?.message || 'Check failed. Nothing was changed.' });
    setTimeout(() => set({ checking: false, checkStatus: '' }), 6000);
  }
}
export async function applyPlan() {
  const { plan, pileId } = get();
  const t = token();
  set({ plan: null });
  if (!plan || !t || !pileId) return;
  set({ checking: true });
  try {
    await applyUnaddedPlan({ token: t, pileId, plan, onStatus: (checkStatus) => set({ checkStatus }) });
    set({ checking: false, checkStatus: '' });
    toast(`Pile updated: ${plan.add.length} in, ${plan.remove.length} out`, { tone: 'success' });
    await loadPile(pileId);
  } catch (err) {
    console.error('Error applying the unadded check:', err);
    set({ checkStatus: err?.message || 'Check failed.' });
    setTimeout(() => set({ checking: false, checkStatus: '' }), 6000);
  }
}
export const dismissPlan = () => set({ plan: null });
// remounts the suggestions hook, so a failed profile load is tried again
export const retrySuggestions = () => set({ suggestionsAttempt: get().suggestionsAttempt + 1 });

// --- lifecycle ---
let stopFollow = null;
export function start(pileId) {
  if (get().pileId !== pileId || !get().pile.length) {
    const playing = nowPlaying();
    set({ cardUri: null, placed: {}, lastAction: null, ghost: null });
    loadPile(pileId).then(() => {
      // begins on whatever is playing, if that is in the pile and waiting
      const hit = playing ? get().pile.find((i) => i?.track && isSameTrack(i.track, playing)) : null;
      if (hit && !isDecided(hit.track.uri)) set({ cardUri: hit.track.uri });
      scheduleAutoplay();
    });
  } else scheduleAutoplay();
  hold = 0; heard = false;
  stopFollow?.();
  stopFollow = usePlayerStore.subscribe(follow);
  follow(usePlayerStore.getState());
  log('unadded', 'opened', `${get().pile.length} songs loaded`);
}
export function stop() {
  stopFollow?.(); stopFollow = null;
  clearTimeout(settleTimer);
  clearInterval(ghostTimer);
  set({ ghost: null });
}
