// What Spotify holds, kept in step by Jomify (rebuilt 21 Oct 2026 around one way of getting songs
// to Spotify). Pure: nothing here talks to Spotify or keeps time; the engine does that.
//
// Spotify plays from two places: its own queue first (songs added one at a time, played in the
// order they went in, which nothing can take back out), then the list it was last handed (the
// current song and up to 500 after it). Measured on Jack's account, 20 Oct: a queued song plays at
// the song change ahead of the list's next, the list then carries on where it was, and a new list
// does not clear the queue.
//
// So there is one way for the queue's next song to reach Spotify: ten seconds before a song ends,
// if Spotify's next song isn't the queue's, the queue's goes into Spotify's queue, and the song
// change is Spotify's own (no race, no gap). A new list is handed over only when someone presses
// something (play, previous, a song chosen in the queue, a skip Spotify can't do by itself), never
// by itself at the end of a song: that last-moment swap is what left a speaker silent at Jack's
// party (21 Oct) and played a removed song for a moment (20 Oct).
//
// The mirror: { list: { uris, keys } | null, at, queued: [{ key, uri }] }
//   list    the list Spotify was last handed, with the queue entries those songs were
//   at      where Spotify is in that list: the list song playing, or the last one that played
//   queued  the songs Jomify has put in Spotify's queue that haven't played yet, oldest first

import { nextUp } from './model.js';
import { isSameTrack } from '../utils/spotifyUri.js';

export const FEED_AT_MS = 10000;   // the next song goes into Spotify's queue this long before the end
export const STOP_LEAD_MS = 300;   // a pause at the end of the queue is sent this long before the end

export const emptyMirror = () => ({ list: null, at: 0, queued: [] });

const same = (track, uri) => Boolean(track && uri && (track.uri === uri || track.linked_from?.uri === uri));

// An older record (before the rebuild: { uris, keys, at }) read as a mirror
export function asMirror(given) {
  if (!given) return emptyMirror();
  if (given.list !== undefined || given.queued) return { list: given.list || null, at: given.at || 0, queued: given.queued || [] };
  if (given.uris && given.keys) return { list: { uris: given.uris, keys: given.keys }, at: given.at || 0, queued: [] };
  return emptyMirror();
}

// A list was handed over: Spotify starts its first song now. What was in Spotify's queue stays.
export const handed = (m, list) => ({ list: list ? { uris: list.uris, keys: list.keys } : null, at: 0, queued: m.queued });

// A song was put in Spotify's queue
export const queuedOne = (m, e) => ({ ...m, queued: [...m.queued, { key: e.key, uri: e.uri }] });

// The song Spotify will play next by itself: the oldest in its queue, else the list's next
export function spotifyNext(m) {
  if (m.queued.length) return { ...m.queued[0], from: 'queued' };
  const k = m.at + 1;
  if (m.list && k < m.list.keys.length) return { key: m.list.keys[k], uri: m.list.uris[k], from: 'list' };
  return null;
}

// Spotify started `track`. Where did it come from?
//   queued  one Jomify put in its queue (any put in before it were passed over, by a skip in
//           Spotify's own app say, and are gone from Spotify's queue too)
//   list    the list, further on (at moves there)
//   same    the list song it was already on
//   outside neither: something Jomify didn't give it
export function songStarted(m, track) {
  if (!track?.uri) return { mirror: m, from: 'none', entry: null };
  const qi = m.queued.findIndex((x) => same(track, x.uri));
  if (qi >= 0) return { mirror: { ...m, queued: m.queued.slice(qi + 1) }, from: 'queued', entry: m.queued[qi] };
  if (m.list) {
    if (same(track, m.list.uris[m.at])) return { mirror: m, from: 'same', entry: { key: m.list.keys[m.at], uri: m.list.uris[m.at] } };
    const j = m.list.uris.findIndex((u, k) => k > m.at && same(track, u));
    if (j > 0) return { mirror: { ...m, at: j }, from: 'list', entry: { key: m.list.keys[j], uri: m.list.uris[j] } };
  }
  return { mirror: m, from: 'outside', entry: null };
}

// What to do before the song on now ends, given `left` ms of it to go:
//   none     Spotify's next is already the queue's (or it is waiting in Spotify's queue)
//   wait     come back `in` ms from now
//   queue    put `entry` in Spotify's queue now
//   continue the queue has run out: the "when a playlist ends" setting decides what follows
//   stop     the queue has run out and Spotify would carry on with songs it no longer has: pause
//            at the end (`in` ms from now)
export function decide(q, m, left) {
  if (!q.now || q.repeat === 'one') return { action: 'none' };
  const want = nextUp(q);
  const have = spotifyNext(m);
  if (!want) return { action: 'continue', thenStop: Boolean(have), in: Math.max(0, left - STOP_LEAD_MS) };
  if (have && (have.key === want.key || same(want, have.uri))) return { action: 'none' };
  if (m.queued.some((x) => x.key === want.key || same(want, x.uri))) return { action: 'none', why: 'already in Spotify\'s queue' };
  if (left > FEED_AT_MS) return { action: 'wait', in: left - FEED_AT_MS };
  return { action: 'queue', entry: want };
}

// Next pressed: Spotify's own skip when its next is the song the queue goes to, else a new list
export function onNext(m, after) {
  const have = spotifyNext(m);
  return have && after?.now && (have.key === after.now.key || same(after.now, have.uri)) ? 'skip' : 'hand';
}

// A song Spotify played from its queue that the queue doesn't want next: is it somewhere in the
// queue (it plays now, nothing else moves), or not wanted at all (skipped)?
export function placeOf(q, track) {
  if (q.now && isSameTrack(q.now, track)) return { place: 'now' };
  const want = nextUp(q);
  if (want && isSameTrack(want, track)) return { place: 'next' };
  const waiting = [...q.next, ...q.then].find((e) => isSameTrack(e, track));
  return waiting ? { place: 'later', entry: waiting } : { place: 'gone' };
}
