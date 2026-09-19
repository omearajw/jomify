import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useUserStore } from '../../store/userStore';
import { fetchUserPlaylists, addTracksToPlaylist, unfollowPlaylist, createPlaylist, uploadPlaylistCoverImage } from '../../services/spotify/api';
import { Heart, Folder, Maximize2, ChevronLeft, ChevronRight, Plus, Minus, Trash2, MoreVertical, FolderPlus, Minimize2, FolderX, FolderInput, FolderOutput, Search, ArrowUpDown, X } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import PlaylistFormDialog from '../../components/PlaylistFormDialog';
import FolderFormDialog from '../../components/FolderFormDialog';
import { getUnfolderedItems, descendantIds, descendantItemIds, folderPath, isDescendant, byOrder } from '../../utils/library';
import { rowButtonProps } from '../../utils/a11y';
import { useSlice } from '../../store/selectors';
import { artUrl } from '../../utils/images';

// Pulls in the LevelDB reader and snappy; only needed once someone opens Import
const ImportFoldersDialog = lazy(() => import('../../components/ImportFoldersDialog'));

// --- VISUAL UPGRADE: Safely Bounded Right-to-Left Fan Stack ---
// Covers come from the whole subtree, so a folder that only holds subfolders still shows art.
// `items` is a Map by id; only the first four resolvable covers are looked up.
const FolderStack = ({ folder, folders, items }) => {
  const coverIds = folders ? descendantItemIds(folders, folder.id) : folder.playlistIds;
  const folderItems = [];
  for (const id of coverIds) {
    const item = items.get(id);
    if (item) folderItems.push(item);
    if (folderItems.length === 4) break;
  }

  if (folderItems.length === 0) {
    return <div className="w-full h-full flex items-center justify-center bg-neutral-800"><Folder className="w-16 h-16 text-neutral-700" /></div>;
  }
  
  return (
    <div className="relative w-full h-full flex items-center overflow-hidden bg-neutral-800/50">
      {folderItems.reverse().map((item, i, arr) => {
        const index = arr.length - 1 - i; 
        const rightOffset = 5 + (index * 14); 
        const scale = 1 - (index * 0.15); 
        return (
          <div 
            key={item.id} 
            className="absolute w-[75%] h-[75%] rounded-md shadow-2xl overflow-hidden bg-neutral-900 border border-white/10 transition-transform duration-500 ease-out group-hover:-translate-y-3"
            style={{ right: `${rightOffset}%`, transform: `scale(${scale})`, zIndex: 10 - index }}
          >
            {item.images?.[0]?.url ? (
              <img src={artUrl(item.images, 160)} draggable="false" loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" alt="" />
            ) : (
              <span className="text-2xl flex items-center justify-center w-full h-full opacity-30">💿</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// These three used to be defined INSIDE Library's render body. That makes them a brand-new
// component type on every render, so React unmounted and remounted the entire grid on every
// state change -- including the setDragOverId that fires during a drag, which cancelled the
// drag and flickered every image. Module scope gives them a stable identity.

function SizingControls({ libraryGridSize, setLibraryGridSize }) {
  const sizeButton = (size, label) => (
    <button
      onClick={() => setLibraryGridSize(size)}
      className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${libraryGridSize === size ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 w-fit shrink-0">
      <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider mr-2">Size</span>
      {sizeButton('small', 'S')}
      {sizeButton('medium', 'M')}
      {sizeButton('large', 'L')}
    </div>
  );
}

function ItemCard({
  item, isSubItem = false, parentFolderId = null,
  dragOverId, onDragStart, onDragOver, onDragLeave, onDragEnd, onDropOnItem,
  onOpenAlbum, onOpenPlaylist, onMenu
}) {
  const isDragTarget = dragOverId === item.id;
  const isAlbum = item.type === 'album';

  return (
    <div
      draggable="true"
      onDragStart={(e) => onDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId })}
      onDragOver={(e) => onDragOver(e, item.id)}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDropOnItem(e, item.id, parentFolderId)}
      onClick={() => (isAlbum ? onOpenAlbum(item.id) : onOpenPlaylist(item.id))}
      onContextMenu={(e) => onMenu(e, item, parentFolderId)}
      className={`p-4 rounded-xl hover:bg-neutral-800 transition-all duration-300 cursor-pointer group shadow-lg flex flex-col h-full relative cursor-grab active:cursor-grabbing ${isDragTarget ? 'ring-2 ring-[#f91362] bg-[var(--brand-mid)]/15 scale-[1.02]' : isSubItem ? 'bg-neutral-800/40 border border-neutral-700/30 hover:border-neutral-500/50' : 'bg-neutral-800/40'}`}
    >
      <button type="button" onClick={(e) => onMenu(e, item, parentFolderId)} className="absolute top-6 right-6 z-10 w-8 h-8 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity backdrop-blur-md">
        <MoreVertical className="w-4 h-4" />
      </button>

      <div className="relative aspect-square w-full mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0 pointer-events-none">
        {item.images?.length > 0 ? <img src={artUrl(item.images, 300)} draggable="false" alt={item.name} loading="lazy" decoding="async" className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" /> : <span className="text-3xl">💿</span>}
      </div>
      <h3 className="font-bold text-sm text-white truncate mb-1 pointer-events-none">{item.name}</h3>
      <p className="text-xs text-neutral-400 truncate mt-auto pointer-events-none">
        {isAlbum ? `Album • ${item.artists?.map(a => a.name).join(', ')}` : `By ${item.owner?.display_name || 'Spotify'}`}
      </p>
    </div>
  );
}

function ManageCard({ item, action, onClick }) {
  return (
    <div onClick={onClick} className={`p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border border-transparent flex flex-col h-full ${action === 'add' ? 'bg-neutral-800/20 hover:border-[#f91362]/50 hover:bg-[var(--brand-mid)]/15' : 'bg-neutral-800/40 hover:border-red-500/50 hover:bg-red-500/10'}`}>
      <div className="relative aspect-square w-full mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0">
        {item.images?.length > 0 ? <img src={artUrl(item.images, 300)} draggable="false" alt={item.name} loading="lazy" decoding="async" className="object-cover w-full h-full opacity-60 group-hover:opacity-100 transition-opacity duration-300" /> : <span className="text-3xl opacity-60 group-hover:opacity-100">💿</span>}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          {action === 'add' ? <Plus className="w-12 h-12 text-brand-gradient" /> : <Minus className="w-12 h-12 text-red-500" />}
        </div>
      </div>
      <h3 className="font-bold text-sm text-white truncate mb-1">{item.name}</h3>
    </div>
  );
}

const subfolderLabel = (count) => (count ? ` · ${count} folder${count === 1 ? '' : 's'}` : '');
const itemLabel = (count) => `${count} item${count === 1 ? '' : 's'}`;

const SORT_OPTIONS = [
  { id: 'spotify', label: 'Spotify order' },
  { id: 'az', label: 'A to Z' },
  { id: 'za', label: 'Z to A' },
  { id: 'owner', label: 'By owner' }
];
const ownerOf = (item) => (item.type === 'album' ? (item.artists?.map(a => a.name).join(', ') || '') : (item.owner?.display_name || ''));
function sortItems(items, mode) {
  if (mode === 'spotify') return items;
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  const sorted = [...items];
  if (mode === 'az') sorted.sort(byName);
  else if (mode === 'za') sorted.sort((a, b) => byName(b, a));
  else if (mode === 'owner') sorted.sort((a, b) => ownerOf(a).localeCompare(ownerOf(b), undefined, { sensitivity: 'base' }) || byName(a, b));
  return sorted;
}
const matches = (text, query) => (text || '').toLowerCase().includes(query);

// Collapsed folder tile. Module scope for the same reason as ItemCard above.
function FolderCard({ folder, ctx }) {
  const { customFolders, itemsById, dragOverId, draggedItem } = ctx;
  const isDragTarget = dragOverId === folder.id;
  const subfolders = ctx.childrenOf(folder.id).length;
  // A folder can't be dropped into itself or anything beneath it
  const forbidden = draggedItem?.type === 'folder'
    && (draggedItem.id === folder.id || isDescendant(customFolders, folder.id, draggedItem.id));
  const invites = !isDragTarget && !forbidden
    && (draggedItem?.type === 'playlist' || draggedItem?.type === 'album' || draggedItem?.type === 'folder');

  return (
    <div
      draggable="true"
      onDragStart={(e) => ctx.handleDragStart(e, { type: 'folder', id: folder.id, parentFolderId: folder.parentId ?? null })}
      onDragOver={(e) => {
        if (forbidden) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; return; }
        ctx.handleDragOver(e, folder.id);
      }}
      onDragLeave={ctx.handleDragLeave}
      onDragEnd={ctx.handleDragEnd}
      onDrop={(e) => { if (forbidden) { e.preventDefault(); return; } ctx.handleDropOnFolder(e, folder.id); }}
      onClick={() => ctx.setIsolatedFolderId(folder.id)}
      {...rowButtonProps(() => ctx.setIsolatedFolderId(folder.id))}
      onContextMenu={(e) => ctx.handleFolderContextMenu(e, folder)}
      className={`p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border relative flex flex-col h-full cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-[var(--brand-mid)]/15 border-[#f91362] scale-[1.02]' : 'bg-neutral-800/40 border-transparent hover:border-neutral-700 hover:bg-neutral-800/80'} ${invites ? 'border-dashed border-[#f91362]/50 bg-[var(--brand-mid)]/10' : ''} ${forbidden ? 'opacity-40' : ''}`}
    >
      <button onClick={(e) => ctx.toggleFolderExpand(e, folder.id)} className="absolute top-4 right-4 z-100 w-8 h-8 bg-black/40 hover:bg-black/80 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors" title="Expand Inline">
        <Maximize2 className="w-4 h-4 text-white transition-transform duration-300" />
      </button>
      <div className="aspect-square w-full mb-4 rounded-md shadow-md shrink-0 pointer-events-none">
        <FolderStack folder={folder} folders={customFolders} items={itemsById} />
      </div>
      <h3 className="font-bold text-sm text-white truncate mb-1 flex items-center pointer-events-none">
        <Folder className="w-4 h-4 mr-2 text-brand-gradient fill-current shrink-0" />
        <span className="truncate">{folder.name}</span>
      </h3>
      <p className="text-xs text-neutral-400 truncate mt-auto pointer-events-none">{itemLabel(folder.playlistIds.length)}{subfolderLabel(subfolders)}</p>
    </div>
  );
}

// Expanded folder: a full-width panel whose grid holds subfolders first, then items. Recursive,
// so an expanded subfolder opens its own panel inside.
function FolderPanel({ folder, ctx }) {
  const { itemsById, expandedFolders, getGridClass, itemCardProps } = ctx;
  const children = ctx.childrenOf(folder.id);

  return (
    <div className="col-span-full bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-6 shadow-inner animate-fade-in mb-4">
      <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
        <div className="flex items-center cursor-pointer group hover:text-green-400 transition-colors" onClick={() => ctx.setIsolatedFolderId(folder.id)}>
          <Folder className="w-8 h-8 text-brand-gradient fill-current mr-4" />
          <div>
            <h3 className="text-2xl font-extrabold text-white tracking-tight group-hover:text-green-400 transition-colors">{folder.name}</h3>
            <p className="text-sm text-neutral-400 font-medium">{itemLabel(folder.playlistIds.length)} inside{subfolderLabel(children.length)}</p>
          </div>
        </div>
        <button onClick={(e) => ctx.toggleFolderExpand(e, folder.id)} className="w-10 h-10 bg-black/40 hover:bg-black text-white rounded-full flex items-center justify-center transition-all">
          <Minimize2 className="w-5 h-5" />
        </button>
      </div>

      <div className={`grid ${getGridClass()} animate-fade-in`}>
        {folder.playlistIds.length === 0 && children.length === 0 && <p className="text-neutral-500 italic col-span-full py-4 text-center">Empty folder</p>}
        {children.map(child => (
          expandedFolders.includes(child.id)
            ? <FolderPanel key={`expanded-${child.id}`} folder={child} ctx={ctx} />
            : <FolderCard key={child.id} folder={child} ctx={ctx} />
        ))}
        {folder.playlistIds.map((id) => {
          const item = itemsById.get(id);
          if (!item) return null;
          return <ItemCard key={item.id} item={item} isSubItem={true} parentFolderId={folder.id} {...itemCardProps} />;
        })}
      </div>
    </div>
  );
}

export default function Library() {
  const {
    token, profile, playlists, albums, setPlaylists, setCurrentView, setActivePlaylistId, navigateToPlaylist, navigateToAlbum,
    customFolders, addPlaylistToFolder, removePlaylistFromFolder, deleteFolder, deletePlaylist, createFolder,
    draggedItem, setDraggedItem, moveFolder, reorderPlaylistInFolder,
    libraryGridSize, setLibraryGridSize, librarySort, setLibrarySort, setContextMenu, activeFolderId, setActiveFolderId,
    manageFolderId, clearManageRequest, removeMissingFolderItems
  } = useSlice(useUserStore, [
    'token', 'profile', 'playlists', 'albums', 'setPlaylists', 'setCurrentView', 'setActivePlaylistId', 'navigateToPlaylist', 'navigateToAlbum',
    'customFolders', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'deleteFolder', 'deletePlaylist', 'createFolder',
    'draggedItem', 'setDraggedItem', 'moveFolder', 'reorderPlaylistInFolder',
    'libraryGridSize', 'setLibraryGridSize', 'librarySort', 'setLibrarySort', 'setContextMenu', 'activeFolderId', 'setActiveFolderId',
    'manageFolderId', 'clearManageRequest', 'removeMissingFolderItems'
  ]);

  const [loading, setLoading] = useState(playlists.length === 0);
  // Shared with the sidebar via the store; see the note there
  const isolatedFolderId = activeFolderId;
  const setIsolatedFolderId = setActiveFolderId;
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [isManagingRequested, setIsManagingRequested] = useState(false);
  const [confirmState, setConfirmState] = useState({ open: false, type: null, playlist: null, folderId: null });
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  
  const [dragOverId, setDragOverId] = useState(null);
  
  // Dialog States
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [isSubmittingPlaylist, setIsSubmittingPlaylist] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const activeFolder = customFolders.find(f => f.id === isolatedFolderId);
  const { playlists: unfolderedPlaylists, albums: unfolderedAlbums } = useMemo(
    () => getUnfolderedItems(playlists, albums, customFolders),
    [playlists, albums, customFolders]
  );

  // Built once per data change and handed to every card: the old per-card `allItems.find`
  // inside the folder tree walk was quadratic in library size on every render
  const allItems = useMemo(() => [...playlists, ...(albums || [])], [playlists, albums]);
  const itemsById = useMemo(() => new Map(allItems.map(item => [item.id, item])), [allItems]);
  const byParent = useMemo(() => {
    const map = new Map();
    for (const folder of customFolders) {
      const key = folder.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(folder);
    }
    for (const list of map.values()) list.sort(byOrder);
    return map;
  }, [customFolders]);
  const childrenOf = (parentId) => byParent.get(parentId ?? null) || [];

  // Only trustworthy once the library has actually loaded; before that every id looks missing
  const missingItemCount = (activeFolder && playlists.length > 0)
    ? activeFolder.playlistIds.filter(id => !itemsById.has(id)).length
    : 0;

  // Depends on the COUNT, not the array. Depending on the array identity meant an account with
  // zero playlists got setPlaylists([]) -> new array -> effect re-runs -> fetch again, forever,
  // until Spotify rate-limited it.
  const playlistCount = playlists.length;
  useEffect(() => {
    if (token && playlistCount === 0) {
      fetchUserPlaylists(token).then((data) => {
        setPlaylists(data.items);
        setLoading(false);
      }).catch((err) => {
        console.error(err);
        setLoading(false);
      });
    }
  }, [token, playlistCount, setPlaylists]);

  // Manage mode is only meaningful inside a folder, and the sidebar's "+" can request it
  const isManaging = Boolean(activeFolder) && (isManagingRequested || manageFolderId === activeFolder.id);
  const stopManaging = () => { setIsManagingRequested(false); clearManageRequest(); };

  const toggleFolderExpand = (e, folderId) => {
    e.stopPropagation(); 
    setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);
  };

  const handleMenuClick = (e, item, parentFolderId = null) => {
    e.preventDefault();
    e.stopPropagation();
    const isAlbum = item.type === 'album';
    const rect = e.currentTarget?.getBoundingClientRect?.() || { left: e.pageX, top: e.pageY };
    const x = e.pageX || rect.left;
    const y = e.pageY || rect.top;
    
    setContextMenu({ 
      type: isAlbum ? 'album' : 'playlist', 
      playlistId: isAlbum ? null : item.id, 
      albumId: isAlbum ? item.id : null,
      parentFolderId, 
      x, 
      y 
    });
  };

  const handleFolderContextMenu = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: 'folder',
      folderId: folder.id,
      folderName: folder.name,
      x: e.pageX,
      y: e.pageY,
      onDelete: () => {
        deleteFolder(folder.id);
        setContextMenu(null);
      }
    });
  };

  const handleDragStart = (e, item) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    
    setTimeout(() => {
      setDraggedItem(item);
    }, 0);
  };

  const handleDragOver = (e, id) => { 
    e.preventDefault(); 
    e.stopPropagation();
    
    if (draggedItem?.type === 'track') {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    
    if (dragOverId !== id) setDragOverId(id);
  };

  const cancelConfirm = () => {
    setConfirmState({ open: false, type: null, playlist: null, folderId: null });
  };

  const handleConfirm = async () => {
    if (confirmState.type === 'playlist') {
      const playlist = confirmState.playlist;
      if (!token || !playlist) return cancelConfirm();

      try {
        await unfollowPlaylist(token, playlist.id);
        deletePlaylist(playlist.id);
        setCurrentView('library');
        setActivePlaylistId(null);
      } catch (err) {
        console.error('Failed to delete playlist:', err);
      } finally {
        cancelConfirm();
      }
      return;
    }

    if (confirmState.type === 'folder' && confirmState.folderId) {
      deleteFolder(confirmState.folderId);
      cancelConfirm();
    }
  };

  const handleDragLeave = () => setDragOverId(null);
  const handleDragEnd = () => { setDraggedItem(null); setDragOverId(null); };

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);
    if (!draggedItem) return;
    // A grid has no before/after, so a folder dropped on a folder card nests inside it; sibling
    // ordering is done with the sidebar's insertion lines
    if (draggedItem.type === 'folder' && draggedItem.id !== targetFolderId) moveFolder(draggedItem.id, targetFolderId);
    else if (draggedItem.type === 'playlist' || draggedItem.type === 'album') addPlaylistToFolder(targetFolderId, draggedItem.id);
    setDraggedItem(null);
  };

  const handleDropOnItem = async (e, targetItemId, parentFolderId) => {
    e.preventDefault(); 
    e.stopPropagation();
    setDragOverId(null);
    
    const droppedUri = e.dataTransfer.getData('text/plain');

    if (droppedUri && droppedUri.includes('spotify:track:')) {
      try {
        await addTracksToPlaylist(token, targetItemId, [droppedUri]);
      } catch (err) {
        console.error('Failed to drop track:', err);
      }
      setDraggedItem(null);
      return; 
    }

    if (!draggedItem) return;
    if ((draggedItem.type === 'playlist' || draggedItem.type === 'album') && parentFolderId) {
      if (draggedItem.parentFolderId === parentFolderId && draggedItem.id !== targetItemId) {
        reorderPlaylistInFolder(parentFolderId, draggedItem.id, targetItemId);
      } else if (draggedItem.parentFolderId !== parentFolderId) {
        addPlaylistToFolder(parentFolderId, draggedItem.id);
      }
    }
    
    setDraggedItem(null);
  };

  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedItem) return;

    if ((draggedItem.type === 'playlist' || draggedItem.type === 'album') && draggedItem.parentFolderId) {
      removePlaylistFromFolder(draggedItem.parentFolderId, draggedItem.id);
    } else if (draggedItem.type === 'folder' && draggedItem.parentFolderId) {
      // Dropping a nested folder on empty space lifts it to the level you're looking at
      moveFolder(draggedItem.id, activeFolder ? activeFolder.id : null);
    }
    setDraggedItem(null);
  };

  const getGridClass = () => {
    if (libraryGridSize === 'small') return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4';
    if (libraryGridSize === 'large') return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8';
    return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6';
  };

  const handleCreatePlaylist = async ({ name, description, imageFile }) => {
    if (!token || !profile?.id) return;
    setIsSubmittingPlaylist(true);

    try {
      const newPlaylist = await createPlaylist(token, profile.id, {
        name,
        description,
        public: false,
        collaborative: false
      });

      if (imageFile) {
        try {
          await uploadPlaylistCoverImage(token, newPlaylist.id, imageFile);
        } catch (err) {
          console.warn('Playlist created but cover image upload failed:', err);
        }
      }

      setPlaylists([...playlists, newPlaylist]);
      navigateToPlaylist(newPlaylist.id);
      setPlaylistDialogOpen(false);
    } catch (err) {
      console.error('Failed to create playlist:', err);
    } finally {
      setIsSubmittingPlaylist(false);
    }
  };

  const closeFolderDialog = () => { setFolderDialogOpen(false); setCreateParentId(null); };

  const handleCreateFolder = async ({ name }) => {
    if (!name || !name.trim()) return;
    setIsCreatingFolder(true);
    try {
      createFolder(name.trim(), [], createParentId);
      closeFolderDialog();
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // `loading` only ever flips false from this view's own fetch; if App's load lands first the
  // count is already non-zero and there is nothing to wait for
  if (loading && playlistCount === 0) return <p className="text-neutral-400 animate-pulse text-lg">Loading your collection...</p>;

  // Everything the module-scope ItemCard needs from this render, spread at each call site
  const itemCardProps = {
    dragOverId,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDragEnd: handleDragEnd,
    onDropOnItem: handleDropOnItem,
    onOpenAlbum: navigateToAlbum,
    onOpenPlaylist: navigateToPlaylist,
    onMenu: handleMenuClick
  };

  // Everything the module-scope FolderCard / FolderPanel need from this render
  const folderCtx = {
    customFolders, itemsById, childrenOf, expandedFolders, dragOverId, draggedItem, getGridClass, itemCardProps,
    toggleFolderExpand, handleDragStart, handleDragOver, handleDragLeave, handleDragEnd,
    handleDropOnFolder, setIsolatedFolderId, handleFolderContextMenu
  };

  const activeChildren = activeFolder ? childrenOf(activeFolder.id) : [];
  const activePath = activeFolder ? folderPath(customFolders, activeFolder.id) : [];

  const gridItems = [];

  if (!activeFolder) {
    gridItems.push(
      <div key="liked-songs" onClick={() => setCurrentView('liked-songs')} className="bg-brand-gradient p-4 rounded-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group shadow-lg flex flex-col justify-end aspect-square relative overflow-hidden">
        <div className="absolute top-4 left-4"><Heart className="w-8 h-8 fill-white text-white shadow-sm" /></div>
        <h3 className="font-bold text-2xl text-white mb-1 leading-tight tracking-tighter">Liked Songs</h3>
        <p className="text-xs text-indigo-100 font-medium">Your saved collection</p>
      </div>
    );

    childrenOf(null).forEach((folder) => {
      gridItems.push(
        expandedFolders.includes(folder.id)
          ? <FolderPanel key={`expanded-${folder.id}`} folder={folder} ctx={folderCtx} />
          : <FolderCard key={folder.id} folder={folder} ctx={folderCtx} />
      );
    });

    sortItems(unfolderedPlaylists.filter(pl => pl.owner?.id !== 'spotify'), librarySort).forEach((pl) => gridItems.push(<ItemCard key={pl.id} item={pl} {...itemCardProps} />));
    sortItems(unfolderedAlbums, librarySort).forEach((album) => gridItems.push(<ItemCard key={album.id} item={album} {...itemCardProps} />));
  }

  // Search covers everything, foldered or not, plus folder names; results replace the grid
  const trimmedQuery = query.trim().toLowerCase();
  const searchItems = [];
  if (!activeFolder && trimmedQuery) {
    customFolders.filter(f => matches(f.name, trimmedQuery)).forEach((folder) => {
      searchItems.push(<FolderCard key={`folder-${folder.id}`} folder={folder} ctx={folderCtx} />);
    });
    sortItems(allItems.filter(item => matches(item.name, trimmedQuery) || matches(ownerOf(item), trimmedQuery)), librarySort)
      .forEach((item) => searchItems.push(<ItemCard key={item.id} item={item} {...itemCardProps} />));
  }

  // Spotify's own playlists (Top Songs, Blend, Discover Weekly...) that the user has saved.
  // Grouped apart because Spotify's API refuses to open them for third-party apps like this one.
  const madeForYou = unfolderedPlaylists.filter(pl => pl.owner?.id === 'spotify');

  return (
    <div 
      className="animate-fade-in pb-12 overflow-hidden md:min-h-[calc(100vh-200px)] flex flex-col"
      onDragOver={(e) => { 
        e.preventDefault(); 
        if (draggedItem?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
      }}
      onDrop={handleDropOnRoot}
    >
      {activeFolder ? (
        <div className="mb-8">
          <div className="flex items-center flex-wrap gap-x-1 gap-y-2 mb-6 text-sm">
            <button onClick={() => setIsolatedFolderId(activeFolder.parentId ?? null)} className="flex items-center text-neutral-400 hover:text-white transition-colors font-bold mr-3">
              <ChevronLeft className="w-5 h-5 mr-1" /> Back
            </button>
            <nav aria-label="Folder path" className="flex items-center flex-wrap gap-1">
              <button onClick={() => setIsolatedFolderId(null)} className="text-neutral-400 hover:text-white transition-colors">Library</button>
              {activePath.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  <ChevronRight className="w-4 h-4 text-neutral-600" />
                  {i === activePath.length - 1
                    ? <span className="text-white font-semibold">{crumb.name}</span>
                    : <button onClick={() => setIsolatedFolderId(crumb.id)} className="text-neutral-400 hover:text-white transition-colors">{crumb.name}</button>}
                </span>
              ))}
            </nav>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-10 gap-4">
            <div className="flex items-center">
              <div className="w-16 h-16 bg-neutral-800 rounded-lg flex items-center justify-center mr-4 shadow-lg shrink-0 overflow-hidden">
                <FolderStack folder={activeFolder} folders={customFolders} items={itemsById} />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Folder</span>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tighter truncate">{activeFolder.name}</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <SizingControls libraryGridSize={libraryGridSize} setLibraryGridSize={setLibraryGridSize} />
              <button onClick={() => (isManaging ? stopManaging() : setIsManagingRequested(true))} className={`px-6 py-2 rounded-full font-bold text-sm transition-colors ${isManaging ? 'bg-white text-black hover:scale-105' : 'border border-white/20 text-white hover:border-white'}`}>
                {isManaging ? 'Done Editing' : 'Manage Folder'}
              </button>
            </div>
          </div>
          
          {isManaging ? (
            <div className="space-y-12 animate-fade-in">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white">Subfolders</h2>
                  <button
                    type="button"
                    onClick={() => { setCreateParentId(activeFolder.id); setFolderDialogOpen(true); }}
                    className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-1.5 text-sm font-bold text-white hover:bg-white/10 transition-colors"
                  >
                    <FolderPlus className="w-4 h-4" /> New subfolder
                  </button>
                </div>
                {activeChildren.length === 0 && <p className="text-neutral-500 italic">No subfolders.</p>}
                <div className={`grid ${getGridClass()}`}>
                  {activeChildren.map(child => (
                    <div key={child.id} className="relative">
                      <FolderCard folder={child} ctx={folderCtx} />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveFolder(child.id, activeFolder.parentId ?? null); }}
                        title={activeFolder.parentId ? 'Move up one level' : 'Move to the top level'}
                        className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-black/60 border border-white/10 px-3 py-1 text-xs font-bold text-white hover:bg-black transition-colors"
                      >
                        <FolderOutput className="w-3.5 h-3.5" /> Move out
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <hr className="border-white/10" />
              <div>
                <h2 className="text-xl font-bold text-white mb-4">Click to Remove</h2>
                {activeFolder.playlistIds.length === 0 && <p className="text-neutral-500 italic">No items in this folder.</p>}
                {missingItemCount > 0 && (
                  <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm text-amber-200">
                      {missingItemCount} {missingItemCount === 1 ? 'entry' : 'entries'} in this folder {missingItemCount === 1 ? 'points' : 'point'} at something no longer in your library.
                    </p>
                    <button
                      type="button"
                      onClick={() => removeMissingFolderItems(activeFolder.id, allItems.map(i => i.id))}
                      className="shrink-0 flex items-center gap-2 rounded-full border border-amber-400/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20 transition-colors"
                    >
                      <FolderX className="w-3.5 h-3.5" /> Remove missing
                    </button>
                  </div>
                )}
                <div className={`grid ${getGridClass()}`}>
                  {activeFolder.playlistIds.map(id => {
                    const item = itemsById.get(id);
                    if (!item) return null;
                    return <ManageCard key={item.id} item={item} action="remove" onClick={() => removePlaylistFromFolder(activeFolder.id, item.id)} />;
                  })}
                </div>
              </div>
              <hr className="border-white/10" />
              <div>
                <h2 className="text-xl font-bold text-white mb-4">Click to Add</h2>
                {(unfolderedPlaylists.length === 0 && unfolderedAlbums.length === 0) && <p className="text-neutral-500 italic">No available items to add.</p>}
                <div className={`grid ${getGridClass()}`}>
                  {[...unfolderedPlaylists, ...unfolderedAlbums].map(item => (
                    <ManageCard key={item.id} item={item} action="add" onClick={() => addPlaylistToFolder(activeFolder.id, item.id)} />
                  ))}
                </div>
              </div>
              <div className="pt-8 border-t border-red-500/20">
                <button onClick={() => { setConfirmState({ open: true, type: 'folder', playlist: null, folderId: activeFolder?.id }); }} className="flex items-center px-4 py-2 text-red-500 hover:bg-red-500/10 rounded-md font-bold transition-colors">
                  <Trash2 className="w-5 h-5 mr-2" /> Delete Folder
                </button>
              </div>
            </div>
          ) : (
            <div className={`grid ${getGridClass()} animate-fade-in`}>
              {activeFolder.playlistIds.length === 0 && activeChildren.length === 0 && (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-neutral-800 rounded-xl">
                  <Folder className="w-12 h-12 mb-4 opacity-50" />
                  <p>This folder is empty.</p>
                  <button onClick={() => setIsManagingRequested(true)} className="mt-4 text-white font-bold hover:underline">Add Items</button>
                </div>
              )}
              {activeChildren.map(child => (
                expandedFolders.includes(child.id)
                  ? <FolderPanel key={`expanded-${child.id}`} folder={child} ctx={folderCtx} />
                  : <FolderCard key={child.id} folder={child} ctx={folderCtx} />
              ))}
              {activeFolder.playlistIds.map((id) => {
                const item = itemsById.get(id);
                if (!item) return null;
                return <ItemCard key={item.id} item={item} parentFolderId={activeFolder.id} {...itemCardProps} />;
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-4xl font-extrabold text-white tracking-tighter">Your Library</h1>
              <p className="text-sm text-neutral-400 mt-1">Create playlists and organize your collection.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setImportOpen(true)} title="Import your Spotify folder tree" className="px-5 py-2 rounded-full border border-white/20 text-white font-bold hover:bg-white/10 transition-all flex items-center">
                <FolderInput className="w-4 h-4 mr-2" /> Import
              </button>
              <button onClick={() => { setCreateParentId(null); setFolderDialogOpen(true); }} className="px-5 py-2 rounded-full border border-white/20 text-white font-bold hover:bg-white/10 transition-all flex items-center">
                <FolderPlus className="w-4 h-4 mr-2" /> Folder
              </button>
              <button onClick={() => setPlaylistDialogOpen(true)} className="px-5 py-2 rounded-full bg-brand-gradient text-white font-bold hover:opacity-90 transition-all flex items-center">
                <Plus className="w-4 h-4 mr-2" /> Playlist
              </button>
              <SizingControls libraryGridSize={libraryGridSize} setLibraryGridSize={setLibraryGridSize} />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
            <label className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-neutral-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your library"
                aria-label="Search your library"
                className="w-full bg-neutral-900 border border-white/10 rounded-full py-2.5 pl-11 pr-10 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-[var(--brand-mid)]"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
            </label>
            <label className="flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 shrink-0">
              <ArrowUpDown className="w-4 h-4 text-neutral-500" />
              <span className="sr-only">Sort</span>
              <select
                value={librarySort}
                onChange={(e) => setLibrarySort(e.target.value)}
                aria-label="Sort library"
                className="bg-transparent text-white font-semibold outline-none"
              >
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id} className="bg-neutral-900">{o.label}</option>)}
              </select>
            </label>
          </div>

          {trimmedQuery ? (
            searchItems.length > 0 ? (
              <div className={`grid ${getGridClass()}`}>{searchItems}</div>
            ) : (
              <p className="text-neutral-500 italic py-8">Nothing in your library matches "{query.trim()}".</p>
            )
          ) : (
            <div className={`grid ${getGridClass()}`}>
              {gridItems}
            </div>
          )}
          {!trimmedQuery && madeForYou.length > 0 && (
            <div className="mt-12">
              <h2 className="text-2xl font-bold text-white">Made for you</h2>
              <p className="text-sm text-neutral-400 mt-1 mb-4 max-w-2xl">
                Spotify's own playlists you've saved. Spotify's API doesn't let Jomify open these yet; tap one to see why and jump to it in Spotify.
              </p>
              <div className={`grid ${getGridClass()}`}>
                {madeForYou.map((pl) => <ItemCard key={pl.id} item={pl} {...itemCardProps} />)}
              </div>
            </div>
          )}
        </>
      )}
      {importOpen && (
        <Suspense fallback={null}>
          <ImportFoldersDialog open onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
      <PlaylistFormDialog
        open={playlistDialogOpen}
        title="Create playlist"
        submitLabel="Create"
        onSubmit={handleCreatePlaylist}
        onCancel={() => setPlaylistDialogOpen(false)}
        isSubmitting={isSubmittingPlaylist}
      />
      <FolderFormDialog
        open={folderDialogOpen}
        title={createParentId ? 'Create subfolder' : 'Create folder'}
        submitLabel="Create"
        parentLabel={createParentId ? customFolders.find(f => f.id === createParentId)?.name : ''}
        onSubmit={handleCreateFolder}
        onCancel={closeFolderDialog}
        isSubmitting={isCreatingFolder}
      />
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.type === 'playlist' ? 'Delete Playlist' : 'Delete Folder'}
        message={confirmState.type === 'playlist'
          ? `Delete "${confirmState.playlist?.name}" from your library?`
          : (() => {
            const subs = confirmState.folderId ? descendantIds(customFolders, confirmState.folderId).length : 0;
            return `Are you sure you want to delete this folder?${subs ? ` This also deletes ${subs} subfolder${subs === 1 ? '' : 's'}.` : ''} Your playlists will not be deleted.`;
          })()}
        confirmLabel={confirmState.type === 'playlist' ? 'Delete Playlist' : 'Delete Folder'}
        onConfirm={handleConfirm}
        onCancel={cancelConfirm}
      />
    </div>
  );
}