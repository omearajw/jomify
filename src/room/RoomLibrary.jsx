import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { createPlaylist, uploadPlaylistCoverImage, playContext } from '../services/spotify/api';
import { playOn } from '../services/spotify/playbackController';
import { getRecentlyPlayed, lastPlayedByContext } from '../services/recentlyPlayed';
import { buildFolderTree, byOrder, getUnfolderedItems, isDescendant } from '../utils/library';
import { SORT_OPTIONS, sortItems, ownerOf } from '../views/Library/libraryOrder';
import { artUrl } from '../utils/images';
import { isPile } from '../utils/unaddedSync';
import { toast } from '../store/toastStore';
import PlaylistFormDialog from '../components/PlaylistFormDialog';
import FolderFormDialog from '../components/FolderFormDialog';
import { ITEM_DRAG_TYPE } from './LibraryTree';

const ImportFoldersDialog = lazy(() => import('../components/ImportFoldersDialog'));

// The library page on the room's language (DESIGN.md §6, 14 Oct): the whole library on one
// scroll, as covers. Folders are sections with mono headings, not tiles, so everything is in
// view at once; the loose playlists, albums, artists and "Made for you" follow. Covers are bare
// squares with a name under them and the white Play disc on hover; a cover dragged onto a
// section's heading moves there, onto "Playlists" comes out of any folder. Sort, filter and
// size are words on one hairline.

const SIZES = { small: 112, medium: 150, large: 196 };
const COLLAPSED_KEY = 'jomify_library_collapsed';
const readCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch { return new Set(); } };
const FILTER_WORDS = [{ id: 'all', label: 'All' }, { id: 'playlists', label: 'Playlists' }, { id: 'albums', label: 'Albums' }, { id: 'artists', label: 'Artists' }];
const hasType = (dt, t) => Array.from(dt?.types || []).includes(t);

function Tile({ item, size, lit, selected, over, onOpen, onPlay, onMenu, onSelect, drag }) {
  const round = item.type === 'artist';
  return (
    <div
      data-tile={item.id}
      role="button"
      tabIndex={0}
      onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? onSelect(e) : onOpen())}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onContextMenu={onMenu}
      {...drag}
      className={`group relative min-w-0 cursor-pointer ${selected ? 'opacity-100' : ''}`}
      style={{ boxShadow: over === 'before' ? '-10px 0 0 -9px var(--room-paper)' : over === 'after' ? '10px 0 0 -9px var(--room-paper)' : undefined }}
    >
      <div className={`relative aspect-square w-full overflow-hidden bg-white/5 ${round ? 'rounded-full' : 'rounded-[4px]'} ${selected ? 'ring-1 ring-[var(--room-paper)]' : ''}`}>
        {item.images?.[0]?.url && <img src={artUrl(item.images, size * 2)} alt="" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}
        {onPlay && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label={`Play ${item.name}`} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" style={{ transitionDuration: 'var(--room-mid)' }}>
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </button>
        )}
      </div>
      <p className={`mt-2 truncate text-[13px] ${lit ? 'font-semibold text-[var(--room-paper)]' : 'font-medium text-[var(--room-paper)]/90'}`}>{item.name}</p>
      <p className="room-mono mt-0.5 truncate text-[var(--room-faint)]">{item.type === 'artist' ? 'Artist' : ownerOf(item)}</p>
    </div>
  );
}

const Word = ({ lit: on, onClick, children }) => <button type="button" onClick={onClick} aria-pressed={on || undefined} className="ui-word">{children}</button>;

