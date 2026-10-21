import { create } from 'zustand';
import { useUserStore } from '../store/userStore';
import { loadAllLikedSongs, likedSongsLoaded } from '../services/likedLibrary';
import { log } from '../services/debugLog';
import { SECTIONS, loadTop } from './sections';

// Discover's sections as they load, outside any page so leaving Discover doesn't stop or repeat
// them. Found sections are kept on this device for the day: Discover is "this week" and costs
// many requests, so it is read once a day, or again on Refresh. The order is cheapest first, so
// the page fills from the top while the heavier ones work.

const ORDER = ['onRepeat', 'usedToLove', 'releasesForYou', 'moreFromTop', 'followedNew', 'newInGenres', 'throwbacks', 'fromFriends', 'dippedInto', 'likedNotFollowed'];
const STORE_KEY = (me) => `jomify_discover:${me}`;
const today = () => new Date().toISOString().slice(0, 10);

// what the page needs of each thing, so a day's worth stays small in storage
const slimAlbum = (a) => a && { id: a.id, uri: a.uri, name: a.name, images: a.images, artists: (a.artists || []).map(({ id, name, uri }) => ({ id, name, uri })), album_type: a.album_type, total_tracks: a.total_tracks, release_date: a.release_date };
const slim = (x) => {
  if (!x) return x;
  if (x.type === 'artist' || (x.genres && !x.album)) return { id: x.id, uri: x.uri, name: x.name, images: x.images, liked: x.liked };
  if (x.album) return { id: x.id, uri: x.uri, name: x.name, duration_ms: x.duration_ms, explicit: x.explicit, artists: (x.artists || []).map(({ id, name, uri }) => ({ id, name, uri })), album: slimAlbum(x.album), friend: x.friend, playlist: x.playlist };
  return { ...slimAlbum(x), liked: x.liked, total: x.total };
};

const load = (me) => { try { const v = JSON.parse(localStorage.getItem(STORE_KEY(me)) || 'null'); return v?.day === today() ? v.sections : {}; } catch { return {}; } };
const save = (me, sections) => {
  const done = Object.fromEntries(Object.entries(sections).filter(([, s]) => s.status === 'ready'));
  try { localStorage.setItem(STORE_KEY(me), JSON.stringify({ day: today(), sections: done })); } catch { /* full or blocked */ }
};

export const useDiscoverStore = create((set, get) => ({
  me: null,
  // { [key]: { status: 'idle' | 'loading' | 'ready' | 'failed', items, label } }
  sections: {},
  liked: null, // { have, total } while Liked Songs are read
  running: false,

  // Opens Discover for this account: what today already found, then the rest
  start: async ({ refresh = false } = {}) => {
    const { token, profile, followedArtists, friends } = useUserStore.getState();
    const me = profile?.id;
    if (!token || !me || get().running) return;
    const kept = refresh ? {} : load(me);
    set({ me, running: true, sections: { ...Object.fromEntries(SECTIONS.map((s) => [s.key, kept[s.key] || { status: s.onDemand ? 'idle' : 'loading', items: [] }])) } });
    const put = (key, value) => { set((st) => ({ sections: { ...st.sections, [key]: { ...st.sections[key], ...value } } })); save(me, get().sections); };
    // liked: [] not read yet, null couldn't be read
    const ctx = { token, me, followed: followedArtists || [], friends: friends || [], liked: [], top: null };
    try {
      for (const key of ORDER) {
        if (get().sections[key]?.status === 'ready') continue;
        const section = SECTIONS.find((s) => s.key === key);
        if (section.needsLiked && ctx.liked && !ctx.liked.length) {
          // Liked Songs that won't read fail only the shelves built from them
          try {
            ctx.liked = likedSongsLoaded(me) || await loadAllLikedSongs(token, me, (have, total) => set({ liked: { have, total } }));
          } catch (err) {
            if (err?.message === 'RATE_LIMITED') throw err;
            log('discover', "couldn't read Liked Songs", err?.message || String(err));
            ctx.liked = null;
          } finally {
            set({ liked: null });
          }
        }
        if (section.needsLiked && !ctx.liked) { put(key, { status: 'failed', items: [] }); continue; }
        if (!ctx.top) ctx.top = await loadTop(token);
        await runOne(section, ctx, put);
      }
    } catch (err) {
      // rate limited: what is found is kept, the rest waits for the next visit
      log('discover', 'stopped', err?.message || String(err));
      SECTIONS.forEach((s) => { if (get().sections[s.key]?.status === 'loading') put(s.key, { status: 'failed' }); });
    } finally {
      set({ running: false });
    }
  },

  // A section that waits to be asked (Deep cuts)
  ask: async (key) => {
    const { token, profile, followedArtists, friends } = useUserStore.getState();
    const me = profile?.id;
    const section = SECTIONS.find((s) => s.key === key);
    if (!token || !me || !section || get().sections[key]?.status === 'loading') return;
    const put = (k, value) => { set((st) => ({ sections: { ...st.sections, [k]: { ...st.sections[k], ...value } } })); save(me, get().sections); };
    put(key, { status: 'loading', items: [] });
    try {
      const liked = section.needsLiked ? (likedSongsLoaded(me) || await loadAllLikedSongs(token, me, (have, total) => set({ liked: { have, total } }))) : [];
      set({ liked: null });
      await runOne(section, { token, me, followed: followedArtists || [], friends: friends || [], liked, top: await loadTop(token) }, put);
    } catch (err) {
      log('discover', `${key} stopped`, err?.message || String(err));
      put(key, { status: 'failed' });
    }
  }
}));

async function runOne(section, ctx, put) {
  put(section.key, { status: 'loading' });
  const started = Date.now();
  try {
    const out = await section.load(ctx);
    const items = (Array.isArray(out) ? out : out?.items || []).map(slim);
    put(section.key, { status: 'ready', items, label: (!Array.isArray(out) && out?.label) || null });
    log('discover', section.key, `${items.length} found in ${Date.now() - started} ms`);
  } catch (err) {
    if (err?.message === 'RATE_LIMITED') throw err;
    log('discover', `${section.key} failed`, err?.message || String(err));
    put(section.key, { status: 'failed', items: [] });
  }
}
