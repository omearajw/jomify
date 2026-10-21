// Jomify's play queue, the pure part (the redesign agreed with Jack on 19 Oct 2026). One queue
// holds everything about what plays:
//
//   now      the song playing, or paused on
//   next     "Next up": songs added by hand, played before anything else, in this order
//   then     the rest of what was pressed play on (the source), in the order it will play,
//            already shuffled when shuffle is on
//   played   what has played, newest first; Previous goes back through it
//
// Every operation takes a queue and returns a new one; nothing here talks to Spotify. Spotify is
// given the list `toGive` describes when someone presses play and plays through it by itself; how
// the queue's next song reaches it after that (through Spotify's own queue, never a list swapped
// at the end of a song) is mirror.js.
//
// A source is anything with a list of songs: a playlist, an album, an artist's songs, Liked Songs,
// or a one-off list (search results, Unadded's pile, a Seven's batch). Its songs keep their
// original position `i`, so shuffle can be turned off again, and the songs out of the current pass
// (played or removed) are listed in `out`, so turning shuffle on and off never brings them back.

import { isSameTrack, isUnplayable } from '../utils/spotifyUri.js';

export const MAX_GIVEN = 500;    // Spotify took lists of 500 and started on the last (Check queue)
export const MAX_PLAYED = 100;

let counter = 0;
const newKey = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyQueue = () => ({ now: null, next: [], then: [], played: [], source: null, out: [], sourceAt: -1, shuffle: false, repeat: 'off' });

// What the queue keeps of a song: enough for a row, for matching what Spotify plays, and for
// leaving out what can't be played
export function entry(track, from) {
  return {
    key: newKey(),
    from,
    id: track.id,
    uri: track.uri,
    name: track.name,
    duration_ms: track.duration_ms || 0,
    linked_from: track.linked_from?.uri ? { id: track.linked_from.id, uri: track.linked_from.uri } : undefined,
    is_playable: typeof track.is_playable === 'boolean' ? track.is_playable : undefined,
    is_local: track.is_local || undefined,
    artists: (track.artists || []).map((a) => ({ id: a.id, name: a.name, uri: a.uri })),
    album: track.album ? { id: track.album.id, name: track.album.name, images: track.album.images?.length ? [track.album.images[track.album.images.length > 1 ? 1 : 0]] : [] } : undefined
  };
}

// { kind, uri, name, tracks } -> a source whose songs are entries numbered in their own order.
// `readOnly`: a playlist Jomify can't read the songs of, which Spotify plays its own way.
export function source({ kind, uri = null, name = '', tracks = [], readOnly = false, total = null }) {
  return { kind, uri, name, readOnly, total: total ?? tracks.length, tracks: numbered(tracks) };
}

// Songs with their position in the source: plain tracks are numbered in order; [i, track] pairs
// (pages fetched out of order, for a shuffle start deep in a long playlist) keep their own
const numbered = (tracks) => tracks
  .map((t, n) => (Array.isArray(t) ? [t[0], t[1]] : [n, t]))
  .filter(([, t]) => t?.uri)
  .map(([i, t]) => ({ ...entry(t, 'source'), i }))
  .sort((a, b) => a.i - b.i);

// The whole source has loaded behind a song that started from part of it. Songs already in the
// queue keep their entries (so the list Spotify holds still matches); Then is worked out again
// from the full list: in order, or shuffled. `reshuffle` (a play that started from one page):
// everything left is shuffled afresh but the next song; otherwise (songs loaded again for a
// queue already playing, perhaps on another device) the order lined up is kept and the songs it
// lacked go after it.
export function withFullSource(q, full, { random = Math.random, reshuffle = false } = {}) {
  if (!q.source || q.source.uri !== full.uri || q.source.kind !== full.kind) return q;
  const known = new Map([q.now, ...q.then, ...q.played].filter((e) => e?.from === 'source' && e.i !== undefined).map((e) => [e.i, e]));
  const tracks = full.tracks.map((e) => (known.has(e.i) && isSameTrack(known.get(e.i), e) ? known.get(e.i) : e));
  const src = { ...full, tracks };
  const gone = new Set([...q.out, q.now?.key].filter(Boolean));
  const left = tracks.filter((e) => !gone.has(e.key)).filter(playable);
  let then;
  if (!q.shuffle) then = left.filter((e) => e.i > q.sourceAt);
  else {
    // a fresh shuffle of everything left, except that the song lined up next stays next, so
    // Spotify's list still matches and nothing has to be swapped
    const inLeft = new Set(left.map((e) => e.key));
    if (reshuffle) {
      const head = q.then.find((e) => inLeft.has(e.key));
      then = head ? [head, ...shuffled(left.filter((e) => e.key !== head.key), random)] : shuffled(left, random);
    } else {
      const lined = q.then.filter((e) => inLeft.has(e.key));
      const have = new Set(lined.map((e) => e.key));
      then = [...lined, ...shuffled(left.filter((e) => !have.has(e.key)), random)];
    }
  }
  return refilled({ ...q, source: src, then }, random);
}

