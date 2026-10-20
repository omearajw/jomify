import { useCallback, useRef, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { useRoomStore } from './roomStore';
import { toast } from '../store/toastStore';
import LibraryTree from './LibraryTree';
import SevensColumn from './SevensColumn';
import PartyColumn from './PartyColumn';
import UnaddedColumn from './UnaddedColumn';
import { pileIdOf, useUnaddedStore } from './unadded';

// The room's state, shared by the Mac (Room.jsx: a panel beside the rail) and the phone
// (phone/PhoneRoom.jsx: a sheet from the bottom): which list, how far the layer is open (closed,
// half, full), Back, and what a pick from the rail or the launcher does.

// Every layer is a list on the left and the open thing on the right; half is the list alone.
// `list` says which list: the library tree, or the Sevens. Which views are a list's own (open
// at half) and which are an open thing (take the layer to full):
export const LIST_OF_VIEW = { home: 'library', library: 'library', browse: 'library', album: 'library', artist: 'library', 'liked-songs': 'library', friends: 'library', user: 'library', lyrics: 'library', profile: 'library', sevens: 'sevens', party: 'party', unadded: 'unadded' };
export const OPEN_VIEWS = new Set(['profile', 'playlist', 'browse', 'album', 'artist', 'liked-songs', 'friends', 'user', 'lyrics']);
// what Back steps through: the open things, and the library page itself
export const BACK_VIEWS = new Set([...OPEN_VIEWS, 'library', 'sevens', 'unadded']);
// a list's own page (set-up, the host view): the column opens at half, the page is there at full
export const PAGE_VIEWS = new Set(['sevens', 'party']);
// Unadded has no column yet, so it still takes the layer full as a mode
export const MODE_VIEWS = new Set(['unadded']);
export const LISTS = { library: LibraryTree, sevens: SevensColumn, party: PartyColumn, unadded: UnaddedColumn };

// a mode that takes the layer full; on the phone Unadded is a screen of its own instead
const takesLayerOn = (phone, v) => MODE_VIEWS.has(v) && !(phone && v === 'unadded');

export function useRoomState({ phone = false } = {}) {
  const takesLayer = (v) => takesLayerOn(phone, v);
  const { currentView, setCurrentView, isZenMode, setAccountOpen, activePlaylistId, currentAlbumId, currentArtistId, currentUserId, navSeq, sevens, viewHistory, playlists, albums, followedArtists } = useSlice(useUserStore, ['currentView', 'setCurrentView', 'isZenMode', 'setAccountOpen', 'activePlaylistId', 'currentAlbumId', 'currentArtistId', 'currentUserId', 'navSeq', 'sevens', 'viewHistory', 'playlists', 'albums', 'followedArtists']);
  // the open playlist gets the room's own surface; a Seven keeps its workspace, and everything
  // else is the app's page as it is
  const isSeven = currentView === 'playlist' && sevens.some((x) => x.playlistId === activePlaylistId);
  // Unadded (DESIGN.md §8) is a mode over the pile, the playlist named "unadded songs"
  const pileId = pileIdOf(playlists);
  const suggestionsAttempt = useUnaddedStore((s) => s.suggestionsAttempt);
  const roomPlaylist = currentView === 'playlist' && !isSeven;
  // Opened at an open thing's own address (a shared link, or a reload on an album) the layer is
  // already up on it; opened at / the room is at rest, as before
  const [layer, setLayer] = useState(() => (typeof location !== 'undefined' && location.pathname !== '/' && OPEN_VIEWS.has(useUserStore.getState().currentView) ? 'full' : 'closed'));
  // the list the view belongs to, from the start too (a reload lands on the view's own list)
  const [list, setList] = useState(() => (isSeven ? 'sevens' : LIST_OF_VIEW[currentView] || 'library'));
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
    return { browse: 'Search', 'liked-songs': 'Liked Songs', friends: 'Friends', user: 'Profile', lyrics: 'Lyrics', library: 'Library', sevens: 'Sevens', unadded: 'Unadded', profile: 'Profile' }[f.view] || 'Back';
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
    // on the phone Unadded is its own screen under the sheet, so Back to it puts the sheet down
    setLayer(phone && prev.view === 'unadded' ? 'closed' : 'full');
  }, [phone]);
  // where the layer was when it was last put away, so the edge brings it back there
  const lastOpen = useRef('half');
  const close = useCallback(() => { setLayer((l) => { if (l !== 'closed') lastOpen.current = l; return 'closed'; }); }, []);
  // a pick in a column opens its thing on the right, even when it is already the current view
  const expand = useCallback(() => setLayer('full'), []);
  // /: closed → the list at half; half → full; full stays full ("more"). Escape is "less": full →
  // half, half → closed; the room click closes in one.
  const more = useCallback(() => setLayer((l) => (l === 'closed' ? 'half' : 'full')), []);
  const less = useCallback(() => setLayer((l) => { if (l === 'full') return 'half'; if (l === 'half') lastOpen.current = 'half'; return 'closed'; }), []);
  const open = useCallback(() => { setLayer((l) => (l === 'closed' ? (takesLayerOn(phone, useUserStore.getState().currentView) ? 'full' : lastOpen.current) : l)); }, [phone]);

  // a change of view: an open thing takes the layer to full, a list's own view opens it at half
  // if it is closed, and a view that belongs to a list switches the left column to that list (a
  // playlist belongs to whichever list opened it). Settled during render, so the room never
  // paints a frame with the old size.
  // A Seven is the one exception: it is always a Sevens thing, so it takes the Sevens list even
  // when Back brings it up after the library or search.
  // The key is the open thing itself, not the view's name: artist to artist (or album to album)
  // with the layer put away kept the name and left the layer down (Jack, 20 Oct). navSeq counts
  // the navigations, so asking for the thing already open still raises the layer.
  const openId = { playlist: activePlaylistId, artist: currentArtistId, album: currentAlbumId, user: currentUserId }[currentView];
  const viewKey = `${currentView}:${openId || ''}:${navSeq}`;
  const [seenView, setSeenView] = useState(viewKey);
  if (seenView !== viewKey) {
    setSeenView(viewKey);
    if (isSeven) setList('sevens');
    else if (LIST_OF_VIEW[currentView]) setList(LIST_OF_VIEW[currentView]);
    if (phone && currentView === 'unadded') setLayer('closed');
    else if (takesLayer(currentView) || OPEN_VIEWS.has(currentView)) setLayer('full');
    else if (LIST_OF_VIEW[currentView] && layer === 'closed') setLayer('half');
  }

  // what the rail should show lit: the list on the left, or the mode, while the layer is open
  const railOf = (view, l) => (MODE_VIEWS.has(view) ? view : view === 'profile' ? 'profile' : l === 'library' && view === 'browse' ? 'browse' : l);

  const lit = railOf(currentView, list);
  const pick = useCallback((id) => {
    if (id === 'account') { setAccountOpen(true); return; }
    if (lit === id && layer !== 'closed') { close(); return; }
    if (id === 'unadded' && !pileId) { toast('Make a playlist called "unadded songs" first: that is the pile Unadded works from', { tone: 'info' }); return; }
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
    else setLayer(takesLayerOn(phone, id) ? 'full' : phone && id === 'unadded' ? 'closed' : 'half');
  }, [currentView, layer, list, lit, setCurrentView, setAccountOpen, close, pileId, phone]);

  return {
    currentView, setCurrentView, isZenMode, setAccountOpen, activePlaylistId, currentAlbumId, currentArtistId,
    isSeven, pileId, suggestionsAttempt, roomPlaylist, layer, setLayer, list, setList, backFrame, nameOf, backOverride, pageSuffix,
    goBackInRoom, close, expand, more, less, open, lit, pick
  };
}
