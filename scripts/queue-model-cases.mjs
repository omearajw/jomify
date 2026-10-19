// The play queue's pure core (src/queue/model.js): every operation, shuffle and repeat, folding in
// what Spotify reports, and what Spotify should be given.
import { withFullSource, addEntries, entry } from '../src/queue/model.js';
import { applyOp } from '../api/_lib/queue.js';
import { emptyQueue, source, play, add, playNext, promote, remove, move, clear, advance, back, jumpTo, setShuffle, setRepeat, reconcile, toGive, needsSwitch, nextUp, upcoming, MAX_GIVEN } from '../src/queue/model.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

// a repeatable random
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const song = (id, extra = {}) => ({ id, uri: `spotify:track:${id}`, name: `Song ${id}`, duration_ms: 200000, artists: [{ id: 'ar', name: 'Artist' }], album: { id: 'al', name: 'Al', images: [] }, ...extra });
const names = (list) => list.map((e) => e.id).join(',');
const pl = source({ kind: 'playlist', uri: 'spotify:playlist:bond', name: 'Bond Themes', tracks: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id)) });

// --- pressing play -----------------------------------------------------------------------------
{
  const q = play(emptyQueue(), pl, { start: 2 });
  check('play at a song: it is now', q.now.id === 'c');
  check('...and Then is the rest of the playlist after it', names(q.then) === 'd,e,f');
  check('...from the playlist', q.source.name === 'Bond Themes' && q.now.from === 'source');
  const s = play(emptyQueue(), pl, { start: 2, shuffle: true, random: seeded(1) });
  check('shuffle play at a song starts on it', s.now.id === 'c');
  check('...and Then holds every other song once', names(s.then).split(',').sort().join(',') === 'a,b,d,e,f');
  const r = play(emptyQueue(), pl, { shuffle: true, random: seeded(7) });
  check('shuffle play with no song chosen starts somewhere in the playlist', ['a', 'b', 'c', 'd', 'e', 'f'].includes(r.now.id) && r.then.length === 5);
  const withBad = source({ kind: 'playlist', tracks: [song('x', { is_playable: false }), song('y'), song('z')] });
  check('a song that can\'t play is passed over at the start', play(emptyQueue(), withBad, { start: 0 }).now.id === 'y');
  check('...and when no song is chosen', play(emptyQueue(), withBad).now.id === 'y');
}

// --- Next up -----------------------------------------------------------------------------------
{
  let q = play(emptyQueue(), pl, { start: 0 });
  q = add(q, [song('n1'), song('n2')]);
  q = playNext(q, [song('n0')]);
  check('added songs go to Next up, Play next at its front', names(q.next) === 'n0,n1,n2');
  check('Next up comes before Then', names(upcoming(q)) === 'n0,n1,n2,b,c,d,e,f' && nextUp(q).id === 'n0');
  q = move(q, q.next[2].key, 0);
  check('moving within Next up', names(q.next) === 'n2,n0,n1');
  q = remove(q, q.next[1].key);
  check('removing from Next up', names(q.next) === 'n2,n1');
  q = promote(q, q.then.find((e) => e.id === 'd').key);
  check('a Then song moved to the front of Next up', names(q.next) === 'd,n2,n1' && !q.then.some((e) => e.id === 'd'));
  q = move(q, q.then[2].key, 0);
  check('moving within Then', names(q.then) === 'e,b,c,f');
  check('clear empties Next up only', clear(q).next.length === 0 && clear(q).then.length === 4);
  const fresh = play(q, source({ kind: 'album', name: 'Other', tracks: [song('o1'), song('o2')] }), { start: 0 });
  check('pressing play on something new keeps Next up (decision 6)', names(fresh.next) === 'd,n2,n1' && fresh.now.id === 'o1' && names(fresh.then) === 'o2');
  check('...and the song that was playing goes to Played', fresh.played[0].id === 'a');
  const twice = add(play(emptyQueue(), pl, { start: 0 }), [song('n1'), song('n1')]);
  check('the same song added twice is two entries', twice.next.length === 2 && twice.next[0].key !== twice.next[1].key);
}

