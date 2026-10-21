// The mirror of what Spotify holds (src/queue/mirror.js): every song change is Spotify's own, the
// queue's next song reaching it through its own queue; tonight's party (21 Oct) as cases.
import { emptyQueue, source, play, add, playNext, remove, advance, reconcile, toGive, nextUp, setRepeat, continueWith } from '../src/queue/model.js';
import { emptyMirror, asMirror, handed, queuedOne, spotifyNext, songStarted, decide, onNext, placeOf, FEED_AT_MS } from '../src/queue/mirror.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const song = (id) => ({ id, uri: `spotify:track:${id}`, name: `Song ${id}`, duration_ms: 200000, artists: [{ id: 'ar', name: 'Artist' }], album: { id: 'al', name: 'Al', images: [] } });
const track = (id) => ({ uri: `spotify:track:${id}`, id });
const pl = source({ kind: 'playlist', uri: 'spotify:playlist:p', name: 'Backing', tracks: ['a', 'b', 'c', 'd', 'e', 'f'].map(song) });

// Spotify, as measured: its queue first (oldest first), then the list it was handed
function spotify() {
  let list = [], at = 0, queue = [];
  return {
    hand(uris) { list = uris.slice(); at = 0; return list[0]; },
    add(uri) { queue.push(uri); },
    songEnds() { if (queue.length) return queue.shift(); at += 1; return list[at] || null; },
    skip() { return this.songEnds(); }
  };
}

// Jomify and Spotify together through song changes: the engine's rule, minus the clock
function run(start) {
  const sp = spotify();
  let q = start;
  let m = handed(emptyMirror(), toGive(q));
  sp.hand(toGive(q).uris);
  const heard = [q.now.id];
  const hands = [];
  const sent = [];
  return {
    get q() { return q; }, get m() { return m; }, heard, hands, sent,
    edit(fn) { q = fn(q); },
    // the last ten seconds of the song on now, then the song change
    end() {
      const d = decide(q, m, FEED_AT_MS - 500);
      if (d.action === 'queue') { sp.add(d.entry.uri); m = queuedOne(m, d.entry); sent.push(d.entry.id); }
      const uri = sp.songEnds();
      if (!uri) { heard.push('(stopped)'); return; }
      const id = uri.split(':').pop();
      const s = songStarted(m, track(id));
      m = s.mirror;
      const p = placeOf(q, track(id));
      if (s.from === 'queued' && p.place === 'gone') { heard.push(`${id}(skipped)`); const next = sp.skip(); const s2 = songStarted(m, track(next.split(':').pop())); m = s2.mirror; q = reconcile(q, track(next.split(':').pop())).queue; heard.push(next.split(':').pop()); return; }
      q = reconcile(q, track(id)).queue;
      heard.push(id);
    },
    next() {
      const after = advance(q);
      if (onNext(m, after) === 'skip') { const uri = sp.skip(); const s = songStarted(m, track(uri.split(':').pop())); m = s.mirror; q = reconcile(q, track(uri.split(':').pop())).queue; heard.push(q.now.id); return 'skip'; }
      q = after; m = handed(m, toGive(q)); sp.hand(toGive(q).uris); hands.push(q.now.id); heard.push(q.now.id); return 'hand';
    }
  };
}

// --- reading the mirror ------------------------------------------------------------------------
{
  check('an empty mirror: Spotify has nothing next', spotifyNext(emptyMirror()) === null);
  const old = asMirror({ uris: ['u1', 'u2'], keys: ['k1', 'k2'], at: 0 });
  check('a record from before the rebuild is read as a mirror', old.list.keys[1] === 'k2' && old.queued.length === 0);
  check('...and a missing one as empty', asMirror(null).list === null);
  const q = play(emptyQueue(), pl, { start: 0 });
  let m = handed(emptyMirror(), toGive(q));
  check('after a hand-over, Spotify\'s next is the list\'s second song', spotifyNext(m).key === q.then[0].key && spotifyNext(m).from === 'list');
  m = queuedOne(m, { key: 'x', uri: 'spotify:track:x' });
  check('a song in Spotify\'s queue comes before the list', spotifyNext(m).key === 'x' && spotifyNext(m).from === 'queued');
  check('a new list leaves Spotify\'s queue as it was', handed(m, toGive(q)).queued.length === 1);
  const s = songStarted(m, track('x'));
  check('the queued song starting: from the queue, and gone from it', s.from === 'queued' && s.mirror.queued.length === 0);
  const l = songStarted(handed(emptyMirror(), toGive(q)), track('c'));
  check('a list song further on: at moves there', l.from === 'list' && l.mirror.at === 2);
  check('the list song already on: same', songStarted(handed(emptyMirror(), toGive(q)), track('a')).from === 'same');
  check('a song from neither: outside', songStarted(m, track('zz')).from === 'outside');
  const two = queuedOne(queuedOne(emptyMirror(), { key: 'x', uri: 'spotify:track:x' }), { key: 'y', uri: 'spotify:track:y' });
  check('Spotify passing over a queued song (a skip in its app) takes both out', songStarted(two, track('y')).mirror.queued.length === 0);
}

