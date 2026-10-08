// Who plays next at a party. Shared by the server (which picks) and the guest page (which shows
// where a request sits), so both tell the same story.
//
// Who plays next at a party, in three tiers:
//   1. Songs the host pinned ("play next"), in the order they were pinned.
//   2. Songs the room has upvoted: any vote at all jumps the queue, most votes first; ties go to
//      whoever's turn comes first, then to the earlier request.
//   3. Everything else takes turns by guest: everyone's first waiting song plays before anyone's
//      second, earlier requests first within a turn. Someone who queues a pile still only gets
//      one song per turn, so a newcomer's single song goes straight in behind the current turn.
// A guest can't vote for their own request (the server refuses), so voting is the room's say.

export const PER_GUEST_CAP = 10;
export const MAX_QUEUE = 200;
export const RECENT_REPEAT_WINDOW = 30; // a song played this recently can't be requested again

export function orderQueue(items) {
  // Each item's turn is its place among its own guest's requests by time, not by list position,
  // so re-saving an item (a pin, a vote) never changes whose turn it is
  const byGuest = new Map();
  for (const item of [...items].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const list = byGuest.get(item.guestId) || [];
    list.push(item);
    byGuest.set(item.guestId, list);
  }
  const turnOf = new Map();
  for (const list of byGuest.values()) list.forEach((item, i) => turnOf.set(item, i));
  return [...items].sort((a, b) => {
    const pa = a.pinnedAt || 0;
    const pb = b.pinnedAt || 0;
    if (pa !== pb) return pa && pb ? pa - pb : pa ? -1 : 1;
    const va = a.votes || 0;
    const vb = b.votes || 0;
    if (va !== vb) return vb - va;
    const ta = turnOf.get(a);
    const tb = turnOf.get(b);
    if (ta !== tb) return ta - tb;
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
