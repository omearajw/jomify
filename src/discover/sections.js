import { spotifyFetch, fetchArtistAlbums, fetchArtistTopTracks, fetchAlbumTracks, fetchArtistsByIds, checkTracksLiked, fetchUserPublicPlaylists, fetchPlaylistItemsPage } from '../services/spotify/api';
import { playlistItemsUrl } from '../services/spotify/compat';
import { log } from '../services/debugLog';

// Discover's sections (Jack, 21 Oct): what each one is and how it is found. Spotify no longer gives
// apps like Jomify recommendations, related artists or its own playlists (404 since Nov 2024), so
// every section is built from what still answers: your top artists and songs, who you follow,
// search's filters, your Liked Songs and your friends' public playlists. Nothing Spotify picks to
// feature: its "new releases" list was dropped as promotion, mostly strangers (Jack, 21 Oct).
// Each loader takes a context { token, me, followed, friends, liked, top } and returns the items,
// or { items, label } when the section's name depends on what was found.

const API = 'https://api.spotify.com/v1';
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const SPACING_MS = 150;
const pause = (ms = SPACING_MS) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

// Spotify cut what apps like Jomify may ask for in one go to 10 for search in 2026; a list it
// refuses at a larger size is asked for again at 10 rather than leaving the shelf empty
async function getJson(token, url) {
  let res = await spotifyFetch(url, auth(token));
  const limit = Number(new URL(url).searchParams.get('limit') || 0);
  if (res.status === 400 && limit > 10) {
    log('discover', 'asked for too many at once', `${url.replace(API, '')}; trying 10`);
    res = await spotifyFetch(url.replace(/([?&]limit=)\d+/, (_, head) => `${head}10`), auth(token));
  }
  if (!res.ok) { const err = new Error(`${res.status} for ${url.replace(API, '')}`); err.status = res.status; throw err; }
  return res.json();
}

// Your top artists and songs over Spotify's three ranges, read once for every section that uses them
export async function loadTop(token) {
  const get = (kind, range, limit) => getJson(token, `${API}/me/top/${kind}?time_range=${range}&limit=${limit}`).then((d) => d.items || []).catch(() => []);
  const [artistsShort, artistsMedium, tracksShort, tracksMedium, tracksLong] = await Promise.all([
    get('artists', 'short_term', 20), get('artists', 'medium_term', 20), get('tracks', 'short_term', 50), get('tracks', 'medium_term', 50), get('tracks', 'long_term', 50)
  ]);
  return { artistsShort, artistsMedium, tracksShort, tracksMedium, tracksLong };
}