// --- moving through it -------------------------------------------------------------------------
{
  let q = add(play(emptyQueue(), pl, { start: 0 }), [song('n1')]);
  q = advance(q);
  check('advance plays Next up first', q.now.id === 'n1' && q.next.length === 0 && q.played[0].id === 'a');
  q = advance(q);
  check('then Then', q.now.id === 'b' && names(q.then) === 'c,d,e,f');
  q = back(q);
  check('back: the previous song again', q.now.id === 'n1');
  check('...and the one that was playing is next again', names(q.then) === 'b,c,d,e,f');
  q = back(q);
  check('back again: the added song returns to Next up', q.now.id === 'a' && names(q.next) === 'n1');
  check('back with nothing played does nothing', back(play(emptyQueue(), pl, { start: 0 })).now.id === 'a');
  let j = add(play(emptyQueue(), pl, { start: 0 }), [song('n1'), song('n2')]);
  j = jumpTo(j, j.then.find((e) => e.id === 'd').key);
  check('jumping to a Then song: it plays, songs skipped over are left out, Next up kept', j.now.id === 'd' && names(j.then) === 'e,f' && names(j.next) === 'n1,n2');
  j = jumpTo(j, j.next[1].key);
  check('jumping to the second added song drops the first', j.now.id === 'n2' && j.next.length === 0);
  j = jumpTo(j, j.played.find((e) => e.id === 'a').key);
  check('jumping back to a played song', j.now.id === 'a');
  let end = play(emptyQueue(), source({ kind: 'list', tracks: [song('x'), song('y')] }), { start: 0 });
  end = advance(advance(end));
  check('running out: nothing playing, the last song in Played', end.now === null && end.played[0].id === 'y');
  const skipBad = advance(play(emptyQueue(), source({ kind: 'list', tracks: [song('x'), song('u', { is_playable: false }), song('y')] }), { start: 0 }));
  check('advance passes over a song that can\'t play', skipBad.now.id === 'y');
}

// --- shuffle and repeat ------------------------------------------------------------------------
{
  let q = play(emptyQueue(), pl, { start: 1 });
  q = remove(q, q.then.find((e) => e.id === 'e').key);
  q = add(q, [song('n1')]);
  q = setShuffle(q, true, { random: seeded(3) });
  check('shuffle on: the rest of the playlist, without the removed song or the current one', names(q.then).split(',').sort().join(',') === 'a,c,d,f');
  check('...Next up untouched', names(q.next) === 'n1');
  q = advance(advance(q));
  const playedFromThen = q.now.id;
  q = setShuffle(q, false);
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];
  check('shuffle off: the playlist\'s order after the current song, nothing played or removed', names(q.then) === order.filter((id) => order.indexOf(id) > order.indexOf(playedFromThen) && id !== 'e').join(','));
  let r = setRepeat(play(emptyQueue(), source({ kind: 'list', tracks: [song('x'), song('y')] }), { start: 0 }), 'all');
  r = advance(r);
  check('repeat all: at the last song Then already holds the next pass', r.now.id === 'y' && names(r.then) === 'x,y');
  r = advance(r);
  check('...and it goes round', r.now.id === 'x');
  check('repeat one never asks for a new list', needsSwitch(setRepeat(add(r, [song('n')]), 'one'), toGive(r)) === false);
}

