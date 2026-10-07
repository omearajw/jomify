// Who plays next at a party. Shared by the server (which picks) and the guest page (which shows
// where a request sits), so both tell the same story.
//
// Round-robin by guest: everyone's first waiting song plays before anyone's second, and within a
// round the most-voted request wins, then the earlier one. Votes never move a song out of its
// round, so no amount of cheering lets one person jump everyone else's first turn. Someone who queues a hundred songs still only gets one turn
// per round, and a newcomer's single request jumps ahead of the pile. A host can pin a song to
// the front; pins play in the order they were pinned.

export const PER_GUEST_CAP = 10;
export const MAX_QUEUE = 200;
export const RECENT_REPEAT_WINDOW = 30; // a song played this recently can't be requested again

export function orderQueue(items) {
  // Each item's round is its place among its own guest's requests by time, not by list position,
  // so re-saving an item (a pin, a vote) never changes whose turn it is
  const byGuest = new Map();
  for (const item of [...items].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const list = byGuest.get(item.guestId) || [];
    list.push(item);
    byGuest.set(item.guestId, list);
  }
  const roundOf = new Map();
  for (const list of byGuest.values()) list.forEach((item, i) => roundOf.set(item, i));
  return [...items].sort((a, b) => {
    const pa = a.pinnedAt || 0;
    const pb = b.pinnedAt || 0;
    if (pa !== pb) return pa && pb ? pa - pb : pa ? -1 : 1;
    const ra = roundOf.get(a);
    const rb = roundOf.get(b);
    if (ra !== rb) return ra - rb;
    // Within a round the room's votes decide, then who asked first
    const va = a.votes || 0;
    const vb = b.votes || 0;
    if (va !== vb) return vb - va;
    return (a.at || 0) - (b.at || 0);
  });
}

// 1-based position of each of a guest's songs in the order they will play
export function positionsFor(ordered, guestId) {
  const out = {};
  ordered.forEach((item, i) => { if (item.guestId === guestId) out[item.id] = i + 1; });
  return out;
}

export function countFor(items, guestId) {
  return items.filter((item) => item.guestId === guestId).length;
}
