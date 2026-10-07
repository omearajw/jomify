// Who plays next at a party. Shared by the server (which picks) and the guest page (which shows
// where a request sits), so both tell the same story.
//
// Round-robin by guest: everyone's first waiting song plays before anyone's second, and within a
// round the earlier request wins. Someone who queues a hundred songs still only gets one turn
// per round, and a newcomer's single request jumps ahead of the pile. A host can pin a song to
// the front; pins play in the order they were pinned.

export const PER_GUEST_CAP = 10;
export const MAX_QUEUE = 200;
export const RECENT_REPEAT_WINDOW = 30; // a song played this recently can't be requested again

export function orderQueue(items) {
  const seen = new Map(); // guestId -> how many of theirs are already placed
  const ranked = items.map((item) => {
    const round = seen.get(item.guestId) || 0;
    seen.set(item.guestId, round + 1);
    return { item, round };
  });
  // Items arrive in the order they were requested (the list is append-only), so `round` above
  // is each item's position within its guest's own list
  return ranked
    .sort((a, b) => {
      const pa = a.item.pinnedAt || 0;
      const pb = b.item.pinnedAt || 0;
      if (pa !== pb) return pa && pb ? pa - pb : pa ? -1 : 1;
      if (a.round !== b.round) return a.round - b.round;
      return (a.item.at || 0) - (b.item.at || 0);
    })
    .map(({ item }) => item);
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
