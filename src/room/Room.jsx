import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { useSlice } from '../store/selectors';
import { togglePlay, next as nextTrack, previous as previousTrack } from '../services/spotify/playbackController';
import { artUrl } from '../utils/images';
import Rail from './Rail';
import Layer from './Layer';
import QueueColumn from './QueueColumn';
import LibraryTree from './LibraryTree';
import { useRoomStore } from './roomStore';
import SevensColumn from './SevensColumn';
import PartyColumn from './PartyColumn';

const ZenMode = lazy(() => import('../views/ZenMode/ZenMode'));
// the room's tempo for the parts that travel (kept here too: ZenMode is lazy)
const ROOM_LAYOUT = { layout: { duration: 1.1, ease: [0.2, 0.75, 0.2, 1] } };
const RoomPlaylist = lazy(() => import('./RoomPlaylist'));
const RoomLikedSongs = lazy(() => import('./RoomLikedSongs'));
const RoomLibrary = lazy(() => import('./RoomLibrary'));
const RoomSearch = lazy(() => import('./RoomSearch'));

// The room (DESIGN.md §4–5): the now-playing room is the app's base and resting state. It is
// Zen with its chrome on: the same stage, light and glass lyrics, with the queue column, the
// controls, the rail at the left edge and the layer that slides over it. Zen is this room with
// the chrome faded. Whatever the app is showing (the library, a playlist, a mode) lives inside
// the layer.

// Every layer is a list on the left and the open thing on the right; half is the list alone.
// `list` says which list: the library tree, or the Sevens. Which views are a list's own (open
// at half) and which are an open thing (take the layer to full):
const LIST_OF_VIEW = { home: 'library', library: 'library', browse: 'library', album: 'library', artist: 'library', 'liked-songs': 'library', friends: 'library', user: 'library', lyrics: 'library', sevens: 'sevens', party: 'party' };
const OPEN_VIEWS = new Set(['playlist', 'browse', 'album', 'artist', 'liked-songs', 'friends', 'user', 'lyrics']);
// what Back steps through: the open things, and the library page itself
const BACK_VIEWS = new Set([...OPEN_VIEWS, 'library']);
// a list's own page (set-up, the host view): the column opens at half, the page is there at full
const PAGE_VIEWS = new Set(['sevens', 'party']);
// Unadded has no column yet, so it still takes the layer full as a mode
const MODE_VIEWS = new Set(['unadded']);
const LISTS = { library: LibraryTree, sevens: SevensColumn, party: PartyColumn };

