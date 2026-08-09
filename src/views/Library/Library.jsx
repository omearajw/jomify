import { useEffect, useState } from 'react';
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
    return <div className="w-full h-full flex items-center justify-center bg-neutral-800"><Folder className="w-16 h-16 text-neutral-700" /></div>;
  }
  
  return (
    <div className="relative w-full h-full flex items-center overflow-hidden bg-neutral-800/50">
      {folderItems.slice(0, 4).reverse().map((item, i, arr) => {
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
              <img src={item.images[0].url} draggable="false" className="w-full h-full object-cover pointer-events-none" alt="" />
            ) : (
              <span className="text-2xl flex items-center justify-center w-full h-full opacity-30">💿</span>
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
        if (isolatedFolderId === folder.id) setIsolatedFolderId(null);
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
      setIsolatedFolderId(null);
      cancelConfirm();
    }
  };

  const handleDragLeave = () => setDragOverId(null);
  const handleDragEnd = () => { setDraggedItem(null); setDragOverId(null); };

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);
    if (!draggedItem) return;
    if (draggedItem.type === 'folder' && draggedItem.id !== targetFolderId) reorderFolders(draggedItem.id, targetFolderId);
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
        console.log('Successfully added track!');
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

  const SizingControls = () => (
    <div className="flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 w-fit shrink-0">
      <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider mr-2">Size</span>
      <button onClick={() => setLibraryGridSize('small')} className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${libraryGridSize === 'small' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>S</button>
      <button onClick={() => setLibraryGridSize('medium')} className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${libraryGridSize === 'medium' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>M</button>
      <button onClick={() => setLibraryGridSize('large')} className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${libraryGridSize === 'large' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>L</button>
    </div>
  );

  if (loading) return <p className="text-neutral-400 animate-pulse text-lg">Loading your collection...</p>;

  const ItemCard = ({ item, isSubItem = false, parentFolderId = null }) => {
    const isDragTarget = dragOverId === item.id;
    const isAlbum = item.type === 'album';

    return (
      <div 
        draggable="true" 
        onDragStart={(e) => handleDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId })}
        onDragOver={(e) => handleDragOver(e, item.id)} 
        onDragLeave={handleDragLeave} 
        onDragEnd={handleDragEnd} 
        onDrop={(e) => handleDropOnItem(e, item.id, parentFolderId)}
        onClick={() => {
          if (isAlbum) navigateToAlbum(item.id);
          else { setActivePlaylistId(item.id); setCurrentView('playlist'); }
        }}
        onContextMenu={(e) => handleMenuClick(e, item, parentFolderId)}
        className={`p-4 rounded-xl hover:bg-neutral-800 transition-all duration-300 cursor-pointer group shadow-lg flex flex-col h-full relative cursor-grab active:cursor-grabbing ${isDragTarget ? 'ring-2 ring-[#f91362] bg-brand-gradient text-white/10 scale-[1.02]' : isSubItem ? 'bg-neutral-800/40 border border-neutral-700/30 hover:border-neutral-500/50' : 'bg-neutral-800/40'}`}
      >
        <button type="button" onClick={(e) => handleMenuClick(e, item, parentFolderId)} className="absolute top-6 right-6 z-10 w-8 h-8 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-md">
          <MoreVertical className="w-4 h-4" />
        </button>
        
        <div className="relative aspect-square w-full mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0 pointer-events-none">
          {item.images?.length > 0 ? <img src={item.images[0].url} draggable="false" alt={item.name} className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" /> : <span className="text-3xl">💿</span>}
        </div>
        <h3 className="font-bold text-sm text-white truncate mb-1 pointer-events-none">{item.name}</h3>
        <p className="text-xs text-neutral-400 truncate mt-auto pointer-events-none">
          {isAlbum ? `Album • ${item.artists?.map(a => a.name).join(', ')}` : `By ${item.owner?.display_name || 'Spotify'}`}
        </p>
      </div>
    );
  };

  const ManageCard = ({ item, action, onClick }) => (
    <div onClick={onClick} className={`p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border border-transparent flex flex-col h-full ${action === 'add' ? 'bg-neutral-800/20 hover:border-[#f91362]/50 hover:bg-brand-gradient text-white/10' : 'bg-neutral-800/40 hover:border-red-500/50 hover:bg-red-500/10'}`}>
      <div className="relative aspect-square w-full mb-4 rounded-md overflow-hidden bg-neutral-800 flex items-center justify-center shadow-md shrink-0">
        {item.images?.length > 0 ? <img src={item.images[0].url} draggable="false" alt={item.name} className="object-cover w-full h-full opacity-60 group-hover:opacity-100 transition-opacity duration-300" /> : <span className="text-3xl opacity-60 group-hover:opacity-100">💿</span>}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          {action === 'add' ? <Plus className="w-12 h-12 text-brand-gradient" /> : <Minus className="w-12 h-12 text-red-500" />}
        </div>
      </div>
      <h3 className="font-bold text-sm text-white truncate mb-1">{item.name}</h3>
    </div>
  );

  const gridItems = [];

  if (!activeFolder) {
    gridItems.push(
      <div key="liked-songs" onClick={() => setCurrentView('liked-songs')} className="bg-brand-gradient p-4 rounded-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group shadow-lg flex flex-col justify-end aspect-square relative overflow-hidden">
        <div className="absolute top-4 left-4"><Heart className="w-8 h-8 fill-white text-white shadow-sm" /></div>
        <h3 className="font-bold text-2xl text-white mb-1 leading-tight tracking-tighter">Liked Songs</h3>
        <p className="text-xs text-indigo-100 font-medium">Your saved collection</p>
      </div>
    );

    customFolders.forEach((folder) => {
      const isExpanded = expandedFolders.includes(folder.id);
      const isDragTarget = dragOverId === folder.id;
      
      if (isExpanded) {
        gridItems.push(
          <div key={`expanded-${folder.id}`} className="col-span-full bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-6 shadow-inner animate-fade-in mb-4">
            <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
              <div className="flex items-center cursor-pointer group hover:text-green-400 transition-colors" onClick={() => setIsolatedFolderId(folder.id)}>
                <Folder className="w-8 h-8 text-brand-gradient fill-current mr-4" />
                <div>
                  <h3 className="text-2xl font-extrabold text-white tracking-tight group-hover:text-green-400 transition-colors">{folder.name}</h3>
                  <p className="text-sm text-neutral-400 font-medium">{folder.playlistIds.length} items inside</p>
                </div>
              </div>
              <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="w-10 h-10 bg-black/40 hover:bg-black text-white rounded-full flex items-center justify-center transition-all">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
            
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className={`grid ${getGridClass()}`}>
              {folder.playlistIds.length === 0 && <p className="text-neutral-500 italic col-span-full py-4 text-center">Empty folder</p>}
              {folder.playlistIds.map((id) => {
                const item = allItems.find(p => p.id === id);
                if (!item) return null;
                return (
                  <motion.div key={item.id} variants={{ hidden: { opacity: 0, y: 30, scale: 0.9 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}>
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
            key={folder.id} 
            draggable="true" 
            onDragStart={(e) => handleDragStart(e, { type: 'folder', id: folder.id })}
            onDragOver={(e) => handleDragOver(e, folder.id)} 
            onDragLeave={handleDragLeave}
            onDragEnd={handleDragEnd} 
            onDrop={(e) => handleDropOnFolder(e, folder.id)}
            onClick={() => setIsolatedFolderId(folder.id)} 
            onContextMenu={(e) => handleFolderContextMenu(e, folder)}
            className={`p-4 rounded-xl transition-all duration-300 cursor-pointer group shadow-lg border relative flex flex-col h-full cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-brand-gradient text-white/10 border-[#f91362] scale-[1.02]' : 'bg-neutral-800/40 border-transparent hover:border-neutral-700 hover:bg-neutral-800/80'} ${(draggedItem?.type === 'playlist' || draggedItem?.type === 'album') && !isDragTarget ? 'border-dashed border-[#f91362]/50 bg-brand-gradient text-white/5' : ''}`}
          >
            <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="absolute top-4 right-4 z-100 w-8 h-8 bg-black/40 hover:bg-black/80 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors" title="Expand Inline">
              <Maximize2 className="w-4 h-4 text-white transition-transform duration-300" />
            </button>
            <div className="aspect-square w-full mb-4 rounded-md shadow-md shrink-0 pointer-events-none">
               <FolderStack folder={folder} items={allItems} />
            </div>
            <h3 className="font-bold text-sm text-white truncate mb-1 flex items-center pointer-events-none">
              <Folder className="w-4 h-4 mr-2 text-brand-gradient fill-current shrink-0" />
              <span className="truncate">{folder.name}</span>
            </h3>
            <p className="text-xs text-neutral-400 truncate mt-auto pointer-events-none">{folder.playlistIds.length} items</p>
          </div>
        );
      }
    });

    unfolderedPlaylists.forEach((pl) => gridItems.push(<ItemCard key={pl.id} item={pl} />));
    unfolderedAlbums.forEach((album) => gridItems.push(<ItemCard key={album.id} item={album} />));
  }

  return (
    <div 
      className="animate-fade-in pb-12 overflow-hidden min-h-[calc(100vh-200px)] flex flex-col"
      onDragOver={(e) => { 
        e.preventDefault(); 
        if (draggedItem?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
      }}
      onDrop={handleDropOnRoot}
    >
      {activeFolder ? (
        <div className="mb-8">
          <button onClick={() => setIsolatedFolderId(null)} className="flex items-center text-neutral-400 hover:text-white mb-6 transition-colors font-bold w-fit">
            <ChevronLeft className="w-5 h-5 mr-1" /> Back to Library
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-10 gap-4">
            <div className="flex items-center">
              <div className="w-16 h-16 bg-neutral-800 rounded-lg flex items-center justify-center mr-4 shadow-lg shrink-0 overflow-hidden">
                <FolderStack folder={activeFolder} items={allItems} />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Folder</span>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tighter truncate">{activeFolder.name}</h1>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <SizingControls />
              <button onClick={() => setIsManaging(!isManaging)} className={`px-6 py-2 rounded-full font-bold text-sm transition-colors ${isManaging ? 'bg-white text-black hover:scale-105' : 'border border-white/20 text-white hover:border-white'}`}>
                {isManaging ? 'Done Editing' : 'Manage Folder'}
              </button>
            </div>
          </div>
          
          {isManaging ? (
            <div className="space-y-12 animate-fade-in">
               <div>
                <h2 className="text-xl font-bold text-white mb-4">Click to Remove</h2>
                {activeFolder.playlistIds.length === 0 && <p className="text-neutral-500 italic">No items in this folder.</p>}
                <div className={`grid ${getGridClass()}`}>
                  {activeFolder.playlistIds.map(id => {
                    const item = allItems.find(p => p.id === id);
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
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className={`grid ${getGridClass()}`}>
              {activeFolder.playlistIds.length === 0 && (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-neutral-500 border-2 border-dashed border-neutral-800 rounded-xl">
                  <Folder className="w-12 h-12 mb-4 opacity-50" />
                  <p>This folder is empty.</p>
                  <button onClick={() => setIsManaging(true)} className="mt-4 text-white font-bold hover:underline">Add Items</button>
                </div>
              )}
              {activeFolder.playlistIds.map((id) => {
                const item = allItems.find(p => p.id === id);
                if (!item) return null;
                return (
                  <motion.div key={item.id} variants={{ hidden: { opacity: 0, y: 30, scale: 0.9 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}>
                    <ItemCard item={item} parentFolderId={activeFolder.id} />
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-4xl font-extrabold text-white tracking-tighter">Your Library</h1>
              <p className="text-sm text-neutral-400 mt-1">Create playlists and organize your collection.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setFolderDialogOpen(true)} className="px-5 py-2 rounded-full border border-white/20 text-white font-bold hover:bg-white/10 transition-all flex items-center">
                <FolderPlus className="w-4 h-4 mr-2" /> Folder
              </button>
              <button onClick={() => setPlaylistDialogOpen(true)} className="px-5 py-2 rounded-full bg-brand-gradient text-white text-black font-bold hover:bg-brand-gradient transition-all flex items-center">
                <Plus className="w-4 h-4 mr-2" /> Playlist
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