// The genres your top artists are filed under, most common first
export function topGenres(top, n = 2) {
  const count = new Map();
  [...top.artistsShort, ...top.artistsMedium].forEach((a) => (a.genres || []).forEach((g) => count.set(g, (count.get(g) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g);
}

const uniqueBy = (list, key) => { const seen = new Set(); return list.filter((x) => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const unliked = async (token, tracks) => { const liked = await checkTracksLiked(token, tracks.map((t) => t.id)); return tracks.filter((t) => !liked[t.id]); };
const isRecent = (r, days) => r?.release_date && Date.now() - Date.parse(r.release_date) <= days * DAY;
const newestFirst = (a, b) => String(b.release_date || '').localeCompare(String(a.release_date || ''));

// The albums and singles of artists you follow (one page each), kept for "new from" and deep cuts
const discographies = new Map();
async function discography(token, artistId) {
  if (!discographies.has(artistId)) discographies.set(artistId, fetchArtistAlbums(token, artistId, 'album,single', { maxPages: 1 }).catch((err) => { discographies.delete(artistId); throw err; }));
  return discographies.get(artistId);
}

// The artists you love, best first: the ones you follow, then your top artists, then the ones
// most in your Liked Songs. Following alone was too few for most people (Jack follows a handful;
// "new from artists you follow" found nothing and Deep cuts three songs, 21 Oct).
function lovedArtists({ followed, top, liked }, max = 40) {
  const out = new Map();
  const add = (a, rank, weight = 0) => { if (a?.id && !out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, rank, weight }); };
  followed.forEach((a) => add(a, 0));
  [...top.artistsShort, ...top.artistsMedium].forEach((a) => add(a, 1));
  const count = new Map();
  (liked || []).forEach((t) => (t.artists || []).forEach((a) => { if (a.id) count.set(a.id, { a, n: (count.get(a.id)?.n || 0) + 1 }); }));
  [...count.values()].filter((c) => c.n >= 3).sort((x, y) => y.n - x.n).forEach((c) => add(c.a, 2, c.n));
  return [...out.values()].slice(0, max);
}

export const SECTIONS = [
  {
    key: 'followedNew', label: 'New from artists you love', type: 'records', meta: 'released', needsLiked: true,
    // their releases from the last six weeks: those you follow first, then the rest, newest first
    async load(ctx) {
      const out = [];
      for (const a of lovedArtists(ctx)) {
        try { out.push(...(await discography(ctx.token, a.id)).filter((r) => isRecent(r, 42)).map((r) => ({ ...r, rank: a.rank }))); } catch (err) { if (err?.message === 'RATE_LIMITED') throw err; }
        await pause();
      }
      return uniqueBy(out, (r) => r.id).sort((x, y) => x.rank - y.rank || newestFirst(x, y));
    }
  },
  {
    key: 'newInGenres', label: 'New this year in your genres', type: 'songs',
    // this year's songs in your two most common genres. Search's genre filter finds nothing for
    // albums (tag:new genre: came back empty for Jack, 21 Oct) but works for songs.
    async load({ token, top }) {
      const out = [];
      const genres = topGenres(top);
      const year = new Date().getFullYear();
      for (const g of genres) {
        const d = await getJson(token, `${API}/search?type=track&limit=10&q=${encodeURIComponent(`genre:"${g}" year:${year}`)}`);
        const found = (d.tracks?.items || []).filter(Boolean);
        log('discover', `new this year in ${g}`, `${found.length} found`);
        out.push(...found);
        await pause();
      }
      return { items: uniqueBy(out, (t) => t.id), label: genres.length ? `New this year in ${genres.join(' and ')}` : null };
    }
  },
  {
    key: 'onRepeat', label: 'On repeat lately', type: 'songs',
    async load({ top }) { return top.tracksShort.slice(0, 20); }
  },
  {
    key: 'moreFromTop', label: 'More from your top artists', type: 'songs',
    // popular songs by your current top artists, three each, that you haven't liked
    async load({ token, top }) {
      const artists = uniqueBy([...top.artistsShort, ...top.artistsMedium], (a) => a.id).slice(0, 8);
      const out = [];
      for (const a of artists) {
        out.push(...(await fetchArtistTopTracks(token, a.id, a.name)).slice(0, 10).map((t) => ({ ...t, by: a.id })));
        await pause();
      }
      const fresh = await unliked(token, uniqueBy(out, (t) => t.id));
      const perArtist = new Map();
      return fresh.filter((t) => { const n = perArtist.get(t.by) || 0; perArtist.set(t.by, n + 1); return n < 3; });
    }
  },
  {
    key: 'usedToLove', label: 'You used to love', type: 'songs',
    // all-time top songs that are in neither your last six months nor your last four weeks
    async load({ top }) {
      const lately = new Set([...top.tracksShort, ...top.tracksMedium].map((t) => t.id));
      return top.tracksLong.filter((t) => !lately.has(t.id)).slice(0, 20);
    }
  },
  {
    key: 'dippedInto', label: "Albums you've only dipped into", type: 'records', meta: 'dipped', needsLiked: true,
    // albums of five songs or more where you've liked one or two, by the artists you like most
    async load({ liked }) {
      const byAlbum = new Map(), byArtist = new Map();
      liked.forEach((t) => {
        const al = t.album;
        if (!al?.id || (al.album_type && al.album_type !== 'album') || (al.total_tracks || 0) < 5) return;
        const e = byAlbum.get(al.id) || { ...al, liked: 0, total: al.total_tracks };
        e.liked += 1;
        byAlbum.set(al.id, e);
        (t.artists || []).forEach((a) => byArtist.set(a.id, (byArtist.get(a.id) || 0) + 1));
      });
      return [...byAlbum.values()].filter((a) => a.liked <= 2)
        .sort((a, b) => (byArtist.get(b.artists?.[0]?.id) || 0) - (byArtist.get(a.artists?.[0]?.id) || 0)).slice(0, 20);
    }
  },
  {
    key: 'likedNotFollowed', label: "Artists you like but don't follow", type: 'artists', needsLiked: true,
    // the artists that come up most in your Liked Songs (three songs or more) that you don't follow
    async load({ token, liked, followed }) {
      const following = new Set(followed.map((a) => a.id));
      const count = new Map();
      liked.forEach((t) => (t.artists || []).forEach((a) => { if (a.id && !following.has(a.id)) count.set(a.id, (count.get(a.id) || 0) + 1); }));
      const ids = [...count.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
      if (!ids.length) return [];
      const artists = await fetchArtistsByIds(token, ids);
      return artists.filter(Boolean).map((a) => ({ ...a, liked: count.get(a.id) || 0 })).sort((a, b) => b.liked - a.liked);
    }
  },
  {
    key: 'deepCuts', label: 'Deep cuts', type: 'songs', onDemand: true, needsLiked: true,
    note: () => 'Album tracks by the artists you love that you have never liked. It reads their albums, so it waits for you.',
    // two albums each from the artists you love most, their songs you haven't liked and that
    // aren't among their most popular
    async load(ctx) {
      const { token, liked } = ctx;
      const mine = new Set(liked.map((t) => t.id));
      const artists = lovedArtists(ctx, 12);
      const out = [];
      for (const a of artists) {
        try {
          const albums = (await discography(token, a.id)).filter((r) => r.album_type === 'album').slice(0, 2);
          const popular = new Set((await fetchArtistTopTracks(token, a.id, a.name)).map((t) => t.id));
          for (const al of albums) {
            out.push(...(await fetchAlbumTracks(token, al.id)).filter((t) => !mine.has(t.id) && !popular.has(t.id)).slice(0, 3));
            await pause();
          }
        } catch (err) { if (err?.message === 'RATE_LIMITED') throw err; }
      }
      return uniqueBy(out, (t) => t.id).sort(() => Math.random() - 0.5).slice(0, 30);
    }
  },
  {
    key: 'throwbacks', label: 'Throwbacks', type: 'songs',
    // your most common genre in one year, five to fifteen years ago, picked once a day
    async load({ token, top }) {
      const [g] = topGenres(top, 1);
      if (!g) return [];
      const thisYear = new Date().getFullYear();
      const day = Math.floor(Date.now() / DAY);
      const year = thisYear - 5 - (day % 11);
      const d = await getJson(token, `${API}/search?type=track&limit=10&q=${encodeURIComponent(`genre:"${g}" year:${year}`)}`);
      const items = (d.tracks?.items || []).filter(Boolean);
      log('discover', `throwbacks in ${g}, ${year}`, `${items.length} found`);
      return { items, label: `${g[0].toUpperCase()}${g.slice(1)}, ${year}` };
    }
  },
  {
    key: 'fromFriends', label: "From your friends' playlists", type: 'songs',
    // songs in your friends' public playlists that you haven't liked, four from each friend at most
    async load({ token, me, friends }) {
      const out = [];
      for (const f of friends.slice(0, 10)) {
        try {
          const lists = (await fetchUserPublicPlaylists(token, f.id)).filter((p) => p?.owner?.id === f.id).slice(0, 3);
          for (const p of lists) {
            const page = await fetchPlaylistItemsPage(token, playlistItemsUrl(p.id, 'limit=50'));
            (page.items || []).forEach((i) => { const t = i?.track; if (t?.id && t.uri?.startsWith('spotify:track:')) out.push({ ...t, friend: { id: f.id, name: f.name || f.display_name || f.id }, playlist: p.name, addedBy: i.added_by?.id }); });
            await pause();
          }
        } catch (err) { if (err?.message === 'RATE_LIMITED') throw err; }
      }
      const fresh = await unliked(token, uniqueBy(out.filter((t) => t.addedBy !== me), (t) => t.id));
      const perFriend = new Map();
      return fresh.sort(() => Math.random() - 0.5).filter((t) => { const n = perFriend.get(t.friend.id) || 0; perFriend.set(t.friend.id, n + 1); return n < 4; }).slice(0, 20);
    }
  }
];
