// Loading the songs of something pressed play on, for the queue: a playlist, an album, an artist,
// or Liked Songs. A long one is loaded a page at a time; the first page (or the page holding the
// song to start on) is enough to start playing, and `onFull` hands over the whole list once the
// rest is in, so a tap never waits on a 2,000-song playlist.

import { useUserStore } from '../store/userStore';
import { fetchMoreTracks, fetchAlbumTracks, fetchArtistTopTracks, fetchArtistAlbums } from '../services/spotify/api';
import { playlistItemsUrl } from '../services/spotify/compat';
import { likedSongsLoaded } from '../services/likedLibrary';

const PAGE = 100;
const LIKED_PAGE = 50;

// What a Spotify uri names, as the queue understands sources
export function kindOf(uri) {
  const m = /^spotify:(playlist|album|artist):([^:]+)$/.exec(uri || '');
  if (m) return { kind: m[1], id: m[2] };
  if (/^spotify:user:[^:]+:collection$/.test(uri || '') || uri === 'spotify:collection:tracks') return { kind: 'liked', id: null };
  return null;
}

const tracksOf = (page) => (page?.items || []).map((i) => i?.track).filter((t) => t?.uri);

async function pagesFrom(token, firstUrl, { startAt = null, pageSize, onFull }) {
  const first = await fetchMoreTracks(token, firstUrl);
  const total = first.total ?? tracksOf(first).length;
  let start = startAt;
  const pairs = tracksOf(first).map((t, n) => [n, t]);
  const urlAt = (offset) => `${firstUrl}${firstUrl.includes('?') ? '&' : '?'}offset=${offset}`;
  // a song chosen beyond the first page (a shuffle start, a row far down): fetch its page too
  if (start === 'random') start = total ? Math.floor(Math.random() * total) : 0;
  if (start !== null && start >= pairs.length && start < total) {
    const offset = Math.floor(start / pageSize) * pageSize;
    const page = await fetchMoreTracks(token, urlAt(offset));
    pairs.push(...tracksOf(page).map((t, n) => [offset + n, t]));
  }
  // the rest, after the first song is playing
  if (first.next && onFull) {
    (async () => {
      const all = tracksOf(first);
      let next = first.next;
      while (next) {
        const page = await fetchMoreTracks(token, next);
        all.push(...tracksOf(page));
        next = page.next;
      }
      onFull(all, total);
    })().catch(() => { /* the part already loaded keeps playing */ });
  }
  return { pairs, total, start, complete: !first.next };
}

// -> { tracks: [i, track] pairs, total, start, complete } with `onFull(tracks, total)` called once
// the whole list is in, when it was not already
export async function loadSource(uri, { start = null, onFull } = {}) {
  const token = useUserStore.getState().token;
  const what = kindOf(uri);
  if (!token || !what) return null;
  if (what.kind === 'playlist') {
    return pagesFrom(token, playlistItemsUrl(what.id, `limit=${PAGE}`), { startAt: start, pageSize: PAGE, onFull });
  }
  if (what.kind === 'liked') {
    const userId = useUserStore.getState().profile?.id;
    const cached = userId ? likedSongsLoaded(userId) : null;
    if (cached?.length) {
      const pairs = cached.map((t, n) => [n, t]);
      return { pairs, total: cached.length, start: start === 'random' ? Math.floor(Math.random() * cached.length) : start, complete: true };
    }
    return pagesFrom(token, `https://api.spotify.com/v1/me/tracks?limit=${LIKED_PAGE}&market=from_token`, { startAt: start, pageSize: LIKED_PAGE, onFull });
  }
  if (what.kind === 'album') {
    const tracks = await fetchAlbumTracks(token, what.id);
    return { pairs: tracks.map((t, n) => [n, t]), total: tracks.length, start: start === 'random' ? Math.floor(Math.random() * tracks.length) : start, complete: true };
  }
  if (what.kind === 'artist') {
    // Spotify's own artist play is their popular songs, then their albums; the same here, as far
    // as Spotify still lets Jomify see: the popular songs, then the songs of their latest albums
    const top = await fetchArtistTopTracks(token, what.id, '').catch(() => []);
    const albums = await fetchArtistAlbums(token, what.id, 'album', { maxPages: 1 }).catch(() => []);
    const more = [];
    for (const album of albums.slice(0, 3)) more.push(...(await fetchAlbumTracks(token, album.id).catch(() => [])));
    const seen = new Set();
    const tracks = [...top, ...more].filter((t) => t?.uri && !seen.has(t.uri) && seen.add(t.uri));
    return { pairs: tracks.map((t, n) => [n, t]), total: tracks.length, start: start === 'random' ? Math.floor(Math.random() * Math.max(1, tracks.length)) : start, complete: true };
  }
  return null;
}