export default function Room({ children, header }) {
  const { currentView, setCurrentView, isZenMode, setAccountOpen, activePlaylistId, currentAlbumId, currentArtistId, sevens, viewHistory, playlists, albums, followedArtists } = useSlice(useUserStore, ['currentView', 'setCurrentView', 'isZenMode', 'setAccountOpen', 'activePlaylistId', 'currentAlbumId', 'currentArtistId', 'sevens', 'viewHistory', 'playlists', 'albums', 'followedArtists']);
  // the open playlist gets the room's own surface; a Seven keeps its workspace, and everything
  // else is the app's page as it is
  const roomPlaylist = currentView === 'playlist' && !sevens.some((x) => x.playlistId === activePlaylistId);
  const { playbackState } = useSlice(usePlayerStore, ['playbackState']);
  const [layer, setLayer] = useState('closed');
  const [list, setList] = useState('library');
  // Back (DESIGN.md §5, 14 Oct): the history of open things only, never of modes, the library
  // page or the layer's size. It sits in the open thing's head and, used from the keyboard,
  // opens the layer at full so what it went back to is seen.
  const backFrame = (() => {
    for (let i = (viewHistory || []).length - 1; i >= 0; i -= 1) if (BACK_VIEWS.has(viewHistory[i].view)) return { frame: viewHistory[i], at: i };
    return null;
  })();
  const nameOf = (f) => {
    if (!f) return null;
    if (f.view === 'playlist') return playlists.find((p) => p.id === f.playlistId)?.name || 'Playlist';
    if (f.view === 'album') return (albums || []).find((a) => a.id === f.albumId)?.name || 'Album';
    if (f.view === 'artist') return (followedArtists || []).find((a) => a.id === f.artistId)?.name || 'Artist';
    return { browse: 'Search', 'liked-songs': 'Liked Songs', friends: 'Friends', user: 'Profile', lyrics: 'Lyrics', library: 'Library' }[f.view] || 'Back';
  };
  const backOverride = useRoomStore((s) => s.back);
  const pageSuffix = useRoomStore((s) => s.pageSuffix);
  const goBackInRoom = useCallback(() => {
    const step = useRoomStore.getState().back;
    if (step) { step.go(); return; }
    const h = useUserStore.getState().viewHistory || [];
    let at = -1;
    for (let i = h.length - 1; i >= 0; i -= 1) if (BACK_VIEWS.has(h[i].view)) { at = i; break; }
    if (at === -1) return;
    const prev = h[at];
    useUserStore.setState({ viewHistory: h.slice(0, at), currentView: prev.view, activePlaylistId: prev.playlistId, currentArtistId: prev.artistId, currentAlbumId: prev.albumId, activeFolderId: prev.folderId, currentUserId: prev.userId ?? null });
    setLayer('full');
  }, []);
  // where the layer was when it was last put away, so the edge brings it back there
  const lastOpen = useRef('half');
  const close = useCallback(() => { setLayer((l) => { if (l !== 'closed') lastOpen.current = l; return 'closed'; }); }, []);
  // a pick in a column opens its thing on the right, even when it is already the current view
  const expand = useCallback(() => setLayer('full'), []);
  // /: closed → the list at half; half → full; full stays full ("more"). Escape is "less": full →
  // half, half → closed; the room click closes in one.
  const more = useCallback(() => setLayer((l) => (l === 'closed' ? 'half' : 'full')), []);
  const less = useCallback(() => setLayer((l) => { if (l === 'full') return 'half'; if (l === 'half') lastOpen.current = 'half'; return 'closed'; }), []);
  const open = useCallback(() => { setLayer((l) => (l === 'closed' ? (MODE_VIEWS.has(useUserStore.getState().currentView) ? 'full' : lastOpen.current) : l)); }, []);

  // a change of view: an open thing takes the layer to full, a list's own view opens it at half
  // if it is closed, and a view that belongs to a list switches the left column to that list (a
  // playlist belongs to whichever list opened it). Settled during render, so the room never
  // paints a frame with the old size.
  const [seenView, setSeenView] = useState(currentView);
  if (seenView !== currentView) {
    setSeenView(currentView);
    if (LIST_OF_VIEW[currentView]) setList(LIST_OF_VIEW[currentView]);
    if (MODE_VIEWS.has(currentView) || OPEN_VIEWS.has(currentView)) setLayer('full');
    else if (LIST_OF_VIEW[currentView] && layer === 'closed') setLayer('half');
  }

  // what the rail should show lit: the list on the left, or the mode, while the layer is open
  const railOf = (view, l) => (MODE_VIEWS.has(view) ? view : l === 'library' && view === 'browse' ? 'browse' : l);

  const pick = useCallback((id) => {
    if (id === 'account') { setAccountOpen(true); return; }
    if (railOf(currentView, list) === id && layer !== 'closed') { close(); return; }
    if (PAGE_VIEWS.has(id)) {
      // the list at half; its page (set-up, the host view) is a pick in the column
      setList(id);
      if (currentView !== id && !(currentView === 'playlist' && list === id)) setCurrentView(id);
      setLayer((l) => (l === 'closed' ? 'half' : l));
      return;
    }
    if (id === 'browse') {
      // Search: the tree's field is the box (DESIGN.md §6), so the pick opens search on the
      // right and puts the cursor in the field
      setList('library');
      if (currentView !== 'browse') setCurrentView('browse');
      setLayer('full');
      requestAnimationFrame(() => document.querySelector('[data-room-search]')?.focus());
      return;
    }
    if (currentView !== id) setCurrentView(id);
    else setLayer(MODE_VIEWS.has(id) ? 'full' : 'half');
  }, [currentView, layer, list, setCurrentView, setAccountOpen, close]);

  // A click on the room's own ground (not a control on it) puts the layer away: the thing you
  // want is already there, so touching it brings it forward. Escape does the same, and / opens
  // the layer with the search field ready, the first job of the library.
  const onRoomPointerDown = (e) => {
    if (layer === 'closed' || e.button !== 0) return;
    if (e.target.closest('button, input, a, [role="slider"], [role="button"], [data-control]')) return;
    close();
  };
  useEffect(() => {
    const typing = (el) => Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    // a menu or a dialog on top takes Escape for itself; the layer steps only when nothing is over it
    const covered = () => Boolean(document.querySelector('[role="menu"], [role="dialog"]'));
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && e.altKey && !typing(e.target)) { e.preventDefault(); e.stopPropagation(); goBackInRoom(); return; }
      if (e.key === 'Escape' && covered()) return;
      if (e.key === 'Escape' && !typing(e.target) && !document.fullscreenElement && !useUserStore.getState().isZenMode) less();
      if (e.key === 'Escape' && typing(e.target) && e.target.hasAttribute('data-room-search')) { e.target.blur(); less(); }
      // / opens the list of whatever you are in, at half, its first job ready; a second / pulls
      // it to full (the library's search field handles its own second /)
      if (e.key === '/' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !typing(e.target) && !covered()) {
        e.preventDefault();
        if (MODE_VIEWS.has(useUserStore.getState().currentView)) { setCurrentView('library'); setList('library'); }
        more();
        requestAnimationFrame(() => document.querySelector('[data-room-search]')?.focus());
      }
    };
    // capture phase: Zen's own Escape listener runs after this and turns Zen off, so a bubbling
    // listener would see Zen as already gone and take a second step
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [less, more, setCurrentView, goBackInRoom]);

  const track = playbackState?.track_window?.current_track;
  const paused = playbackState ? playbackState.paused : true;
  const full = layer === 'full';
  const active = layer === 'closed' ? null : railOf(currentView, list);
  const List = MODE_VIEWS.has(currentView) ? null : LISTS[list];

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--room-ink)] text-[var(--room-paper)]" style={{ fontFamily: 'var(--font-room)' }}>
      <div className="absolute inset-0" onPointerDown={onRoomPointerDown}>
        <Suspense fallback={null}>
          <ZenMode inRoom mode={isZenMode ? 'zen' : 'room'} roomLayout={layer === 'closed' ? 'rest' : layer} aside={<QueueColumn />} />
        </Suspense>
      </div>

      {/* The strip the room keeps when the layer has the screen. Its art, song, controls and
          queue share identities with the room's (ZenMode.jsx, layoutId), so they travel here from
          their places in the room rather than fading; it mounts only at full so its copies lead. */}
      {full && (
        <div className="absolute right-0 top-0 bottom-0 z-10 flex w-[24%] flex-col justify-center gap-5 px-[3%] py-[5%]" onPointerDown={onRoomPointerDown}>
          {track && (
            <div className="flex items-center gap-3">
              <motion.div layoutId="room-art" transition={ROOM_LAYOUT} className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[4px]">
                {track.album?.images?.[0] && <img src={artUrl(track.album.images, 54)} alt="" className="h-full w-full object-cover" draggable="false" />}
              </motion.div>
              <motion.div layoutId="room-song" layout="position" transition={ROOM_LAYOUT} className="min-w-0"><b className="block truncate text-[14px] font-semibold">{track.name}</b><i className="block truncate text-[11px] not-italic text-[var(--room-dim)]">{(track.artists || []).map((a) => a.name).join(', ')}</i></motion.div>
            </div>
          )}
          <motion.div layoutId="room-controls" layout="position" transition={ROOM_LAYOUT} className="flex items-center gap-5">
            <button type="button" onClick={previousTrack} aria-label="Previous" className="text-[var(--room-dim)] hover:text-[var(--room-paper)]"><SkipBack className="h-4 w-4" /></button>
            <button type="button" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} className="grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810]">{paused ? <Play className="ml-0.5 h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}</button>
            <button type="button" onClick={nextTrack} aria-label="Next" className="text-[var(--room-dim)] hover:text-[var(--room-paper)]"><SkipForward className="h-4 w-4" /></button>
          </motion.div>
          <motion.div layoutId="room-queue" layout="position" transition={ROOM_LAYOUT}><QueueColumn compact /></motion.div>
        </div>
      )}

      <Layer state={layer} onState={setLayer} header={header} head={{ back: backOverride ? { name: backOverride.name, go: goBackInRoom } : backFrame ? { name: nameOf(backFrame.frame), go: goBackInRoom } : null, here: OPEN_VIEWS.has(currentView) ? null : 'Library' }} pageKey={`${currentView}:${activePlaylistId || currentAlbumId || currentArtistId || ''}:${pageSuffix}`} tree={List ? <List onExpand={expand} onSlash={more} /> : null}>{roomPlaylist ? <Suspense fallback={null}><RoomPlaylist /></Suspense> : currentView === 'liked-songs' ? <Suspense fallback={null}><RoomLikedSongs /></Suspense> : currentView === 'library' ? <Suspense fallback={null}><RoomLibrary /></Suspense> : currentView === 'browse' ? <Suspense fallback={null}><RoomSearch /></Suspense> : children}</Layer>
      <Rail open={layer !== 'closed'} active={active} onPick={pick} onOpen={open} />
    </div>
  );
}