// --- deciding ----------------------------------------------------------------------------------
{
  let q = play(emptyQueue(), pl, { start: 0 });
  let m = handed(emptyMirror(), toGive(q));
  check('a playlist playing as handed: nothing to send', decide(q, m, 5000).action === 'none');
  q = add(q, [song('x')]);
  const early = decide(q, m, 60000);
  check('a song added with a minute to go: wait until ten seconds before the end', early.action === 'wait' && early.in === 60000 - FEED_AT_MS);
  const due = decide(q, m, 9000);
  check('...then it goes into Spotify\'s queue', due.action === 'queue' && due.entry.id === 'x');
  m = queuedOne(m, due.entry);
  check('...once, not again', decide(q, m, 5000).action === 'none');
  check('repeat one: nothing to send', decide(setRepeat(q, 'one'), m, 5000).action === 'none');
  const ended = advance(advance(advance(advance(advance(advance(play(emptyQueue(), pl, { start: 0 })))))));
  check('the queue run out with the list over too: continue, no stop needed', (() => { const d = decide({ ...ended, now: song('f') }, handed(emptyMirror(), { uris: ['spotify:track:f'], keys: ['kf'] }), 5000); return d.action === 'continue' && !d.thenStop; })());
  const last = play(emptyQueue(), pl, { start: 5 });
  const longList = { list: { uris: ['spotify:track:f', 'spotify:track:g'], keys: [last.now.key, 'kg'] }, at: 0, queued: [] };
  check('the queue run out but Spotify would go on: continue, else stop at the end', decide(last, longList, 5000).thenStop === true);
  const cont = continueWith(last, source({ kind: 'liked', name: 'Liked Songs', tracks: ['l1', 'l2'].map(song) }));
  check('a continuation lines up after the song playing, which stays', cont.now.id === 'f' && nextUp(cont).id === 'l1');
  check('...and its first song is sent like any other', decide(cont, longList, 5000).action === 'queue');
}

// --- the party on 21 Oct, as it should have gone ---------------------------------------------
{
  // the backing playlist, then a request, then the song after it: that song change must be
  // Spotify's own too (it fell back to a last-moment list, which left the speaker silent)
  const r = run(play(emptyQueue(), pl, { start: 0 }));
  r.edit((q) => playNext(q, [song('req1')]));
  r.end();
  check('a request goes through Spotify\'s queue and plays', r.heard.join() === 'a,req1' && r.sent.join() === 'req1');
  r.end();
  check('...and the song after it is the list\'s, with nothing handed over', r.heard.join() === 'a,req1,b' && r.hands.length === 0);
  // several requests in a row
  r.edit((q) => playNext(q, [song('req2')]));
  r.end();
  r.edit((q) => playNext(q, [song('req3')]));
  r.end();
  r.end();
  check('requests one after another, each through Spotify\'s queue, never a new list', r.heard.join() === 'a,req1,b,req2,req3,c' && r.hands.length === 0);
  check('...each sent once', r.sent.join() === 'req1,req2,req3');
}

// --- the duplicate on 21 Oct -------------------------------------------------------------------
{
  // Dreaming of You went into Spotify's queue, Spotify jumped elsewhere, and later the queue wanted
  // it next again: it was already waiting, so it must not go in a second time
  let q = play(emptyQueue(), pl, { start: 0 });
  let m = handed(emptyMirror(), toGive(q));
  q = playNext(q, [song('dream')]);
  const d1 = decide(q, m, 1000);
  m = queuedOne(m, d1.entry);
  // Spotify jumps to c in its list (a press on the speaker); the queue follows
  const j = songStarted(m, track('c'));
  m = j.mirror;
  q = reconcile(q, track('c')).queue;
  check('after the jump the song is still waiting in Spotify\'s queue', m.queued.length === 1);
  check('...so when the queue wants it next, nothing is sent again', decide(q, m, 1000).action === 'none');
}

// --- a change in the last ten seconds ---------------------------------------------------------
{
  // the song already sent is removed: Spotify plays it, it is skipped, and the queue's next follows
  const r = run(play(emptyQueue(), pl, { start: 0 }));
  r.edit((q) => playNext(q, [song('x')]));
  const d = decide(r.q, r.m, 5000);
  check('the added song goes in', d.action === 'queue');
  r.end();
  r.edit((q) => playNext(q, [song('y')]));
  const sent = decide(r.q, r.m, 5000);
  check('a second song added, sent in the last ten seconds', sent.action === 'queue' && sent.entry.id === 'y');
  // what the run does when y is then removed straight after being sent
  const r2 = run(play(emptyQueue(), pl, { start: 0 }));
  r2.edit((q) => playNext(q, [song('gone')]));
  // send it (the last ten seconds), then remove it before the change
  const d2 = decide(r2.q, r2.m, 5000);
  check('sent before it was removed', d2.action === 'queue');
  r2.edit((q) => q);
  const sp = { m: queuedOne(r2.m, d2.entry) };
  const q2 = remove(r2.q, r2.q.next[0].key);
  check('removed after being sent: the queue\'s next goes in behind it', decide(q2, sp.m, 4000).action === 'queue' && decide(q2, sp.m, 4000).entry.id === 'b');
  check('...and when the removed one starts it is known to be unwanted', placeOf(q2, track('gone')).place === 'gone');
}

// --- Next -------------------------------------------------------------------------------------
{
  const r = run(play(emptyQueue(), pl, { start: 0 }));
  check('Next with Spotify\'s next already the queue\'s: Spotify\'s own skip', r.next() === 'skip' && r.q.now.id === 'b');
  r.edit((q) => add(q, [song('x')]));
  check('Next with a song added that isn\'t in Spotify yet: a new list, at once', r.next() === 'hand' && r.q.now.id === 'x' && r.hands.join() === 'x');
  r.end();
  check('...and the list after it carries on', r.q.now.id === 'c');
}

console.log(`\nqueue mirror: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
