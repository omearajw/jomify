// Jomify's own queue, the pure parts: what is kept of a song, when the head of the queue is handed
// to Spotify, how a handed-over song is recognised when it plays, and how the list is edited.
// Spotify's queue lives on the device and is lost to a reconnect, a device change or a new
// context, so Jomify keeps the order itself and hands over one song at a time, just before it
// is due (see queueConductor.js).

export const FEED_AT_MS = 15000;      // hand the next song over with this much of the current one left
export const FED_TIMEOUT_MS = 90000;  // a handed-over song Spotify has not started by then is checked on
export const FEED_RETRY_MS = 5000;    // after Spotify refused a hand-over

let counter = 0;
export const newKey = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

// What the queue keeps of a song: enough for a row and for Spotify
export function slimTrack(track) {
  return {
    key: newKey(),
    id: track.id,
    uri: track.uri,
    name: track.name,
    duration_ms: track.duration_ms,
    linked_from: track.linked_from ? { id: track.linked_from.id, uri: track.linked_from.uri } : undefined,
    artists: (track.artists || []).map((a) => ({ id: a.id, name: a.name, uri: a.uri })),
    album: track.album ? { id: track.album.id, name: track.album.name, images: track.album.images?.[0] ? [track.album.images[0]] : [] } : undefined,
    addedAt: Date.now()
  };
}

// Is this (playing or queued) Spotify track the queued item? By uri or id, by what it was relinked
// from or to, and, since development-mode apps no longer get linked_from, by its name and artists
const artistsOf = (x) => (x?.artists || []).map((a) => a?.name).filter(Boolean).join(', ');
export function isItem(x, item) {
  if (!x || !item) return false;
  if (x.uri && x.uri === item.uri) return true;
  if (x.id && x.id === item.id) return true;
  if (x.linked_from && (x.linked_from.uri === item.uri || x.linked_from.id === item.id)) return true;
  if (item.linked_from && (item.linked_from.uri === x.uri || item.linked_from.id === x.id)) return true;
  if (item.relinked_to && (item.relinked_to.uri === x.uri || item.relinked_to.id === x.id)) return true;
  return Boolean(x.name && x.name === item.name && artistsOf(x) === artistsOf(item));
}

// Should the head of the queue be handed over now? Only while a song is playing and nearly done,
// with nothing already handed over and a moment since the last refusal
export function feedDue({ state, posMs, now, fed, items, lastFailAt = 0 }) {
  if (!items?.length || fed || !state || state.paused) return false;
  if (!state.duration || !(state.duration > 0)) return false;
  if (now - lastFailAt < FEED_RETRY_MS) return false;
  const remaining = state.duration - (posMs || 0);
  return remaining > 0 && remaining < FEED_AT_MS;
}

// What became of a handed-over song: it is playing, it is still waiting, or it has waited too long
export function resolveFed(fed, currentTrack, now) {
  if (!fed) return 'none';
  if (isItem(currentTrack, fed.item)) return 'played';
  if (now - fed.at > FED_TIMEOUT_MS) return 'timeout';
  return 'waiting';
}

// Spotify's own queue, with the songs Jomify is holding taken out, for "next from the playlist"
export function withoutQueued(spotifyQueue, items) {
  const remaining = [...(spotifyQueue || [])];
  for (const item of items || []) {
    const at = remaining.findIndex((x) => isItem(x, item));
    if (at >= 0) remaining.splice(at, 1);
  }
  return remaining;
}

// --- Editing -----------------------------------------------------------------------------------

export const removeKey = (items, key) => items.filter((it) => it.key !== key);

// Move one song to a new position in the list
export function moveKey(items, key, toIndex) {
  const from = items.findIndex((it) => it.key === key);
  if (from < 0) return items;
  const out = items.slice();
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, toIndex)), 0, it);
  return out;
}

// The first queued item this track is, if any
export const indexOfTrack = (items, track) => items.findIndex((it) => isItem(track, it));

// The old record of hand-queued songs, carried into the queue once
export const migrateManual = (list) => (Array.isArray(list) ? list.filter((t) => t?.uri).map((t) => ({ ...slimTrack(t), addedAt: 0 })) : []);