export const playable = (e) => Boolean(e?.uri) && !isUnplayable(e);
const notIn = (keys) => { const s = new Set(keys); return (e) => !s.has(e.key); };

function shuffled(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pushPlayed = (played, e) => (e ? [e, ...played].slice(0, MAX_PLAYED) : played);

// A new pass through the source for repeat: everything, in order or shuffled
function refilled(q, random) {
  if (!q.source || q.source.partial || q.repeat !== 'all' || q.then.length) return q;
  const all = q.source.tracks.filter(playable);
  if (!all.length) return q;
  return { ...q, out: [], then: q.shuffle ? shuffled(all, random) : all };
}

// Press play on a source. `start`: the index (in the source's own order) of the song to start
// on; with none, the first song, or a random one with shuffle on. Songs added by hand stay
// in Next up (decision 6).
export function play(q, src, { start = null, shuffle = q.shuffle, random = Math.random } = {}) {
  const tracks = src.tracks;
  const usable = tracks.filter(playable);
  if (!usable.length) return { ...q, source: src };
  let first = start !== null ? usable.find((e) => e.i >= start) || usable[0] : null;
  if (!first) first = shuffle ? usable[Math.floor(random() * usable.length)] : usable[0];
  const then = shuffle ? shuffled(usable.filter((e) => e.key !== first.key), random) : tracks.filter((e) => e.i > first.i);
  return refilled({ ...q, now: first, then, played: pushPlayed(q.played, q.now), source: src, out: [first.key], sourceAt: first.i, shuffle }, random);
}

// What follows when the queue has run out ("When a playlist ends"): a new source lined up after
// the song playing, which stays as it is, so its first song can go to Spotify like any other next
export function continueWith(q, src, { shuffle = false, random = Math.random } = {}) {
  const usable = src.tracks.filter(playable);
  if (!usable.length) return q;
  return { ...q, source: src, then: shuffle ? shuffled(usable, random) : usable, out: [], sourceAt: -1 };
}

// Play songs that aren't part of any source (a song started from a list the queue doesn't hold)
export function playSongs(q, tracks, opts) {
  return play(q, source({ kind: 'list', name: '', tracks }), opts);
}

export function add(q, tracks) {
  return addEntries(q, tracks.filter((t) => t?.uri).map((t) => entry(t, 'next')));
}

export function playNext(q, tracks) {
  return addEntries(q, tracks.filter((t) => t?.uri).map((t) => entry(t, 'next')), { first: true });
}

// Entries already made (on the device the songs were added on), so every device sharing the
// queue knows them by the same keys
export function addEntries(q, entries, { first = false } = {}) {
  const fresh = (entries || []).filter((e) => e?.uri && e.key).map((e) => ({ ...e, from: 'next' }));
  return { ...q, next: first ? [...fresh, ...q.next] : [...q.next, ...fresh] };
}

// A song already in Then moved to the front of Next up
export function promote(q, key) {
  const e = q.then.find((x) => x.key === key);
  if (!e) return q;
  return { ...q, then: q.then.filter((x) => x.key !== key), next: [{ ...e, from: 'next' }, ...q.next], out: [...q.out, key] };
}

export function remove(q, key) {
  if (q.next.some((e) => e.key === key)) return { ...q, next: q.next.filter((e) => e.key !== key) };
  if (q.then.some((e) => e.key === key)) return { ...q, then: q.then.filter((e) => e.key !== key), out: [...q.out, key] };
  return q;
}

// Within its own part (Next up or Then); toIndex counts within that part
export function move(q, key, toIndex) {
  const part = q.next.some((e) => e.key === key) ? 'next' : q.then.some((e) => e.key === key) ? 'then' : null;
  if (!part) return q;
  const list = q[part].filter((e) => e.key !== key);
  const moved = q[part].find((e) => e.key === key);
  const at = Math.max(0, Math.min(list.length, toIndex));
  return { ...q, [part]: [...list.slice(0, at), moved, ...list.slice(at)] };
}

export const clear = (q) => ({ ...q, next: [] });

// The song after this one, as the queue stands: the head of Next up, else of Then
export function nextUp(q) {
  return q.next.find(playable) || q.then.find(playable) || null;
}

// On to the next song (a skip, or the song ending). With nothing left, `now` is null: what
// follows is the "When a playlist ends" setting's business, outside this file.
export function advance(q, { random = Math.random } = {}) {
  const played = pushPlayed(q.played, q.now);
  const ni = q.next.findIndex(playable);
  if (ni >= 0) return refilled({ ...q, now: q.next[ni], next: q.next.slice(ni + 1), played }, random);
  const ti = q.then.findIndex(playable);
  if (ti >= 0) {
    const now = q.then[ti];
    return refilled({ ...q, now, then: q.then.slice(ti + 1), played, out: [...q.out, now.key], sourceAt: now.i ?? q.sourceAt }, random);
  }
  return { ...q, now: null, next: [], then: [], played };
}

// Back a song: the current one goes back to the front of where it came from
export function back(q) {
  const [prev, ...rest] = q.played;
  if (!prev) return q;
  let { next, then, out } = q;
  if (q.now?.from === 'next') next = [q.now, ...next];
  else if (q.now?.from === 'source') { then = [q.now, ...then]; out = out.filter((k) => k !== q.now.key); }
  return { ...q, now: prev, played: rest, next, then, out, sourceAt: prev.from === 'source' && prev.i !== undefined ? prev.i : q.sourceAt };
}

// Play a song further down the queue (or one from Played). Songs skipped over on the way are
// left out of this pass; a song chosen from Then leaves Next up as it is.
export function jumpTo(q, key) {
  const ni = q.next.findIndex((e) => e.key === key);
  if (ni >= 0) return { ...q, now: q.next[ni], next: q.next.slice(ni + 1), played: pushPlayed(q.played, q.now) };
  const ti = q.then.findIndex((e) => e.key === key);
  if (ti >= 0) {
    const now = q.then[ti];
    return { ...q, now, then: q.then.slice(ti + 1), played: pushPlayed(q.played, q.now), out: [...q.out, ...q.then.slice(0, ti + 1).map((e) => e.key)], sourceAt: now.i ?? q.sourceAt };
  }
  const pi = q.played.findIndex((e) => e.key === key);
  if (pi >= 0) { let r = q; for (let n = 0; n <= pi; n++) r = back(r); return r; }
  return q;
}

// Spotify started a song of the queue's ahead of its turn (one already put in Spotify's own queue
// before the queue was rearranged): it becomes now, and everything else keeps its place
export function bringForward(q, key) {
  const e = [...q.next, ...q.then].find((x) => x.key === key);
  if (!e) return q;
  return { ...q, now: e, next: q.next.filter((x) => x.key !== key), then: q.then.filter((x) => x.key !== key), played: pushPlayed(q.played, q.now), out: e.from === 'source' ? [...q.out, key] : q.out };
}

// Shuffle on: the rest of the source, minus what this pass has used, in a new random order.
// Off: the source's own order from the current song on. Next up is never touched.
export function setShuffle(q, on, { random = Math.random } = {}) {
  if (!q.source) return { ...q, shuffle: on };
  // a source kept without its songs (too long to store on the device) can only reorder what is left
  const pool = q.source.partial ? q.then : q.source.tracks;
  const left = pool.filter(notIn([...q.out, q.now?.key].filter(Boolean))).filter(playable);
  const then = on ? shuffled(left, random) : left.filter((e) => e.i > q.sourceAt);
  return refilled({ ...q, shuffle: on, then }, random);
}

export function setRepeat(q, mode, { random = Math.random } = {}) {
  return refilled({ ...q, repeat: mode }, random);
}

// Spotify says this is the song playing. Fold that into the queue: the same song (nothing to do),
// the next one (it moved on), one further down (skipped ahead), the last one played (it went
// back), or a song the queue never had (played from elsewhere), which becomes `now` with the
// rest of the queue left as it was.
export function reconcile(q, track, { random = Math.random } = {}) {
  if (!track?.uri) return { queue: q, change: 'none' };
  if (q.now && isSameTrack(q.now, track)) return { queue: q, change: 'same' };
  const up = nextUp(q);
  if (up && isSameTrack(up, track)) return { queue: advance(q, { random }), change: 'advanced' };
  const further = [...q.next, ...q.then].find((e) => isSameTrack(e, track));
  if (further) return { queue: jumpTo(q, further.key), change: 'jumped' };
  if (q.played[0] && isSameTrack(q.played[0], track)) return { queue: back(q), change: 'back' };
  return { queue: { ...q, now: entry(track, 'outside'), played: pushPlayed(q.played, q.now) }, change: 'outside' };
}

// The list Spotify should be playing: the current song, then everything after it that can be
// played, up to MAX_GIVEN. `keys` records which queue entries those are, to tell later whether
// Spotify's next song is still the queue's.
export function toGive(q, max = MAX_GIVEN) {
  if (!q.now || q.source?.readOnly) return null;
  const list = [q.now, ...[...q.next, ...q.then].filter(playable)].slice(0, max);
  return { uris: list.map((e) => e.uri), keys: list.map((e) => e.key) };
}

// Does Spotify need a new list before this song ends? Yes when the song after this one in the
// list it was given is not the queue's next song (an edit, a shuffle, the list running out), or
// when Spotify isn't playing from a list Jomify gave it at all.
export function needsSwitch(q, given) {
  if (!q.now || q.source?.readOnly) return false;
  if (q.repeat === 'one') return false;
  const at = given ? given.keys.indexOf(q.now.key) : -1;
  if (at < 0) return true;
  const theirs = given.keys[at + 1] || null;
  return (nextUp(q)?.key || null) !== theirs;
}

// Everything still to come, for a queue view: Next up, then Then
export const upcoming = (q) => [...q.next, ...q.then];
