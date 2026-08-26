import { useEffect, useRef, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { fetchUserPlaylists, addTracksToPlaylist, unfollowPlaylist, createPlaylist, uploadPlaylistCoverImage } from '../../services/spotify/api';
import { Heart, Folder, Maximize2, ChevronLeft, Plus, Minus, Trash2, MoreVertical, FolderPlus, Minimize2 } from 'lucide-react';
import { motion } from 'framer-motion';
import ConfirmDialog from '../../components/ConfirmDialog';
import PlaylistFormDialog from '../../components/PlaylistFormDialog';
import FolderFormDialog from '../../components/FolderFormDialog';

// --- VISUAL UPGRADE: Safely Bounded Right-to-Left Fan Stack ---
const FolderStack = ({ folder, items }) => {
  const folderItems = folder.playlistIds.map(id => items.find(p => p.id === id)).filter(Boolean);
  
  if (folderItems.length === 0) {
    return <div className="w-full h-full flex items-center justify-center bg-neutral-800"><Folder className="w-8 h-8 sm:w-16 sm:h-16 text-neutral-700" /></div>;
  }
  
  return (
    <div className="relative w-full h-full flex items-center overflow-hidden bg-neutral-800/50">
      {folderItems.slice(0, 4).reverse().map((item, i, arr) => {
        const index = arr.length - 1 - i; 
        const rightOffset = 5 + (index * 14); 
        const scale = 1 - (index * 0.15); 
        return (
          <div 
            key={`stack-${item.id}-${i}`} 
            className="absolute w-[75%] h-[75%] rounded-md shadow-2xl overflow-hidden bg-neutral-900 border border-white/10 transition-transform duration-500 ease-out group-hover:-translate-y-2 sm:group-hover:-translate-y-3"
            style={{ right: `${rightOffset}%`, transform: `scale(${scale})`, zIndex: 10 - index }}
          >
            {item.images?.[0]?.url ? (
              <img src={item.images[0].url} draggable="false" className="w-full h-full object-cover pointer-events-none" alt="" />
            ) : (
              <span className="text-lg sm:text-2xl flex items-center justify-center w-full h-full opacity-30">💿</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default function Library() {
  const { 
    token, profile, playlists, albums, setPlaylists, setCurrentView, setActivePlaylistId, navigateToAlbum,
    customFolders, addPlaylistToFolder, removePlaylistFromFolder, deleteFolder, deletePlaylist, createFolder,
    draggedItem, setDraggedItem, reorderFolders, reorderPlaylistInFolder,
    libraryGridSize, setLibraryGridSize, setContextMenu
  } = useUserStore();

  const [loading, setLoading] = useState(playlists.length === 0);
  const [isolatedFolderId, setIsolatedFolderId] = useState(null); 
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [isManaging, setIsManaging] = useState(false); 
  const [confirmState, setConfirmState] = useState({ open: false, type: null, playlist: null, folderId: null });
  
  const [dragOverId, setDragOverId] = useState(null);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const touchDragItemRef = useRef(null);
  const touchPendingRef = useRef(null);
  
  // Dialog States
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [isSubmittingPlaylist, setIsSubmittingPlaylist] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const activeFolder = customFolders.find(f => f.id === isolatedFolderId);
  const unfolderedPlaylists = playlists.filter(p => !customFolders.some(f => f.playlistIds.includes(p.id)));
  const unfolderedAlbums = (albums || []).filter(a => !customFolders.some(f => f.playlistIds.includes(a.id)));

  const allItems = [...playlists, ...(albums || [])];

  useEffect(() => {
    if (token && playlists.length === 0) {
      fetchUserPlaylists(token).then((data) => {
        setPlaylists(data.items);
        setLoading(false);
      }).catch(console.error);
    } else setLoading(false);
  }, [token, playlists, setPlaylists]);

  useEffect(() => { if (!activeFolder) setIsManaging(false); }, [activeFolder]);

  const toggleFolderExpand = (e, folderId) => {
    e.stopPropagation(); 
    setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);
  };

  const handleMenuClick = (e, item, parentFolderId = null) => {
    e.preventDefault();
    e.stopPropagation();
    const isAlbum = item.type === 'album';
    const rect = e.currentTarget?.getBoundingClientRect?.() || { left: e.pageX, top: e.pageY };
    const x = e.clientX || (e.touches && e.touches[0].clientX) || e.pageX || rect.left;
    const y = e.clientY || (e.touches && e.touches[0].clientY) || e.pageY || rect.top;
    
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
      x: e.pageX || (e.touches && e.touches[0].clientX),
      y: e.pageY || (e.touches && e.touches[0].clientY),
      onDelete: () => {
        deleteFolder(folder.id);
        if (isolatedFolderId === folder.id) setIsolatedFolderId(null);
        setContextMenu(null);
      }
    });
  };

  const clearDragState = () => {
    setDraggedItem(null);
    setDragOverId(null);
    setIsTouchDragging(false);
    touchDragItemRef.current = null;
    touchPendingRef.current = null;
  };

  const resolveDropAction = (item, dropTarget) => {
    if (!item || !dropTarget) return;

    if (dropTarget.kind === 'folder') {
      if (item.type === 'folder' && item.id !== dropTarget.id) {
        reorderFolders(item.id, dropTarget.id);
      } else if (item.type === 'playlist' || item.type === 'album') {
        addPlaylistToFolder(dropTarget.id, item.id);
      }
      return;
    }

    if (dropTarget.kind === 'item') {
      if ((item.type !== 'playlist' && item.type !== 'album') || !dropTarget.parentFolderId) return;

      if (item.parentFolderId === dropTarget.parentFolderId && item.id !== dropTarget.id) {
        reorderPlaylistInFolder(dropTarget.parentFolderId, item.id, dropTarget.id);
      } else if (item.parentFolderId !== dropTarget.parentFolderId) {
        addPlaylistToFolder(dropTarget.parentFolderId, item.id);
      }
      return;
    }

    if (
      dropTarget.kind === 'root' &&
      (item.type === 'playlist' || item.type === 'album') &&
      item.parentFolderId
    ) {
      removePlaylistFromFolder(item.parentFolderId, item.id);
    }
  };

  const getDropTargetFromPoint = (x, y) => {
    const dropElement = document.elementFromPoint(x, y)?.closest('[data-drop-kind]');
    if (!dropElement) return { kind: 'root' };

    const kind = dropElement.getAttribute('data-drop-kind');
    if (kind === 'folder') {
      return { kind: 'folder', id: dropElement.getAttribute('data-drop-id') };
    }
    if (kind === 'item') {
      return {
        kind: 'item',
        id: dropElement.getAttribute('data-drop-id'),
        parentFolderId: dropElement.getAttribute('data-parent-folder-id') || null
      };
    }
    return { kind: 'root' };
  };

  const handleTouchDragStart = (e, item) => {
    if (!e.touches?.length) return;
    touchPendingRef.current = {
      item,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY
    };
  };

  const handleTouchDragMove = (e) => {
    if (!e.touches?.length) return;

    if (!touchDragItemRef.current && touchPendingRef.current) {
      const dx = e.touches[0].clientX - touchPendingRef.current.startX;
      const dy = e.touches[0].clientY - touchPendingRef.current.startY;
      if (Math.hypot(dx, dy) < 10) return;

      touchDragItemRef.current = touchPendingRef.current.item;
      setDraggedItem(touchPendingRef.current.item);
      setIsTouchDragging(true);
      setDragOverId(touchPendingRef.current.item.id);
    }

    if (!touchDragItemRef.current) return;
    e.preventDefault();

    const target = getDropTargetFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    if (target.kind === 'root') {
      if (dragOverId !== null) setDragOverId(null);
      return;
    }
    if (target.id && dragOverId !== target.id) {
      setDragOverId(target.id);
    }
  };

  const handleTouchDragEnd = (e) => {
    if (!touchDragItemRef.current || !e.changedTouches?.length) {
      touchPendingRef.current = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const item = touchDragItemRef.current;
    const target = getDropTargetFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    resolveDropAction(item, target);
    clearDragState();
  };

  const handleDragStart = (e, item) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setDraggedItem(item);
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
      setIsolatedFolderId(null);
      cancelConfirm();
    }
  };

  const handleDragLeave = () => {};
  const handleDragEnd = () => clearDragState();

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);
    resolveDropAction(draggedItem, { kind: 'folder', id: targetFolderId });
    clearDragState();
  };

  const handleDropOnItem = async (e, targetItemId, parentFolderId) => {
    e.preventDefault(); 
    e.stopPropagation();
    setDragOverId(null);
    
    const droppedUri = e.dataTransfer.getData('text/plain');

    if (droppedUri && droppedUri.includes('spotify:track:')) {
      try {
        await addTracksToPlaylist(token, targetItemId, [droppedUri]);
        console.log('Successfully added track!');
      } catch (err) {
        console.error('Failed to drop track:', err);
      }
      setDraggedItem(null);
      return; 
    }

    resolveDropAction(draggedItem, { kind: 'item', id: targetItemId, parentFolderId });
    clearDragState();
  };

  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDragOverId(null);
    resolveDropAction(draggedItem, { kind: 'root' });
    clearDragState();
  };

  // Responsive Grid Logic Base
  const getGridClass = () => {
    if (libraryGridSize === 'small') return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4';
    if (libraryGridSize === 'large') return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-8';
    return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6'; // Medium default
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
      setActivePlaylistId(newPlaylist.id);
      setCurrentView('playlist');
      setPlaylistDialogOpen(false);
    } catch (err) {
      console.error('Failed to create playlist:', err);
    } finally {
      setIsSubmittingPlaylist(false);
    }
  };

  const handleCreateFolder = async ({ name }) => {
    if (!name || !name.trim()) return;
    setIsCreatingFolder(true);
    try {
      createFolder(name.trim());
      setFolderDialogOpen(false);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Squished size controls for mobile headers
  const SizingControls = () => (
    <div className="flex items-center space-x-1 sm:space-x-2 bg-white/5 border border-white/10 rounded-full px-2 sm:px-3 py-1 sm:py-1.5 w-fit shrink-0">
      <span className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider mr-1 sm:mr-2">Size</span>
      <button onClick={() => setLibraryGridSize('small')} className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-bold transition-colors ${libraryGridSize === 'small' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>S</button>
      <button onClick={() => setLibraryGridSize('medium')} className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-bold transition-colors ${libraryGridSize === 'medium' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>M</button>
      <button onClick={() => setLibraryGridSize('large')} className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-bold transition-colors ${libraryGridSize === 'large' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>L</button>
    </div>
  );

  if (loading) return <p className="text-neutral-400 animate-pulse text-sm md:text-lg">Loading your collection...</p>;

  const ItemCard = ({ item, isSubItem = false, parentFolderId = null }) => {
    const isDragTarget = dragOverId === item.id;
    const isAlbum = item.type === 'album';

    return (
      <div 
        draggable="true" 
        data-drop-kind="item"
        data-drop-id={item.id}
        data-parent-folder-id={parentFolderId || ''}
        onDragStart={(e) => handleDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId })}
        onDragOver={(e) => handleDragOver(e, item.id)} 
        onDragLeave={handleDragLeave} 
        onDragEnd={handleDragEnd} 
        onDrop={(e) => handleDropOnItem(e, item.id, parentFolderId)}
        onTouchStart={(e) => handleTouchDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId })}
        onTouchMove={handleTouchDragMove}
        onTouchEnd={handleTouchDragEnd}
        onTouchCancel={handleDragEnd}
        onClick={() => {
          if (isTouchDragging) return;
          if (isAlbum) navigateToAlbum(item.id);
          else { setActivePlaylistId(item.id); setCurrentView('playlist'); }
        }}
        onContextMenu={(e) => handleMenuClick(e, item, parentFolderId)}
        className={`p-2.5 sm:p-4 rounded-xl hover:bg-neutral-800 transition-all duration-300 cursor-pointer group shadow-lg flex flex-col h-full relative cursor-grab active:cursor-grabbing ${isDragTarget ? 'ring-2 ring-[#f91362] bg-brand-gradient text-white/10 scale-[1.02]' : isSubItem ? 'bg-neutral-800/40 border border-neutral-700/30 hover:border-neutral-500/50' : 'bg-neutral-800/40'}`}
      >
        <button type="button" onClick={(e) => handleMenuClick(e, item, parentFolderId)} className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 w-6 h-6 sm:w-8 sm:h-8 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-md">
          <MoreVertical className="w-3 h-3 sm:w-4 sm:h-4" />
        </button>
        
        <div className="relative aspect-square w-full mb-2 sm:mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0 pointer-events-none">
          {item.images?.length > 0 ? <img src={item.images[0].url} draggable="false" alt={item.name} className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" /> : <span className="text-xl sm:text-3xl">💿</span>}
        </div>
        <h3 className="font-bold text-xs sm:text-sm text-white truncate mb-0.5 sm:mb-1 pointer-events-none">{item.name}</h3>
        <p className="text-[10px] sm:text-xs text-neutral-400 truncate mt-auto pointer-events-none">
          {isAlbum ? `Album • ${item.artists?.map(a => a.name).join(', ')}` : `By ${item.owner?.display_name || 'Spotify'}`}
        </p>
      </div>
    );
  };

  const ManageCard = ({ item, action, onClick }) => (
    <div onClick={onClick} className={`p-2.5 sm:p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border border-transparent flex flex-col h-full ${action === 'add' ? 'bg-neutral-800/20 hover:border-[#f91362]/50 hover:bg-brand-gradient text-white/10' : 'bg-neutral-800/40 hover:border-red-500/50 hover:bg-red-500/10'}`}>
      <div className="relative aspect-square w-full mb-2 sm:mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0">
        {item.images?.length > 0 ? <img src={item.images[0].url} draggable="false" alt={item.name} className="object-cover w-full h-full opacity-60 group-hover:opacity-100 transition-opacity duration-300" /> : <span className="text-xl sm:text-3xl opacity-60 group-hover:opacity-100">💿</span>}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          {action === 'add' ? <Plus className="w-8 h-8 sm:w-12 sm:h-12 text-brand-gradient" /> : <Minus className="w-8 h-8 sm:w-12 sm:h-12 text-red-500" />}
        </div>
      </div>
      <h3 className="font-bold text-xs sm:text-sm text-white truncate mb-1">{item.name}</h3>
    </div>
  );

  const gridItems = [];

  if (!activeFolder) {
    gridItems.push(
      <div key="liked-songs" onClick={() => setCurrentView('liked-songs')} className="bg-brand-gradient p-3 sm:p-4 rounded-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group shadow-lg flex flex-col justify-end aspect-square relative overflow-hidden">
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4"><Heart className="w-6 h-6 sm:w-8 sm:h-8 fill-white text-white shadow-sm" /></div>
        <h3 className="font-bold text-base sm:text-2xl text-white mb-0.5 sm:mb-1 leading-tight tracking-tighter">Liked Songs</h3>
        <p className="text-[10px] sm:text-xs text-indigo-100 font-medium">Your saved collection</p>
      </div>
    );

    customFolders.forEach((folder) => {
      const isExpanded = expandedFolders.includes(folder.id);
      const isDragTarget = dragOverId === folder.id;
      
      if (isExpanded) {
        gridItems.push(
          <div key={`expanded-${folder.id}`} className="col-span-full bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-4 sm:p-6 shadow-inner animate-fade-in mb-2 sm:mb-4">
            <div className="flex items-center justify-between mb-4 sm:mb-6 border-b border-white/5 pb-3 sm:pb-4">
              <div className="flex items-center cursor-pointer group hover:text-green-400 transition-colors truncate pr-4" onClick={() => setIsolatedFolderId(folder.id)}>
                <Folder className="w-6 h-6 sm:w-8 sm:h-8 text-brand-gradient fill-current mr-3 sm:mr-4 shrink-0" />
                <div className="truncate">
                  <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight group-hover:text-green-400 transition-colors truncate">{folder.name}</h3>
                  <p className="text-xs sm:text-sm text-neutral-400 font-medium">{folder.playlistIds.length} items</p>
                </div>
              </div>
              <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="w-8 h-8 sm:w-10 sm:h-10 bg-black/40 hover:bg-black text-white rounded-full flex items-center justify-center transition-all shrink-0">
                <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className={`grid ${getGridClass()}`}>
              {folder.playlistIds.length === 0 && <p className="text-neutral-500 italic text-sm col-span-full py-2 sm:py-4 text-center">Empty folder</p>}
              {folder.playlistIds.map((id, idx) => {
                const item = allItems.find(p => p.id === id);
                if (!item) return null;
                return (
                  <motion.div key={`lib-expanded-${folder.id}-item-${item.id}-${idx}`} variants={{ hidden: { opacity: 0, y: 20, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}>
                    <ItemCard item={item} isSubItem={true} parentFolderId={folder.id} />
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        );
      } else {
        gridItems.push(
          <div 
            key={`lib-folder-${folder.id}`} 
            draggable="true" 
            data-drop-kind="folder"
            data-drop-id={folder.id}
            onDragStart={(e) => handleDragStart(e, { type: 'folder', id: folder.id })}
            onDragOver={(e) => handleDragOver(e, folder.id)} 
            onDragLeave={handleDragLeave}
            onDragEnd={handleDragEnd} 
            onDrop={(e) => handleDropOnFolder(e, folder.id)}
            onTouchStart={(e) => handleTouchDragStart(e, { type: 'folder', id: folder.id })}
            onTouchMove={handleTouchDragMove}
            onTouchEnd={handleTouchDragEnd}
            onTouchCancel={handleDragEnd}
            onClick={() => setIsolatedFolderId(folder.id)} 
            onContextMenu={(e) => handleFolderContextMenu(e, folder)}
            className={`p-2.5 sm:p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border relative flex flex-col h-full cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-brand-gradient text-white/10 border-[#f91362] scale-[1.02]' : 'bg-neutral-800/40 border-transparent hover:border-neutral-700 hover:bg-neutral-800/80'} ${(draggedItem?.type === 'playlist' || draggedItem?.type === 'album') && !isDragTarget ? 'border-dashed border-[#f91362]/50 bg-brand-gradient text-white/5' : ''}`}
          >
            <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20 w-6 h-6 sm:w-8 sm:h-8 bg-black/40 hover:bg-black/80 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors" title="Expand Inline">
              <Maximize2 className="w-3 h-3 sm:w-4 h-4 text-white transition-transform duration-300" />
            </button>
            <div className="aspect-square w-full mb-2 sm:mb-4 rounded-md shadow-md shrink-0 pointer-events-none">
               <FolderStack folder={folder} items={allItems} />
            </div>
            <h3 className="font-bold text-xs sm:text-sm text-white truncate mb-0.5 sm:mb-1 flex items-center pointer-events-none">
              <Folder className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 text-brand-gradient fill-current shrink-0" />
              <span className="truncate">{folder.name}</span>
            </h3>
            <p className="text-[10px] sm:text-xs text-neutral-400 truncate mt-auto pointer-events-none">{folder.playlistIds.length} items</p>
          </div>
        );
      }
    });

    unfolderedPlaylists.forEach((pl, idx) => gridItems.push(<ItemCard key={`lib-unfoldered-pl-${pl.id}-${idx}`} item={pl} />));
    unfolderedAlbums.forEach((album, idx) => gridItems.push(<ItemCard key={`lib-unfoldered-al-${album.id}-${idx}`} item={album} />));
  }

  return (
    <div 
      data-drop-kind="root"
      className="animate-fade-in pb-8 sm:pb-12 overflow-hidden min-h-[calc(100vh-200px)] flex flex-col"
      onDragOver={(e) => { 
        e.preventDefault(); 
        if (draggedItem?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
      }}
      onDrop={handleDropOnRoot}
      onTouchMove={handleTouchDragMove}
      onTouchEnd={handleTouchDragEnd}
      onTouchCancel={handleDragEnd}
    >
      {activeFolder ? (
        <div className="mb-6 sm:mb-8">
          <button onClick={() => setIsolatedFolderId(null)} className="flex items-center text-neutral-400 hover:text-white mb-4 sm:mb-6 transition-colors font-bold w-fit text-sm sm:text-base">
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 mr-1" /> Back
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-10 gap-4">
            <div className="flex items-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-neutral-800 rounded-lg flex items-center justify-center mr-3 sm:mr-4 shadow-lg shrink-0 overflow-hidden">
                <FolderStack folder={activeFolder} items={allItems} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-neutral-400">Folder</span>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tighter truncate">{activeFolder.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <SizingControls />
              <button onClick={() => setIsManaging(!isManaging)} className={`px-4 sm:px-6 py-1.5 sm:py-2 rounded-full font-bold text-xs sm:text-sm transition-colors ${isManaging ? 'bg-white text-black hover:scale-105' : 'border border-white/20 text-white hover:border-white'}`}>
                {isManaging ? 'Done Editing' : 'Manage'}
              </button>
            </div>
          </div>
          
          {isManaging ? (
            <div className="space-y-8 sm:space-y-12 animate-fade-in">
               <div>
                <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">Click to Remove</h2>
                {activeFolder.playlistIds.length === 0 && <p className="text-neutral-500 italic text-sm">No items in this folder.</p>}
                <div className={`grid ${getGridClass()}`}>
                  {activeFolder.playlistIds.map((id, idx) => {
                    const item = allItems.find(p => p.id === id);
                    if (!item) return null;
                    return <ManageCard key={`manage-remove-${item.id}-${idx}`} item={item} action="remove" onClick={() => removePlaylistFromFolder(activeFolder.id, item.id)} />;
                  })}
                </div>
              </div>
              <hr className="border-white/10" />
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">Click to Add</h2>
                {(unfolderedPlaylists.length === 0 && unfolderedAlbums.length === 0) && <p className="text-neutral-500 italic text-sm">No available items to add.</p>}
                <div className={`grid ${getGridClass()}`}>
                  {[...unfolderedPlaylists, ...unfolderedAlbums].map((item, idx) => (
                    <ManageCard key={`manage-add-${item.id}-${idx}`} item={item} action="add" onClick={() => addPlaylistToFolder(activeFolder.id, item.id)} />
                  ))}
                </div>
              </div>
              <div className="pt-6 sm:pt-8 border-t border-red-500/20">
                <button onClick={() => { setConfirmState({ open: true, type: 'folder', playlist: null, folderId: activeFolder?.id }); }} className="flex items-center px-3 sm:px-4 py-1.5 sm:py-2 text-red-500 hover:bg-red-500/10 rounded-md font-bold transition-colors text-sm">
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2" /> Delete Folder
                </button>
              </div>
            </div>
          ) : (
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className={`grid ${getGridClass()}`}>
              {activeFolder.playlistIds.length === 0 && (
                <div className="col-span-full py-8 sm:py-12 flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-neutral-800 rounded-xl">
                  <Folder className="w-10 h-10 sm:w-12 sm:h-12 mb-3 sm:mb-4 opacity-50" />
                  <p className="text-sm sm:text-base">This folder is empty.</p>
                  <button onClick={() => setIsManaging(true)} className="mt-3 sm:mt-4 text-white font-bold text-sm sm:text-base hover:underline">Add Items</button>
                </div>
              )}
              {activeFolder.playlistIds.map((id, idx) => {
                const item = allItems.find(p => p.id === id);
                if (!item) return null;
                return (
                  <motion.div key={`lib-active-folder-item-${item.id}-${idx}`} variants={{ hidden: { opacity: 0, y: 20, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}>
                    <ItemCard item={item} parentFolderId={activeFolder.id} />
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      ) : (
        <>
          {/* Main Library Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tighter">Your Library</h1>
              <p className="text-xs sm:text-sm text-neutral-400 mt-1">Create playlists and organize your collection.</p>
            </div>
            {/* Flex-wrap prevents buttons from breaking layout on very narrow screens */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button onClick={() => setFolderDialogOpen(true)} className="px-3 sm:px-5 py-1.5 sm:py-2 rounded-full border border-white/20 text-white text-xs sm:text-sm font-bold hover:bg-white/10 transition-all flex items-center">
                <FolderPlus className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Folder
              </button>
              <button onClick={() => setPlaylistDialogOpen(true)} className="px-3 sm:px-5 py-1.5 sm:py-2 rounded-full bg-brand-gradient text-white text-black text-xs sm:text-sm font-bold hover:opacity-90 transition-all flex items-center">
                <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" /> Playlist
              </button>
              <SizingControls />
            </div>
          </div>
          <div className={`grid ${getGridClass()}`}>
            {gridItems}
          </div>
        </>
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
        title="Create folder"
        submitLabel="Create"
        onSubmit={handleCreateFolder}
        onCancel={() => setFolderDialogOpen(false)}
        isSubmitting={isCreatingFolder}
      />
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.type === 'playlist' ? 'Delete Playlist' : 'Delete Folder'}
        message={confirmState.type === 'playlist' ? `Delete "${confirmState.playlist?.name}" from your library?` : 'Are you sure you want to delete this folder? Your playlists will not be deleted.'}
        confirmLabel={confirmState.type === 'playlist' ? 'Delete Playlist' : 'Delete Folder'}
        onConfirm={handleConfirm}
        onCancel={cancelConfirm}
      />
    </div>
  );
}