// --- what Spotify reports ----------------------------------------------------------------------
{
  const q = add(play(emptyQueue(), pl, { start: 0 }), [song('n1')]);
  check('the same song: nothing changes', reconcile(q, song('a')).change === 'same');
  const adv = reconcile(q, song('n1'));
  check('the next song: the queue moves on', adv.change === 'advanced' && adv.queue.now.id === 'n1');
  const jump = reconcile(q, song('d'));
  check('a song further on: jumped to', jump.change === 'jumped' && jump.queue.now.id === 'd' && names(jump.queue.then) === 'e,f');
  const prev = reconcile(advance(q), song('a'));
  check('the last song played: gone back', prev.change === 'back' && prev.queue.now.id === 'a');
  const out = reconcile(q, song('zz'));
  check('a song from elsewhere becomes now, the queue kept', out.change === 'outside' && out.queue.now.id === 'zz' && names(out.queue.next) === 'n1' && names(out.queue.then) === 'b,c,d,e,f');
  const relinked = reconcile(q, { ...song('n1-gb'), name: 'Song n1', linked_from: { uri: 'spotify:track:n1', id: 'n1' } });
  check('a relinked copy is recognised by what it was linked from', relinked.change === 'advanced');
  const bare = reconcile(q, { ...song('n1-gb'), name: 'Song n1' });
  check('...and with no linked_from, by title, artist and length', bare.change === 'advanced');
  const live = reconcile(q, { ...song('n1-live'), name: 'Song n1', duration_ms: 260000 });
  check('a different recording of the same title is not it', live.change === 'outside');
}

// --- what Spotify is given ---------------------------------------------------------------------
{
  let q = add(play(emptyQueue(), pl, { start: 0 }), [song('n1')]);
  const given = toGive(q);
  check('Spotify is given the current song, Next up, then Then', given.uris.join(',') === ['a', 'n1', 'b', 'c', 'd', 'e', 'f'].map((id) => `spotify:track:${id}`).join(','));
  check('nothing to change while the queue matches', needsSwitch(q, given) === false);
  check('a song added: Spotify needs a new list before this song ends', needsSwitch(add(q, [song('n2')]), given) === false && needsSwitch(playNext(q, [song('n2')]), given) === true);
  const deep = remove(q, q.then[3].key);
  check('a song removed far down: nothing yet', needsSwitch(deep, given) === false);
  // the removed song was e (Then: b c d e f): once d is playing, Spotify's next would be e
  const near = advance(advance(advance(advance(deep))));
  check('...until it would be next', needsSwitch(near, given) === true);
  check('Spotify not playing from a list Jomify gave', needsSwitch(q, null) === true);
  const shuf = setShuffle(clear(q), true, { random: seeded(5) });
  check('shuffle: a new list exactly when the next song changed', nextUp(shuf).id !== 'b' && needsSwitch(shuf, toGive(clear(q))) === true);
  const big = play(emptyQueue(), source({ kind: 'playlist', tracks: Array.from({ length: 900 }, (_, i) => song('s' + i)) }), { start: 0 });
  check('at most 500 songs are given', toGive(big).uris.length === MAX_GIVEN);
  const bad = play(emptyQueue(), source({ kind: 'list', tracks: [song('x'), song('u', { is_playable: false }), song('y')] }), { start: 0 });
  check('songs that can\'t play are left out of the list', toGive(bad).uris.join(',') === 'spotify:track:x,spotify:track:y');
  check('a playlist Jomify can\'t read is not given as a list', toGive(play(emptyQueue(), source({ kind: 'playlist', readOnly: true, tracks: [song('x')] }))) === null);
  const ended = advance(play(emptyQueue(), source({ kind: 'list', tracks: [song('x')] }), { start: 0 }));
  check('with nothing playing there is nothing to give', toGive(ended) === null);
}

// --- the wrong song after a pause (19 Oct): a queued song paused, Spotify drops the session ------
{
  let q = play(emptyQueue(), source({ kind: 'playlist', uri: 'spotify:playlist:p', name: 'Mix', tracks: ['rock', 'wolf', 'skyfall', 'yknm'].map((id) => song(id)) }), { start: 1 });
  q = add(q, [song('awtd')]);
  q = advance(q);
  check('the queued song is playing', q.now.id === 'awtd');
  const given = toGive(q);
  check('Play hands Spotify that song first, never the playlist "at" it', given.uris[0] === 'spotify:track:awtd');
  check('...and the playlist carries on after the last song it played', given.uris[1] === 'spotify:track:skyfall');
}

