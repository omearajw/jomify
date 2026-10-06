import { fetchInitialLikedSongs, fetchMoreTracks } from './spotify/api';

// Every liked song, loaded once per session on request (an artist page asking "which of these
// are mine?"). A big library is many pages, so this is only ever started by a tap, reports
// progress, and keeps the answer for the rest of the session. Keyed by account.
let cache = null; // { userId, tracks }
let inFlight = null;

export function likedSongsLoaded(userId) {
  return cache && cache.userId === userId ? cache.tracks : null;
}

export async function loadAllLikedSongs(token, userId, onProgress) {
  const have = likedSongsLoaded(userId);
  if (have) return have;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const first = await fetchInitialLikedSongs(token);
    const tracks = (first.items || []).map((i) => i.track).filter(Boolean);
    const total = first.total || tracks.length;
    onProgress?.(tracks.length, total);
    let next = first.next;
    while (next) {
      const page = await fetchMoreTracks(token, next);
      tracks.push(...(page.items || []).map((i) => i.track).filter(Boolean));
      onProgress?.(tracks.length, total);
      next = page.next;
    }
    cache = { userId, tracks };
    return tracks;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export const likedSongsByArtist = (tracks, artistId) => tracks.filter((t) => (t.artists || []).some((a) => a.id === artistId));
