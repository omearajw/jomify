import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Heart, Pin, Search } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { buildFolderTree, byOrder, getUnfolderedItems, isDescendant } from '../utils/library';
import { usePlayingFrom } from '../hooks/usePlayingFrom';
import { artUrl } from '../utils/images';
import { addTracksToPlaylist } from '../services/spotify/api';
import { toast } from '../store/toastStore';
import { TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import { noteTarget } from '../utils/recentTargets';
import { useRoomStore } from './roomStore';

// Songs dragged from the open playlist carry one of these; a selection carries them all
export const TRACKS_DRAG_TYPE = 'application/x-jomify-tracks';
// A playlist or album dragged within the tree, to a folder or out of one
export const ITEM_DRAG_TYPE = 'application/x-jomify-item';
const SPRING_MS = 600;
const urisIn = (dt) => {
  try { const many = dt.getData(TRACKS_DRAG_TYPE); if (many) return JSON.parse(many); } catch { /* fall through */ }
  const one = dt.getData(TRACK_DRAG_TYPE) || dt.getData('text/plain');
  return one && one.startsWith('spotify:track:') ? [one] : [];
};
const hasType = (dt, t) => Array.from(dt?.types || []).includes(t);

// The library layer's left column (DESIGN.md §6): the quick "find it" state. The search field at
// its head, then pins, folders, Liked Songs, albums and artists, as rows on hairlines. Typing
// filters the tree; Enter takes the words to Spotify, in the right column. Sorting, filtering,
// grid size and organising belong to the "All playlists" column at full, not here.

const Row = ({ onClick, onContextMenu, lit, dim, indent = 0, art, icon, children, trailing, over, drag }) => (
  <button
    type="button"
    onClick={onClick}
    onContextMenu={onContextMenu}
    aria-current={lit ? 'true' : undefined}
    {...drag}
    className={`group relative flex w-full items-center gap-3 py-[7px] text-left text-[13px] transition-colors ${over === 'into' ? 'bg-white/[0.08] text-[var(--room-paper)]' : ''} ${lit ? 'text-[var(--room-paper)] font-semibold' : dim ? 'text-[var(--room-faint)] hover:text-[var(--room-dim)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}
    style={{ paddingLeft: indent, borderTop: `1px solid ${over === 'before' ? 'var(--room-paper)' : 'var(--room-hair)'}`, boxShadow: over === 'after' ? 'inset 0 -1px 0 var(--room-paper)' : undefined, transitionDuration: 'var(--room-mid)' }}
  >
    {art !== undefined && (
      <span className="h-[26px] w-[26px] shrink-0 overflow-hidden rounded-[3px] bg-white/5">
        {art ? <img src={art} alt="" width="26" height="26" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" /> : null}
      </span>
    )}
    {icon}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {trailing}
  </button>
);

const Label = ({ children, count, trailing, over }) => (
  <p className={`room-mono mb-1 mt-6 flex items-center justify-between text-[var(--room-faint)] first:mt-0 ${over ? 'text-[var(--room-paper)]' : ''}`}><span>{children}</span>{trailing || (count ? <span>{count}</span> : null)}</p>
);

export default function LibraryTree({ onExpand, onSlash }) {
  const {
    playlists, albums, followedArtists, customFolders, pinnedItems, currentView, activePlaylistId, currentAlbumId, currentArtistId,
    navigateToPlaylist, navigateToAlbum, navigateToArtist, setCurrentView, setActiveFolderId, setContextMenu,
    token, profile, addPlaylistToFolder, removePlaylistFromFolder, moveFolder, reorderFolders, reorderPlaylistInFolder
  } = useSlice(useUserStore, [
    'playlists', 'albums', 'followedArtists', 'customFolders', 'pinnedItems', 'currentView', 'activePlaylistId', 'currentAlbumId', 'currentArtistId',
    'navigateToPlaylist', 'navigateToAlbum', 'navigateToArtist', 'setCurrentView', 'setActiveFolderId', 'setContextMenu',
    'token', 'profile', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'moveFolder', 'reorderFolders', 'reorderPlaylistInFolder'
  ]);
  // Drag is the first way to organise (DESIGN.md §6): a song or a selection dropped on a
  // playlist is added; a playlist dropped on a folder moves there, or on "Library" comes out of
  // any folder. Folders spring open under a drag held over them.
  const [over, setOver] = useState(null);
  const springs = useRef(new Map());
  const takesSongs = (item) => item.type !== 'album' && (item.owner?.id === profile?.id || item.collaborative);
  const dropSongs = async (item, dt) => {
    const uris = urisIn(dt);
    if (!token || !uris.length || !takesSongs(item)) return;
    try {
      for (let i = 0; i < uris.length; i += 100) await addTracksToPlaylist(token, item.id, uris.slice(i, i + 100));
      noteTarget(item.id);
      toast(`Added ${uris.length === 1 ? 'the song' : `${uris.length} songs`} to ${item.name}`, { tone: 'success', duration: 1500 });
    } catch (err) {
      console.error(err);
      toast(`Couldn't add to ${item.name}`, { tone: 'error' });
    }
  };
  // What is being dragged, kept here because the browser hides a drag's data until it drops;
  // the types alone say "an item" but not which, and the rules below need to know
  const dragRef = useRef(null);
  const itemIn = (dt) => { try { return JSON.parse(dt.getData(ITEM_DRAG_TYPE) || 'null'); } catch { return null; } };
  const dragged = () => dragRef.current;
  const endDrag = () => { dragRef.current = null; setOver(null); springs.current.forEach(clearTimeout); springs.current.clear(); };
  const startDrag = (e, payload) => { dragRef.current = payload; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(payload)); e.dataTransfer.setData('text/plain', payload.id); };
  const dragOf = (item, parentFolderId) => ({ draggable: true, onDragStart: (e) => startDrag(e, { type: item.type === 'album' ? 'album' : 'playlist', id: item.id, parentFolderId: parentFolderId ?? null }), onDragEnd: endDrag });
  const dragOfFolder = (folder) => ({ draggable: true, onDragStart: (e) => { e.stopPropagation(); startDrag(e, { type: 'folder', id: folder.id, parentFolderId: folder.parentId ?? null }); }, onDragEnd: endDrag });
  // The store's reorder lands the dragged id at the index its drop id had before the removal,
  // whichever side it came from; so to land before or after a row, pick the id at the wanted
  // final index and hand that over.
  const placeInFolder = (folderId, dragId, dropId, side) => {
    const ids = useUserStore.getState().customFolders.find((f) => f.id === folderId)?.playlistIds || [];
    const from = ids.indexOf(dragId); const to = ids.indexOf(dropId);
    if (from === -1 || to === -1) return;
    let want = side === 'before' ? to : to + 1;
    if (from < want) want -= 1;
    if (want === from) return;
    reorderPlaylistInFolder(folderId, dragId, ids[want]);
  };
  // where on a row a drop would land. Beside a sibling the row is two halves, so the line is
  // easy to land; elsewhere the top and bottom thirds go beside and the middle goes inside.
  const halfOf = (e) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY - r.top < r.height / 2 ? 'before' : 'after'; };
  const thirdOf = (e) => { const r = e.currentTarget.getBoundingClientRect(); const y = e.clientY - r.top; return y < r.height * 0.3 ? 'before' : y > r.height * 0.7 ? 'after' : 'into'; };
  const posFor = (e, d, folder) => ((d.parentFolderId ?? null) === (folder.parentId ?? null) ? halfOf(e) : thirdOf(e));
  const setOverTo = (id, pos) => setOver((o) => (o && o.id === id && o.pos === pos ? o : { id, pos }));
  const leave = (id) => setOver((o) => (o && o.id === id ? null : o));

  // A playlist row: songs dropped on it are added; a playlist dragged beside it in the same
  // folder reorders; one dragged in from elsewhere joins its folder, or, on a loose row, leaves
  // its folder
  const itemTarget = (item, parentFolderId = null) => ({
    onDragOver: (e) => {
      const d = dragged();
      if (d && d.type !== 'folder') {
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
        if (d.id === item.id) return;
        // inside a folder the whole row is either half, so the line is easy to land, and a
        // playlist from elsewhere joins this folder at that place in the one drag
        setOverTo(parentFolderId ? item.id : 'out', parentFolderId ? halfOf(e) : 'out');
        return;
      }
      if (d) {
        // a folder over a playlist row: into that row's folder, or out to the top level
        if (parentFolderId && (parentFolderId === d.id || isDescendant(customFolders, parentFolderId, d.id))) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
        setOverTo(parentFolderId || 'out', parentFolderId ? 'into' : 'out');
        return;
      }
      const songs = hasType(e.dataTransfer, TRACK_DRAG_TYPE) || hasType(e.dataTransfer, TRACKS_DRAG_TYPE);
      if (!songs || !takesSongs(item)) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
      setOverTo(item.id, 'into');
    },
    onDragLeave: () => leave(item.id),
    onDrop: (e) => {
      e.preventDefault(); e.stopPropagation(); setOver(null);
      const d = dragged() || itemIn(e.dataTransfer);
      if (d && d.type !== 'folder') {
        if (d.id === item.id) return;
        if (parentFolderId) {
          const side = halfOf(e);
          for (const id of d.ids || [d.id]) { if (d.parentFolderId !== parentFolderId) addPlaylistToFolder(parentFolderId, id); placeInFolder(parentFolderId, id, item.id, side); }
          return;
        }
        if (d.parentFolderId) for (const id of d.ids || [d.id]) removePlaylistFromFolder(d.parentFolderId, id);
        return;
      }
      if (d) {
        if (parentFolderId && (parentFolderId === d.id || isDescendant(customFolders, parentFolderId, d.id))) return;
        moveFolder(d.id, parentFolderId || null);
        return;
      }
      dropSongs(item, e.dataTransfer);
    }
  });
  // A folder row: a playlist dropped on it goes in; a folder dragged beside it reorders, dropped
  // on it goes inside, never into itself or its own subtree. It springs open under a held drag.
  const folderTarget = (folder) => ({
    onDragOver: (e) => {
      const d = dragged();
      if (!d) return;
      const forbidden = d.type === 'folder' && (d.id === folder.id || isDescendant(customFolders, folder.id, d.id));
      if (forbidden) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'none'; leave(folder.id); return; }
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
      const pos = d.type === 'folder' ? posFor(e, d, folder) : 'into';
      setOverTo(folder.id, pos);
      if (pos === 'into' && !springs.current.has(folder.id)) springs.current.set(folder.id, setTimeout(() => { springs.current.delete(folder.id); setOpen((s) => (s.has(folder.id) ? s : new Set([...s, folder.id]))); }, SPRING_MS));
      if (pos !== 'into') { clearTimeout(springs.current.get(folder.id)); springs.current.delete(folder.id); }
    },
    onDragLeave: () => { clearTimeout(springs.current.get(folder.id)); springs.current.delete(folder.id); leave(folder.id); },
    onDrop: (e) => {
      e.preventDefault(); e.stopPropagation(); clearTimeout(springs.current.get(folder.id)); springs.current.delete(folder.id);
      const d = dragged() || itemIn(e.dataTransfer);
      setOver(null);
      if (!d) return;
      if (d.type === 'folder') {
        if (d.id === folder.id || isDescendant(customFolders, folder.id, d.id)) return;
        // from the pointer, not the hover state: the state can lag the drop by a frame
        const pos = posFor(e, d, folder);
        if (pos === 'into') moveFolder(d.id, folder.id); else reorderFolders(d.id, folder.id, pos);
      } else for (const id of d.ids || [d.id]) if (d.parentFolderId !== folder.id) addPlaylistToFolder(folder.id, id);
    }
  });
  // The list itself, under and between the rows: anything from a folder dropped on open ground
  // comes out to the top level
  const outTarget = {
    onDragOver: (e) => { const d = dragged(); if (!d || e.defaultPrevented) return; if (!d.parentFolderId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverTo('out', 'out'); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) leave('out'); },
    onDrop: (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault(); setOver(null);
      const d = dragged() || itemIn(e.dataTransfer);
      if (!d || !d.parentFolderId) return;
      if (d.type === 'folder') moveFolder(d.id, null); else for (const id of d.ids || [d.id]) removePlaylistFromFolder(d.parentFolderId, id);
    }
  };
  const from = usePlayingFrom();
  const [query, setQueryState] = useState('');
  // the one field (DESIGN.md §6): it filters the tree, and when search is open on the right it
  // searches Spotify as you type
  const setSearchQuery = useRoomStore((s) => s.setSearchQuery);
  const setQuery = (v) => { setQueryState(v); setSearchQuery(v); };
  const [open, setOpen] = useState(() => new Set());
  const q = query.trim().toLowerCase();

  const itemsById = useMemo(() => new Map([...playlists, ...(albums || [])].map((i) => [i.id, i])), [playlists, albums]);
  const byParent = useMemo(() => {
    const map = new Map();
    for (const f of customFolders) { const k = f.parentId ?? null; if (!map.has(k)) map.set(k, []); map.get(k).push(f); }
    for (const list of map.values()) list.sort(byOrder);
    return map;
  }, [customFolders]);
  const roots = useMemo(() => buildFolderTree(customFolders).roots, [customFolders]);
  const { playlists: loose, albums: looseAlbums } = useMemo(() => getUnfolderedItems(playlists, albums || [], customFolders), [playlists, albums, customFolders]);
  const hit = (name) => !q || (name || '').toLowerCase().includes(q);

  const openItem = (item) => { if (item.type === 'album') navigateToAlbum(item.id); else navigateToPlaylist(item.id); onExpand?.(); };
  const menuFor = (item, parentFolderId = null) => (e) => {
    e.preventDefault();
    const isAlbum = item.type === 'album';
    setContextMenu({ type: isAlbum ? 'album' : 'playlist', playlistId: isAlbum ? null : item.id, albumId: isAlbum ? item.id : null, parentFolderId, x: e.pageX, y: e.pageY });
  };
  const litItem = (item) => (item.type === 'album' ? currentView === 'album' && currentAlbumId === item.id : currentView === 'playlist' && activePlaylistId === item.id);
  const playing = (item) => from && from.type === (item.type === 'album' ? 'album' : 'playlist') && from.id === item.id;
  const itemRow = (item, indent = 0, parentFolderId = null) => (
    <Row key={item.id} indent={indent} onClick={() => openItem(item)} onContextMenu={menuFor(item, parentFolderId)} lit={litItem(item) || playing(item)} art={item.images?.[0] ? artUrl(item.images, 26) : null}
      over={over?.id === item.id ? over.pos : undefined} drag={{ ...dragOf(item, parentFolderId), ...itemTarget(item, parentFolderId) }}
      trailing={playing(item) ? <span className="room-mono text-[var(--room-faint)]">Playing</span> : null}>
      {item.name}
    </Row>
  );

  // a folder shows its items when open, or when a search finds something inside it
  const folderRows = (folder, depth) => {
    const kids = byParent.get(folder.id) || [];
    const items = (folder.playlistIds || []).map((id) => itemsById.get(id)).filter(Boolean);
    const inside = (f) => (f.playlistIds || []).some((id) => hit(itemsById.get(id)?.name)) || (byParent.get(f.id) || []).some(inside);
    if (q && !hit(folder.name) && !inside(folder)) return null;
    const isOpen = q ? inside(folder) : open.has(folder.id);
    const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n; });
    return (
      <div key={folder.id}>
        <Row indent={depth * 14} onClick={toggle} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'folder', folderId: folder.id, folder, x: e.pageX, y: e.pageY }); }}
          over={over?.id === folder.id ? over.pos : undefined} drag={{ ...dragOfFolder(folder), ...folderTarget(folder) }}
          icon={<ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--room-faint)] transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transitionDuration: 'var(--room-mid)' }} />}
          trailing={<span className="room-mono text-[var(--room-faint)] opacity-0 transition-opacity group-hover:opacity-100">{items.length}</span>}>
          {folder.name}
        </Row>
        {isOpen && (
          <div>
            {kids.map((k) => folderRows(k, depth + 1))}
            {items.filter((i) => hit(i.name)).map((i) => itemRow(i, (depth + 1) * 14 + 4, folder.id))}
          </div>
        )}
      </div>
    );
  };

  const pins = (pinnedItems || []).map((p) => (p.type === 'folder' ? customFolders.find((f) => f.id === p.id) && { ...customFolders.find((f) => f.id === p.id), type: 'folder' } : itemsById.get(p.id))).filter(Boolean).filter((p) => hit(p.name));
  const looseShown = loose.filter((p) => hit(p.name));
  const albumsShown = looseAlbums.filter((a) => hit(a.name));
  const artistsShown = (followedArtists || []).filter((a) => hit(a.name));

  const searchSpotify = () => {
    if (!q) return;
    try { sessionStorage.setItem('jomify_browse_query', query.trim()); } catch { /* fine */ }
    setCurrentView('browse');
    onExpand?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--font-room)' }}>
      {/* With search open on the right the field is Spotify's box and says so: a label above
          it, bigger words, its placeholder changed. Otherwise it finds in the tree. */}
      {currentView === 'browse' && <p className="room-mono mb-2 text-[var(--room-paper)]">Search Spotify</p>}
      <label className={`flex items-center gap-2 border-b pb-3 transition-colors ${currentView === 'browse' ? 'border-[var(--room-paper)]/40 text-[var(--room-paper)]' : 'border-[var(--room-hair)] text-[var(--room-dim)] focus-within:text-[var(--room-paper)]'}`} style={{ transitionDuration: 'var(--room-mid)' }}>
        <Search className="h-4 w-4 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') searchSpotify();
            // a second / (the field empty) asks for the full layer rather than typing a slash
            if (e.key === '/' && !query) { e.preventDefault(); onSlash?.(); return; }
            // Escape clears the words first; a second one reaches the room, which puts the layer away
            if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); }
          }}
          data-room-search
          placeholder={currentView === 'browse' ? 'Songs, artists, albums, playlists' : 'Find, or press Enter to search Spotify'}
          aria-label="Search your library, or Spotify"
          style={{ WebkitUserSelect: 'text', userSelect: 'text', fontSize: currentView === 'browse' ? 16 : 13, transition: 'font-size var(--room-mid) var(--room-ease)' }}
          className="min-w-0 flex-1 bg-transparent text-[var(--room-paper)] outline-none placeholder:text-[var(--room-faint)] [&::-webkit-search-cancel-button]:hidden"
        />
        {q && currentView !== 'browse' && <button type="button" onClick={searchSpotify} className="room-mono shrink-0 text-[var(--room-faint)] hover:text-[var(--room-paper)]">On Spotify ↵</button>}
        {q && currentView === 'browse' && <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="room-mono shrink-0 text-[var(--room-faint)] hover:text-[var(--room-paper)]">Clear</button>}
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 pt-4 [scrollbar-width:thin]" {...outTarget}>
        {pins.length > 0 && <>
          <Label>Pinned</Label>
          {pins.map((p) => (p.type === 'folder'
            ? <Row key={`pin-${p.id}`} onClick={() => { setActiveFolderId(p.id); setCurrentView('library'); onExpand?.(); }} icon={<Pin className="h-3.5 w-3.5 shrink-0 text-[var(--room-faint)]" />}>{p.name}</Row>
            : itemRow(p)))}
        </>}
        <Label over={over?.id === 'out'} trailing={<button type="button" onClick={() => { setActiveFolderId(null); setCurrentView('library'); onExpand?.(); }} aria-current={currentView === 'library' ? 'page' : undefined} className={`transition-colors ${currentView === 'library' ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-paper)]'}`}>{over?.id === 'out' ? 'Out of any folder' : 'All playlists'}</button>}>Library</Label>
        <Row onClick={() => { setCurrentView('liked-songs'); onExpand?.(); }} lit={currentView === 'liked-songs' || from?.type === 'liked'} icon={<Heart className="h-3.5 w-3.5 shrink-0 text-[var(--room-faint)]" />}>Liked Songs</Row>
        {roots.map((n) => folderRows(n.folder, 0))}
        {looseShown.map((p) => itemRow(p))}
        {albumsShown.length > 0 && <>
          <Label count={albumsShown.length}>Albums</Label>
          {albumsShown.map((a) => itemRow({ ...a, type: 'album' }))}
        </>}
        {artistsShown.length > 0 && <>
          <Label count={artistsShown.length}>Artists</Label>
          {artistsShown.map((a) => (
            <Row key={a.id} onClick={() => { navigateToArtist(a.id); onExpand?.(); }} lit={currentView === 'artist' && currentArtistId === a.id} art={a.images?.[0] ? artUrl(a.images, 26) : null}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'artist', artistId: a.id, artist: a, x: e.pageX, y: e.pageY }); }}>{a.name}</Row>
          ))}
        </>}
        {q && !pins.length && !looseShown.length && !albumsShown.length && !artistsShown.length && roots.every((n) => folderRows(n.folder, 0) === null) && (
          <p className="mt-6 text-[13px] text-[var(--room-faint)]">Nothing in your library. Enter searches Spotify.</p>
        )}
      </div>
    </div>
  );
}