// --- a long playlist, started from one page --------------------------------------------------
{
  const all = Array.from({ length: 300 }, (_, i) => song('s' + i));
  const firstPage = source({ kind: 'playlist', uri: 'spotify:playlist:long', name: 'Long', tracks: all.slice(0, 100), total: 300 });
  let q = play(emptyQueue(), firstPage, { start: 5 });
  check('started from the first page: Then is that page after the song', q.now.id === 's5' && q.then.length === 94);
  const full = source({ kind: 'playlist', uri: 'spotify:playlist:long', name: 'Long', tracks: all });
  const filled = withFullSource(q, full);
  check('the rest loaded: Then runs to the end, in order', filled.then.length === 294 && filled.then[0].id === 's6' && filled.then[293].id === 's299');
  check('...the entries already lined up keep their keys', filled.then[0].key === q.then[0].key && filled.now.key === q.now.key);
  let sq = play(emptyQueue(), firstPage, { start: 5, shuffle: true, random: seeded(2) });
  const reshuffled = withFullSource(sq, full, { reshuffle: true, random: seeded(4) });
  check('shuffle from one page, reshuffled once all loaded: the next song stays next', reshuffled.then[0].key === sq.then[0].key && reshuffled.then.length === 299);
  check('...and songs beyond the first page come early too', reshuffled.then.slice(1, 40).some((e) => Number(e.id.slice(1)) >= 100));
  const kept = withFullSource(sq, full, { random: seeded(4) });
  check('songs loaded again for a queue already lined up: its order kept, the rest after', kept.then.slice(0, sq.then.length).map((e) => e.key).join() === sq.then.map((e) => e.key).join() && kept.then.length === 299);
}

// --- shared between devices (api/_lib/queue.js) -----------------------------------------------
{
  const base = play(emptyQueue(), pl, { start: 0 });
  const set = applyOp(null, 3, { op: 'set', base: 3, args: { q: base, given: { keys: ['k'], uris: ['u'] } } });
  check('a set from the device that saw the latest revision lands', set.state?.q === base && set.state.given.keys[0] === 'k');
  check('a set from a device behind the latest is refused', applyOp(null, 4, { op: 'set', base: 3, args: { q: base } }).conflict === true);
  check('...unless it insists (an explicit play or skip there)', Boolean(applyOp(null, 4, { op: 'set', base: 3, force: true, args: { q: base } }).state));
  const e = entry(song('n9'), 'next');
  const added = applyOp({ q: base, given: null }, 4, { op: 'add', args: { entries: [e] } });
  check('an edit applies to what is stored, the entry keeping its key', added.state.q.next[0].key === e.key && added.state.q.now.id === 'a');
  const twice = applyOp(added.state, 5, { op: 'playNext', args: { entries: [entry(song('n8'), 'next')] } });
  check('a second device\'s edit keeps the first\'s', names(twice.state.q.next) === 'n8,n9');
  check('remove, move and clear apply too', applyOp(twice.state, 6, { op: 'remove', args: { key: e.key } }).state.q.next.length === 1 && applyOp(twice.state, 6, { op: 'clear' }).state.q.next.length === 0);
  check('an edit with nothing stored starts from an empty queue', applyOp(null, 0, { op: 'add', args: { entries: [e] } }).state.q.next.length === 1);
  check('an unknown operation is refused', Boolean(applyOp(null, 0, { op: 'drop' }).error));
  check('addEntries marks them as added', addEntries(emptyQueue(), [{ ...e, from: 'source' }]).next[0].from === 'next');
}

console.log(`\nqueue model: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
