import { useRef, useState } from 'react';
import { Home, Library, Disc3, Folder, ChevronRight, ChevronDown, ChevronLeft, Plus, FolderPlus } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { addTracksToPlaylist, createPlaylist, uploadPlaylistCoverImage } from '../services/spotify/api';
import PlaylistFormDialog from '../components/PlaylistFormDialog';
import FolderFormDialog from '../components/FolderFormDialog';

const TAGLINES = [
  "All my homies HATE Spotify!",
  "Spotify done right.",
  "Doing what Spotify won't.",
  "Let me show you how the boss does it - Phoenix.",
  "Hello Father",
  "Nobody wants to watch 'episodes'.",
  "Bloatless.",
  "Jomify, best in the biz.",
  "The best of the Omifys.",
  "Nobody does it better.",
  "The way it should be done.",
  "Spotify... shitify"
];

// Added onClose prop
export default function Sidebar({ onClose }) {
  const { 
    token, profile, currentView, setCurrentView, logout, playlists, albums, activePlaylistId, navigateToAlbum,
    setActivePlaylistId, customFolders, createFolder,
    draggedItem, setDraggedItem, reorderFolders, 
    addPlaylistToFolder, removePlaylistFromFolder, reorderPlaylistInFolder, setContextMenu, setPlaylists, deleteFolder
  } = useUserStore();
  
  const [isolatedFolderId, setIsolatedFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [dragOverId, setDragOverId] = useState(null);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const dragItemRef = useRef(null);
  const touchDragItemRef = useRef(null);
  const touchPendingRef = useRef(null);
  const [showCreatePlaylistDialog, setShowCreatePlaylistDialog] = useState(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const activeFolder = customFolders.find(f => f.id === isolatedFolderId);
  const unfolderedPlaylists = playlists.filter(p => !customFolders.some(f => f.playlistIds.includes(p.id)));
  const unfolderedAlbums = (albums || []).filter(a => !customFolders.some(f => f.playlistIds.includes(a.id)));
  
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

  const toggleFolderExpand = (e, folderId) => {
    e.stopPropagation();
    setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);
  };

  const handleCreateFolder = async ({ name }) => {
    if (!name || !name.trim()) return;
    setIsCreatingFolder(true);
    try {
      createFolder(name.trim());
      setShowCreateFolderDialog(false);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleCreatePlaylistFromSidebar = async ({ name, description, imageFile }) => {
    if (!token || !profile?.id) return;
    setShowCreatePlaylistDialog(false);

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
      onClose?.(); // Close mobile sidebar after creation
    } catch (err) {
      console.error('Sidebar playlist creation failed:', err);
    }
  };

  const clearDragState = () => {
    setDraggedItem(null);
    setDragOverId(null);
    setIsTouchDragging(false);
    dragItemRef.current = null;
    touchDragItemRef.current = null;
    touchPendingRef.current = null;
  };

  const getActiveDraggedItem = () => dragItemRef.current || touchDragItemRef.current || draggedItem;

  const safelyPreventDefault = (e) => {
    if (e?.cancelable) e.preventDefault();
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
    safelyPreventDefault(e);

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
    safelyPreventDefault(e);
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
    e.dataTransfer.setData('application/x-jomify-item', JSON.stringify(item));
    dragItemRef.current = item;
  };

  const handleDragOver = (e, id) => { 
    e.preventDefault(); 
    e.stopPropagation();
    const activeDraggedItem = getActiveDraggedItem();
    
    if (activeDraggedItem?.type === 'track') {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDragLeave = () => {};
  const handleDragEnd = () => clearDragState();

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);
    let activeDraggedItem = getActiveDraggedItem();
    if (!activeDraggedItem) {
      try {
        activeDraggedItem = JSON.parse(e.dataTransfer.getData('application/x-jomify-item') || 'null');
      } catch {
        activeDraggedItem = null;
      }
    }
    resolveDropAction(activeDraggedItem, { kind: 'folder', id: targetFolderId });
    clearDragState();
  };

  const handleDropOnPlaylist = async (e, targetPlaylistId, parentFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);

    const droppedUri = e.dataTransfer.getData('text/plain');

    if (droppedUri && droppedUri.includes('spotify:track:')) {
      try {
        await addTracksToPlaylist(token, targetPlaylistId, [droppedUri]);
        console.log('Successfully added track via Sidebar!');
      } catch (err) {
        console.error('Failed to drop track:', err);
      }
      setDraggedItem(null);
      return;
    }

    let activeDraggedItem = getActiveDraggedItem();
    if (!activeDraggedItem) {
      try {
        activeDraggedItem = JSON.parse(e.dataTransfer.getData('application/x-jomify-item') || 'null');
      } catch {
        activeDraggedItem = null;
      }
    }

    resolveDropAction(activeDraggedItem, { kind: 'item', id: targetPlaylistId, parentFolderId });
    clearDragState();
  };

  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDragOverId(null);
    let activeDraggedItem = getActiveDraggedItem();
    if (!activeDraggedItem) {
      try {
        activeDraggedItem = JSON.parse(e.dataTransfer.getData('application/x-jomify-item') || 'null');
      } catch {
        activeDraggedItem = null;
      }
    }
    resolveDropAction(activeDraggedItem, { kind: 'root' });
    clearDragState();
  };

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'browse', label: 'Browse', icon: Disc3 },
    { id: 'library', label: 'Your Library', icon: Library },
  ];

  return (
    <aside className="w-64 bg-black/40 backdrop-blur-md border-r border-white/5 flex flex-col p-6 space-y-6 select-none overflow-hidden h-full relative z-10">
      <div className="text-brand-gradient font-extrabold text-3xl tracking-tighter shrink-0"><img src="/Jomify-Logo.png" alt="Jomify" className="w-30 object-contain"/></div>
      
      <nav className="flex flex-col space-y-4 font-semibold shrink-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={`nav-${item.id}`}
              onClick={() => { setIsolatedFolderId(null); setCurrentView(item.id); onClose?.(); }}
              className={`flex items-center space-x-4 transition-colors duration-200 text-left ${isActive ? 'text-white font-bold' : 'text-neutral-400 hover:text-white'}`}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-[var(--brand-mid)]' : 'text-neutral-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div 
        data-drop-kind="root"
        className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-1 custom-scrollbar text-sm font-medium"
        style={isTouchDragging ? { touchAction: 'none' } : undefined}
        onDragOver={(e) => { 
          e.preventDefault(); 
          if (getActiveDraggedItem()?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
        }}
        onDrop={handleDropOnRoot}
        onTouchMove={handleTouchDragMove}
        onTouchEnd={handleTouchDragEnd}
        onTouchCancel={handleDragEnd}
      >
        
        {activeFolder ? (
          <div className="animate-fade-in">
            <button onClick={() => setIsolatedFolderId(null)} className="flex items-center text-neutral-400 hover:text-white mb-4 transition-colors group">
              <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" /> Back
            </button>
            <h3 className="text-white font-bold text-lg px-2 mb-3 flex items-center">
              <Folder className="w-5 h-5 mr-2 text-brand-gradient fill-current" /> {activeFolder.name}
            </h3>
            <div className="space-y-1 pl-2">
              {activeFolder.playlistIds.map((id, idx) => {
                const item = playlists.find(p => p.id === id) || (albums && albums.find(a => a.id === id));
                if (!item) return null;
                const isAlbum = item.type === 'album';
                const isDragTarget = dragOverId === item.id;
                
                return (
                  <button 
                    key={`active-folder-${id}-${idx}`} 
                    draggable="true"
                    data-drop-kind="item"
                    data-drop-id={item.id}
                    data-parent-folder-id={activeFolder.id}
                    onDragStart={(e) => handleDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId: activeFolder.id })}
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd} 
                    onDrop={(e) => handleDropOnPlaylist(e, item.id, activeFolder.id)}
                    onTouchStart={(e) => handleTouchDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId: activeFolder.id })}
                    onTouchMove={handleTouchDragMove}
                    onTouchEnd={handleTouchDragEnd}
                    onTouchCancel={handleDragEnd}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setContextMenu({ type: isAlbum ? 'album' : 'playlist', playlistId: isAlbum ? null : item.id, albumId: isAlbum ? item.id : null, parentFolderId: activeFolder.id, x: e.pageX, y: e.pageY });
                    }}
                    onClick={() => {
                      if (isTouchDragging) return;
                      if (isAlbum) navigateToAlbum(item.id);
                      else { setActivePlaylistId(item.id); setCurrentView('playlist'); }
                      onClose?.();
                    }}
                    className={`w-full text-left px-2 py-1.5 transition-colors flex items-center group cursor-grab active:cursor-grabbing rounded-md ${isDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white' : 'text-neutral-400 hover:text-white'}`}
                  >
                    <div className="w-6 h-6 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                      {item.images?.[0]?.url ? <img src={item.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">🎵</span>}
                    </div>
                    <span className="truncate pointer-events-none">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-fade-in space-y-1">
            <div className="sticky top-0 flex items-center justify-between px-2 pb-3 pt-3 text-neutral-400 bg-transparent backdrop-blur-[3px] border-b border-t border-white/10 z-10">
              <span className="text-xs uppercase tracking-wider font-bold">Library</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCreateFolderDialog(true)} className="hover:text-white transition-colors" title="Create Folder"><FolderPlus className="w-4 h-4" /></button>
                <button onClick={() => setShowCreatePlaylistDialog(true)} className="hover:text-white transition-colors" title="Create Playlist"><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            {customFolders.map((folder, folderIdx) => {
              const isExpanded = expandedFolders.includes(folder.id);
              const isDragTarget = dragOverId === folder.id;
              
              return (
                <div key={`folder-${folder.id}-${folderIdx}`} className="flex flex-col">
                  <div 
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        type: 'folder', folderId: folder.id, folderName: folder.name, x: e.pageX, y: e.pageY,
                        onDelete: () => { deleteFolder(folder.id); if (isolatedFolderId === folder.id) setIsolatedFolderId(null); setContextMenu(null); }
                      });
                    }}
                    className={`flex items-center w-full px-2 py-2 rounded-md cursor-pointer group transition-colors cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white' : (draggedItem?.type === 'playlist' || draggedItem?.type === 'album') ? 'text-neutral-300 hover:bg-neutral-800/50 border border-dashed border-[var(--brand-mid)]/50 bg-[var(--brand-mid)]/10' : 'text-neutral-300 hover:text-white hover:bg-neutral-800/50'}`}
                  >
                    <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="p-0.5 hover:bg-neutral-700 rounded text-neutral-400 hover:text-white mr-1 transition-colors">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <Folder className="w-4 h-4 mr-3 shrink-0 pointer-events-none" />
                    <span className="truncate pointer-events-none">{folder.name}</span>
                  </div>
                  
                  {isExpanded && (
                    <div className="pl-9 pr-2 space-y-1 mt-1 mb-2">
                      {folder.playlistIds.map((id, idx) => {
                        const item = playlists.find(p => p.id === id) || (albums && albums.find(a => a.id === id));
                        if (!item) return null;
                        const isAlbum = item.type === 'album';
                        const isSubDragTarget = dragOverId === item.id;
                        return (
                          <button 
                            key={`folder-${folder.id}-item-${item.id}-${idx}`}
                            draggable="true"
                            data-drop-kind="item"
                            data-drop-id={item.id}
                            data-parent-folder-id={folder.id}
                            onDragStart={(e) => handleDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId: folder.id })}
                            onDragOver={(e) => handleDragOver(e, item.id)}
                            onDragLeave={handleDragLeave}
                            onDragEnd={handleDragEnd} 
                            onDrop={(e) => handleDropOnPlaylist(e, item.id, folder.id)}
                            onTouchStart={(e) => handleTouchDragStart(e, { type: isAlbum ? 'album' : 'playlist', id: item.id, parentFolderId: folder.id })}
                            onTouchMove={handleTouchDragMove}
                            onTouchEnd={handleTouchDragEnd}
                            onTouchCancel={handleDragEnd}
                            onContextMenu={(e) => {
                              e.preventDefault(); e.stopPropagation();
                              setContextMenu({ type: isAlbum ? 'album' : 'playlist', playlistId: isAlbum ? null : item.id, albumId: isAlbum ? item.id : null, parentFolderId: folder.id, x: e.pageX, y: e.pageY });
                            }}
                            onClick={() => {
                              if (isTouchDragging) return;
                              if (isAlbum) navigateToAlbum(item.id);
                              else { setActivePlaylistId(item.id); setCurrentView('playlist'); }
                              onClose?.();
                            }}
                            className={`w-full text-left py-1.5 transition-colors flex items-center group cursor-grab active:cursor-grabbing rounded ${isSubDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white px-2 -ml-2' : 'text-neutral-400 hover:text-white'}`}
                          >
                            <div className="w-6 h-6 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                              {item.images?.[0]?.url ? <img src={item.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">🎵</span>}
                            </div>
                            <span className="truncate pointer-events-none">{item.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-2 space-y-1">
              {unfolderedPlaylists.map((pl, idx) => {
                const isDragTarget = dragOverId === pl.id; 
                return (
                  <button 
                    key={`unfoldered-pl-${pl.id}-${idx}`}
                    draggable="true"
                    data-drop-kind="item"
                    data-drop-id={pl.id}
                    data-parent-folder-id=""
                    onDragStart={(e) => handleDragStart(e, { type: 'playlist', id: pl.id, parentFolderId: null })}
                    onDragOver={(e) => handleDragOver(e, pl.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDropOnPlaylist(e, pl.id, null)} 
                    onTouchStart={(e) => handleTouchDragStart(e, { type: 'playlist', id: pl.id, parentFolderId: null })}
                    onTouchMove={handleTouchDragMove}
                    onTouchEnd={handleTouchDragEnd}
                    onTouchCancel={handleDragEnd}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setContextMenu({ type: 'playlist', playlistId: pl.id, parentFolderId: null, x: e.pageX, y: e.pageY });
                    }}
                    onClick={() => {
                      if (isTouchDragging) return;
                      setActivePlaylistId(pl.id);
                      setCurrentView('playlist');
                      onClose?.();
                    }}
                    className={`w-full text-left px-2 py-1.5 transition-colors rounded-md flex items-center group cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}
                  >
                    <div className="w-8 h-8 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                      {pl.images?.[0]?.url ? <img src={pl.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">🎵</span>}
                    </div>
                    <span className="truncate pointer-events-none">{pl.name}</span>
                  </button>
                );
              })}

              {unfolderedAlbums.map((album, idx) => {
                const isDragTarget = dragOverId === album.id;
                return (
                  <button 
                    key={`unfoldered-al-${album.id}-${idx}`}
                    draggable="true"
                    data-drop-kind="item"
                    data-drop-id={album.id}
                    data-parent-folder-id=""
                    onDragStart={(e) => handleDragStart(e, { type: 'album', id: album.id, parentFolderId: null })}
                    onDragOver={(e) => handleDragOver(e, album.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDropOnPlaylist(e, album.id, null)} 
                    onTouchStart={(e) => handleTouchDragStart(e, { type: 'album', id: album.id, parentFolderId: null })}
                    onTouchMove={handleTouchDragMove}
                    onTouchEnd={handleTouchDragEnd}
                    onTouchCancel={handleDragEnd}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setContextMenu({ type: 'album', albumId: album.id, parentFolderId: null, x: e.pageX, y: e.pageY });
                    }}
                    onClick={() => {
                      if (isTouchDragging) return;
                      navigateToAlbum(album.id);
                      onClose?.();
                    }}
                    className={`w-full text-left px-2 py-1.5 transition-colors rounded-md flex items-center group cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}
                  >
                    <div className="w-8 h-8 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                      {album.images?.[0]?.url ? <img src={album.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">🎵</span>}
                    </div>
                    <span className="truncate pointer-events-none">{album.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-neutral-800 pt-6 flex flex-col space-y-2 text-xs text-neutral-600 shrink-0">
        <p>{tagline}</p>
        <button onClick={() => { logout(); window.location.href = "/"; }} className="text-left hover:text-white transition-colors">Disconnect Account</button>
      </div>

      <PlaylistFormDialog
        open={showCreatePlaylistDialog}
        title="Create playlist"
        submitLabel="Create"
        onSubmit={handleCreatePlaylistFromSidebar}
        onCancel={() => setShowCreatePlaylistDialog(false)}
        isSubmitting={false}
      />
      <FolderFormDialog
        open={showCreateFolderDialog}
        title="Create folder"
        submitLabel="Create"
        onSubmit={handleCreateFolder}
        onCancel={() => setShowCreateFolderDialog(false)}
        isSubmitting={isCreatingFolder}
      />
    </aside>
  );
}