// A section's heading: a click folds the section; a drop on it moves things in; a folder's
// heading also drags, to reorder among its siblings. `over` is 'into', 'before' or 'after'.
const Heading = ({ id, children, count, over, drop, drag, indent = 0, first = false, open = true, onToggle }) => (
  <p
    data-section={id}
    className={`room-mono mb-3 flex cursor-pointer select-none items-center justify-between border-b pb-2 transition-colors ${first ? 'mt-0' : 'mt-9'} ${over === 'into' ? 'border-[var(--room-paper)] text-[var(--room-paper)]' : 'border-[var(--room-hair)] text-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}
    style={{ marginLeft: indent * 16, transitionDuration: 'var(--room-mid)', boxShadow: over === 'before' ? 'inset 0 1px 0 var(--room-paper)' : over === 'after' ? 'inset 0 -1px 0 var(--room-paper)' : undefined }}
    onClick={onToggle}
    role="button"
    aria-expanded={open}
    {...drag}
    {...drop}
  >
    <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none', transitionDuration: 'var(--room-mid)' }}>›</span>{children}</span>{count ? <span>{count}</span> : null}
  </p>
);

export default function RoomLibrary() {
  const {
    token, profile, playlists: everyPlaylist, albums, followedArtists, customFolders, pinnedItems, currentView, activePlaylistId, currentAlbumId, currentArtistId, activeFolderId, setActiveFolderId,
    librarySort, setLibrarySort, libraryFilter, setLibraryFilter, libraryGridSize, setLibraryGridSize,
    navigateToPlaylist, navigateToAlbum, navigateToArtist, setContextMenu, addPlaylistToFolder, removePlaylistFromFolder, moveFolder, createFolder, setPlaylists, reorderFolders, reorderPlaylistInFolder
  } = useSlice(useUserStore, [
    'token', 'profile', 'playlists', 'albums', 'followedArtists', 'customFolders', 'pinnedItems', 'currentView', 'activePlaylistId', 'currentAlbumId', 'currentArtistId', 'activeFolderId', 'setActiveFolderId',
    'librarySort', 'setLibrarySort', 'libraryFilter', 'setLibraryFilter', 'libraryGridSize', 'setLibraryGridSize',
    'navigateToPlaylist', 'navigateToAlbum', 'navigateToArtist', 'setContextMenu', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'moveFolder', 'createFolder', 'setPlaylists', 'reorderFolders', 'reorderPlaylistInFolder'
  ]);
  const playlists = useMemo(() => everyPlaylist.filter((p) => !isPile(p)), [everyPlaylist]);
  const sort = SORT_OPTIONS.some((o) => o.id === librarySort) ? librarySort : 'spotify';
  const filter = libraryFilter === 'folders' ? 'all' : (libraryFilter || 'all');
  const size = SIZES[libraryGridSize] || SIZES.medium;
  const show = (kind) => filter === 'all' || filter === kind;

  // Recently played, for that order; fetched when it is chosen
  const [lastPlayed, setLastPlayed] = useState(null);
  useEffect(() => {
    if (sort !== 'recent' || !token) return undefined;
    let cancelled = false;
    getRecentlyPlayed(token, profile?.id || '').then((items) => { if (!cancelled) setLastPlayed(lastPlayedByContext(items)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sort, token, profile?.id]);

  const itemsById = useMemo(() => new Map([...playlists, ...(albums || [])].map((i) => [i.id, i])), [playlists, albums]);
  const byParent = useMemo(() => {
    const map = new Map();
    for (const f of customFolders) { const k = f.parentId ?? null; if (!map.has(k)) map.set(k, []); map.get(k).push(f); }
    for (const list of map.values()) list.sort(byOrder);
    return map;
  }, [customFolders]);
  const roots = useMemo(() => buildFolderTree(customFolders).roots, [customFolders]);
  const { playlists: loosePlaylists, albums: looseAlbums } = useMemo(() => getUnfolderedItems(playlists, albums || [], customFolders), [playlists, albums, customFolders]);
  const madeForYou = loosePlaylists.filter((p) => p.owner?.id === 'spotify');
  const loose = loosePlaylists.filter((p) => p.owner?.id !== 'spotify');
  const order = (items) => sortItems(items, sort, lastPlayed);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleSection = (id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...n])); } catch { /* fine */ } return n; });

  // several at once: Cmd/Shift-click, then one drag moves them all
  const [selected, setSelected] = useState(() => new Set());
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  useEffect(() => {
    if (!selected.size) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setSelected(new Set()); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected.size]);

  // drag: the same payload the tree uses, so a cover can go to the tree and a tree row here.
  // What is being dragged is kept in a ref, since the browser hides a drag's data until it drops.
  const [over, setOver] = useState(null);
  const dragRef = useRef(null);
  const startDrag = (e, payload) => { dragRef.current = payload; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(payload)); e.dataTransfer.setData('text/plain', payload.id); };
  const endDrag = () => { dragRef.current = null; setOver(null); };
  const dragOf = (item, parentFolderId) => ({
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); startDrag(e, { type: item.type === 'album' ? 'album' : 'playlist', id: item.id, ids: selected.has(item.id) ? [...selected] : [item.id], parentFolderId: parentFolderId ?? null }); },
    onDragEnd: endDrag
  });
  const dragOfFolder = (folder) => ({
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); startDrag(e, { type: 'folder', id: folder.id, parentFolderId: folder.parentId ?? null }); },
    onDragEnd: endDrag
  });
  const itemIn = (dt) => { try { return JSON.parse(dt.getData(ITEM_DRAG_TYPE) || 'null'); } catch { return null; } };
  const dragged = () => dragRef.current;
  const setOverTo = (id, pos) => setOver((o) => (o && o.id === id && o.pos === pos ? o : { id, pos }));
  const halfY = (e) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY - r.top < r.height / 2 ? 'before' : 'after'; };
  const halfX = (e) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientX - r.left < r.width / 2 ? 'before' : 'after'; };
  // The store's reorder lands the dragged id at the index its drop id had before the removal;
  // to land on a chosen side, hand over the id at the wanted final index (as the tree does)
  const placeInFolder = (folderId, dragId, dropId, side) => {
    // fresh from the store: the cover may have joined this folder a moment ago in the same drop
    const ids = useUserStore.getState().customFolders.find((f) => f.id === folderId)?.playlistIds || [];
    const from = ids.indexOf(dragId); const to = ids.indexOf(dropId);
    if (from === -1 || to === -1) return;
    let want = side === 'before' ? to : to + 1;
    if (from < want) want -= 1;
    if (want === from) return;
    reorderPlaylistInFolder(folderId, dragId, ids[want]);
  };
  // a section's heading: things dropped on it go in; a sibling folder dragged over it lands
  // before or after by the half it is over; a folder from elsewhere goes inside
  const dropOn = (folderId) => ({
    onDragOver: (e) => {
      // an event handler, not render: the ref is read when the pointer moves
      // eslint-disable-next-line react-hooks/refs
      const d = dragged();
      if (!d && !hasType(e.dataTransfer, ITEM_DRAG_TYPE)) return;
      if (d?.type === 'folder' && folderId && (folderId === d.id || isDescendant(customFolders, folderId, d.id))) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const folder = folderId ? customFolders.find((f) => f.id === folderId) : null;
      const sibling = d?.type === 'folder' && folder && (d.parentFolderId ?? null) === (folder.parentId ?? null);
      setOverTo(folderId || 'out', sibling ? halfY(e) : 'into');
    },
    onDragLeave: () => setOver((o) => (o && o.id === (folderId || 'out') ? null : o)),
    onDrop: (e) => {
      e.preventDefault(); setOver(null);
      const d = dragged() || itemIn(e.dataTransfer);
      if (!d) return;
      if (d.type === 'folder') {
        if (folderId && (folderId === d.id || isDescendant(customFolders, folderId, d.id))) return;
        const folder = folderId ? customFolders.find((f) => f.id === folderId) : null;
        if (folder && (d.parentFolderId ?? null) === (folder.parentId ?? null)) reorderFolders(d.id, folderId, halfY(e));
        else moveFolder(d.id, folderId || null);
        return;
      }
      for (const id of d.ids || [d.id]) {
        if (folderId) { if (d.parentFolderId !== folderId) addPlaylistToFolder(folderId, id); }
        else if (d.parentFolderId) removePlaylistFromFolder(d.parentFolderId, id);
      }
      setSelected(new Set());
    }
  });
  // a cover inside a folder: a cover dragged over it lands on the half it is over, whether it
  // came from this folder (a reorder) or another (it joins here, at that place, in one drag)
  const tileTarget = (item, parentFolderId) => ({
    onDragOver: (e) => {
      const d = dragged();
      if (!d || d.type === 'folder' || !parentFolderId || d.id === item.id) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
      setOverTo(item.id, halfX(e));
    },
    onDragLeave: () => setOver((o) => (o && o.id === item.id ? null : o)),
    onDrop: (e) => {
      const d = dragged();
      if (!d || d.type === 'folder' || !parentFolderId || d.id === item.id) return;
      e.preventDefault(); e.stopPropagation(); setOver(null);
      const side = halfX(e);
      for (const id of d.ids || [d.id]) {
        if (d.parentFolderId !== parentFolderId) addPlaylistToFolder(parentFolderId, id);
        placeInFolder(parentFolderId, id, item.id, side);
      }
      setSelected(new Set());
    }
  });

  const lit = (item) => (item.type === 'album' ? currentView === 'album' && currentAlbumId === item.id : item.type === 'artist' ? currentView === 'artist' && currentArtistId === item.id : currentView === 'playlist' && activePlaylistId === item.id);
  const open = (item) => { if (item.type === 'album') navigateToAlbum(item.id); else if (item.type === 'artist') navigateToArtist(item.id); else navigateToPlaylist(item.id); };
  const play = (item) => { if (!token) return; playOn((deviceId) => playContext(token, deviceId, `spotify:${item.type === 'album' ? 'album' : item.type === 'artist' ? 'artist' : 'playlist'}:${item.id}`)); };
  const menu = (item, parentFolderId) => (e) => {
    e.preventDefault();
    if (item.type === 'artist') setContextMenu({ type: 'artist', artistId: item.id, artist: item, x: e.pageX, y: e.pageY });
    else setContextMenu({ type: item.type === 'album' ? 'album' : 'playlist', playlistId: item.type === 'album' ? null : item.id, albumId: item.type === 'album' ? item.id : null, parentFolderId: parentFolderId ?? null, x: e.pageX, y: e.pageY });
  };
  const tiles = (items, parentFolderId = null) => (
    <div className="grid gap-x-5 gap-y-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
      {items.map((item) => (
        <Tile key={`${item.type || 'playlist'}-${item.id}`} item={item} size={size} lit={lit(item)} selected={selected.has(item.id)} over={over?.id === item.id ? over.pos : undefined} onOpen={() => open(item)} onPlay={() => play(item)} onMenu={menu(item, parentFolderId)} onSelect={() => toggleSelect(item.id)} drag={item.type === 'artist' ? {} : { ...dragOf(item, parentFolderId), ...tileTarget(item, parentFolderId) }} />
      ))}
    </div>
  );

  // a folder section: its heading, its covers, then its sub-folders as sub-sections
  const folderSection = (folder, depth, path, first = false) => {
    const items = order((folder.playlistIds || []).map((id) => itemsById.get(id)).filter(Boolean).filter((i) => (i.type === 'album' ? show('albums') : show('playlists'))));
    const kids = byParent.get(folder.id) || [];
    return (
      <div key={folder.id}>
        <Heading id={`folder:${folder.id}`} count={items.length} over={over?.id === folder.id ? over.pos : undefined} drop={dropOn(folder.id)} drag={dragOfFolder(folder)} indent={depth} first={first} open={!collapsed.has(folder.id)} onToggle={() => toggleSection(folder.id)}>{path.join(' › ')}</Heading>
        {!collapsed.has(folder.id) && (
          <>
            {/* the whole section takes a drop, not only its heading: a cover from another
                folder dropped anywhere among these joins them */}
            <div style={{ marginLeft: depth * 16 }} {...dropOn(folder.id)}>
              {items.length ? tiles(items, folder.id) : <p className="py-4 text-[13px] text-[var(--room-faint)]">Nothing in here yet. Drop covers here.</p>}
            </div>
            {kids.map((k) => folderSection(k, depth + 1, [...path, k.name]))}
          </>
        )}
      </div>
    );
  };

  // one folder alone, when a pinned folder on Home or the tree asked for it
  const only = activeFolderId ? customFolders.find((f) => f.id === activeFolderId) : null;

  const [playlistDialog, setPlaylistDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const handleCreatePlaylist = async ({ name, description, imageFile, isPublic = false, collaborative = false }) => {
    if (!token || !profile?.id) return;
    setCreating(true);
    try {
      const made = await createPlaylist(token, profile.id, { name, description, public: isPublic, collaborative });
      if (imageFile) {
        try { await uploadPlaylistCoverImage(token, made.id, imageFile); }
        catch (err) { console.warn('Playlist created but cover image upload failed:', err); toast(`Created "${name}", but the cover didn't upload`, { tone: 'error', duration: 5000 }); }
      }
      setPlaylists([...everyPlaylist, made]);
      setPlaylistDialog(false);
      navigateToPlaylist(made.id);
    } catch (err) {
      console.error('Failed to create playlist:', err);
      toast(`Couldn't create "${name}"`, { tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const pinnedIds = new Set((pinnedItems || []).map((p) => p.id));

  return (
    <div className="relative min-h-full pb-12" style={{ fontFamily: 'var(--font-room)' }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--room-hair)] pb-3">
        {SORT_OPTIONS.map((o) => <Word key={o.id} lit={sort === o.id} onClick={() => setLibrarySort(o.id)}>{o.label}</Word>)}
        <span className="mx-1 h-3 w-px bg-[var(--room-hair)]" aria-hidden="true" />
        {FILTER_WORDS.map((f) => <Word key={f.id} lit={filter === f.id} onClick={() => setLibraryFilter(f.id)}>{f.label}</Word>)}
        <span className="mx-1 h-3 w-px bg-[var(--room-hair)]" aria-hidden="true" />
        {['small', 'medium', 'large'].map((id) => <Word key={id} lit={(libraryGridSize || 'medium') === id} onClick={() => setLibraryGridSize(id)}>{id[0].toUpperCase()}</Word>)}
        <span className="ml-auto flex items-center gap-5">
          <Word onClick={() => setPlaylistDialog(true)}>New playlist</Word>
          <Word onClick={() => setFolderDialog(true)}>New folder</Word>
          <Word onClick={() => setImportOpen(true)}>Import from Spotify</Word>
        </span>
      </div>

      {only ? (
        <div className="mt-6">
          <button type="button" onClick={() => setActiveFolderId(null)} className="ui-word mb-2">← Everything</button>
          {folderSection(only, 0, [only.name], true)}
        </div>
      ) : (
        <div className="mt-6">
          {roots.map((n, i) => folderSection(n.folder, 0, [n.folder.name], i === 0))}
          {show('playlists') && (
            <>
              <Heading id="playlists" count={loose.length} over={over?.id === 'out' ? 'into' : undefined} drop={dropOn(null)} first={roots.length === 0} open={!collapsed.has('playlists')} onToggle={() => toggleSection('playlists')}>{over?.id === 'out' ? 'Out of any folder' : 'Playlists'}</Heading>
              {!collapsed.has('playlists') && <div {...dropOn(null)}>{loose.length ? tiles(order(loose)) : <p className="py-4 text-[13px] text-[var(--room-faint)]">Every playlist is in a folder. Drop one here to take it out.</p>}</div>}
            </>
          )}
          {show('albums') && looseAlbums.length > 0 && (
            <>
              <Heading id="albums" count={looseAlbums.length} open={!collapsed.has('albums')} onToggle={() => toggleSection('albums')}>Albums</Heading>
              {!collapsed.has('albums') && tiles(order(looseAlbums.map((a) => ({ ...a, type: 'album' }))))}
            </>
          )}
          {show('artists') && (followedArtists || []).length > 0 && (
            <>
              <Heading id="artists" count={followedArtists.length} open={!collapsed.has('artists')} onToggle={() => toggleSection('artists')}>Artists</Heading>
              {!collapsed.has('artists') && tiles(order(followedArtists.map((a) => ({ ...a, type: 'artist' }))))}
            </>
          )}
          {show('playlists') && madeForYou.length > 0 && (
            <>
              <Heading id="made-for-you" count={madeForYou.length} open={!collapsed.has('made-for-you')} onToggle={() => toggleSection('made-for-you')}>Made for you</Heading>
              {!collapsed.has('made-for-you') && <>
                <p className="mb-4 text-[13px] text-[var(--room-faint)]">Spotify's own playlists you've saved. Spotify's API doesn't let Jomify open these; a tile opens them in Spotify.</p>
                <div className="opacity-60">{tiles(madeForYou)}</div>
              </>}
            </>
          )}
          {pinnedIds.size === 0 && loose.length === 0 && roots.length === 0 && <p className="mt-10 text-[13px] text-[var(--room-faint)]">Nothing in your library yet.</p>}
        </div>
      )}

      <PlaylistFormDialog open={playlistDialog} title="New playlist" submitLabel="Create" onSubmit={handleCreatePlaylist} onCancel={() => setPlaylistDialog(false)} isSubmitting={creating} />
      <FolderFormDialog open={folderDialog} title="New folder" submitLabel="Create" onSubmit={({ name }) => { createFolder(name, [], null); setFolderDialog(false); }} onCancel={() => setFolderDialog(false)} />
      {importOpen && <Suspense fallback={null}><ImportFoldersDialog open onClose={() => setImportOpen(false)} /></Suspense>}
    </div>
  );
}
