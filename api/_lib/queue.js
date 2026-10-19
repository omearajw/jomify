import * as Q from '../../src/queue/model.js';

// The play queue kept for a listener's devices to share (api/queue.js, src/queue/share.js): what
// a request does to the stored queue, apart from storage. A "set" replaces it, from the device
// playing the music, and only if nothing changed since that device last saw it (otherwise the
// device is told, and merges); an edit (add, play next, remove, move, promote, clear) is applied
// to whatever is stored, so edits from two devices never overwrite each other.

export const MAX_BYTES = 700_000;

const EDITS = {
  add: (q, a) => (a.entries ? Q.addEntries(q, a.entries) : Q.add(q, a.tracks || [])),
  playNext: (q, a) => (a.entries ? Q.addEntries(q, a.entries, { first: true }) : Q.playNext(q, a.tracks || [])),
  remove: (q, a) => Q.remove(q, a.key),
  move: (q, a) => Q.move(q, a.key, Number(a.to) || 0),
  promote: (q, a) => Q.promote(q, a.key),
  clear: (q) => Q.clear(q)
};

export const isOp = (op) => op === 'set' || Object.prototype.hasOwnProperty.call(EDITS, op);

// stored: { q, given } or null; rev: the stored revision; body: { op, args, base, force }
// -> { conflict: true } | { error } | { state: { q, given } }
export function applyOp(stored, rev, body) {
  const { op, args = {}, base, force } = body || {};
  if (!isOp(op)) return { error: 'Unknown queue operation' };
  if (op === 'set') {
    if (!args.q || typeof args.q !== 'object') return { error: 'A set needs a queue' };
    if (!force && Number(base) !== rev) return { conflict: true };
    return { state: { q: args.q, given: args.given ?? null } };
  }
  const q = stored?.q || Q.emptyQueue();
  return { state: { q: EDITS[op](q, args), given: stored?.given ?? null } };
}
