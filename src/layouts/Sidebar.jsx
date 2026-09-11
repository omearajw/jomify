import { useEffect, useRef, useState } from 'react';
import { Home, Library, Disc3, Folder, ChevronRight, ChevronDown, ChevronLeft, Plus, FolderPlus, Users } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { addTracksToPlaylist, createPlaylist, uploadPlaylistCoverImage } from '../services/spotify/api';
import PlaylistFormDialog from '../components/PlaylistFormDialog';
import FolderFormDialog from '../components/FolderFormDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { downloadBackup, parseBackup, applyBackup } from '../sync/backup';
import { useSyncStore } from '../store/syncStore';
import { isSafeToHardLogout } from '../sync/engine';
import { clearMeta } from '../sync/meta';
import { getUnfolderedItems, buildFolderTree, childrenOf, folderPath, isDescendant } from '../utils/library';
import { rowButtonProps } from '../utils/a11y';

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

function formatAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Where a folder drag would land on a row: the top and bottom quarters insert beside it, the
// middle drops inside. Everything else (playlists, albums, tracks) always goes inside.
function dropPositionFor(e, draggedItem) {
  if (draggedItem?.type !== 'folder') return 'into';
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  if (y < rect.height * 0.25) return 'before';
  if (y > rect.height * 0.75) return 'after';
  return 'into';
}

// Row components live at module scope: defining them inside Sidebar would give them a new
// identity every render and remount the whole list mid-drag, dropping the drag.
function ItemRow({ item, parentFolderId, indent, size = 6, ctx }) {
  const isAlbum = item.type === 'album';
  const isDragTarget = ctx.dragOverId === item.id;
  const dragType = isAlbum ? 'album' : 'playlist';
  return (
    <button
      draggable="true"
      onDragStart={(e) => ctx.handleDragStart(e, { type: dragType, id: item.id, parentFolderId })}
      onDragOver={(e) => ctx.handleDragOver(e, item.id)}
      onDragLeave={ctx.handleDragLeave}
      onDragEnd={ctx.handleDragEnd}
      onDrop={(e) => ctx.handleDropOnPlaylist(e, item.id, parentFolderId)}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        ctx.setContextMenu({ type: dragType, playlistId: isAlbum ? null : item.id, albumId: isAlbum ? item.id : null, parentFolderId, x: e.pageX, y: e.pageY });
      }}
      onClick={() => { if (isAlbum) ctx.navigateToAlbum(item.id); else ctx.navigateToPlaylist(item.id); }}
      style={{ paddingLeft: indent }}
      className={`w-full text-left pr-2 py-1.5 transition-colors rounded-md flex items-center group cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}
    >
      <div className={`${size === 8 ? 'w-8 h-8' : 'w-6 h-6'} rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none`}>
        {item.images?.[0]?.url ? <img src={item.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">💿</span>}
      </div>
      <span className="truncate pointer-events-none">{item.name}</span>
    </button>
  );
}

function FolderRow({ folder, depth, ctx }) {
  const { customFolders, allItems, expandedFolders, draggedItem, dropTarget } = ctx;
  const isExpanded = expandedFolders.includes(folder.id);
  const children = childrenOf(customFolders, folder.id);
  const target = dropTarget?.id === folder.id ? dropTarget.position : null;
  const forbidden = draggedItem?.type === 'folder'
    && (draggedItem.id === folder.id || isDescendant(customFolders, folder.id, draggedItem.id));
  const invites = !target && !forbidden && draggedItem && draggedItem.type !== 'track';
  const indent = 8 + depth * 16;

  return (
    <div className="flex flex-col" role="treeitem" aria-level={depth + 1} aria-expanded={isExpanded} aria-selected={false}>
      <div
        draggable="true"
        onDragStart={(e) => ctx.handleDragStart(e, { type: 'folder', id: folder.id, parentFolderId: folder.parentId ?? null })}
        onDragOver={(e) => ctx.handleFolderDragOver(e, folder, forbidden)}
        onDragLeave={(e) => ctx.handleFolderDragLeave(e, folder)}
        onDragEnd={ctx.handleDragEnd}
        onDrop={(e) => ctx.handleFolderDrop(e, folder, forbidden)}
        onClick={() => ctx.setIsolatedFolderId(folder.id)}
        {...rowButtonProps(() => ctx.setIsolatedFolderId(folder.id))}
        onContextMenu={(e) => ctx.openFolderMenu(e, folder)}
        style={{ paddingLeft: indent }}
        className={`relative flex items-center w-full pr-2 py-2 rounded-md cursor-pointer group transition-colors cursor-grab active:cursor-grabbing ${
          target === 'into' ? 'bg-[var(--brand-mid)]/20 border border-[var(--brand-mid)] text-white'
          : invites ? 'text-neutral-300 hover:bg-neutral-800/50 border border-dashed border-[var(--brand-mid)]/50 bg-[var(--brand-mid)]/10'
          : 'text-neutral-300 hover:text-white hover:bg-neutral-800/50'
        } ${forbidden ? 'opacity-40' : ''}`}
      >
        {(target === 'before' || target === 'after') && (
          <span aria-hidden="true" className={`pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-[var(--brand-mid)] ${target === 'before' ? '-top-px' : '-bottom-px'}`} />
        )}
        <button onClick={(e) => ctx.toggleFolderExpand(e, folder.id)} aria-label={isExpanded ? 'Collapse' : 'Expand'} className="p-0.5 hover:bg-neutral-700 rounded text-neutral-400 hover:text-white mr-1 transition-colors">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <Folder className="w-4 h-4 mr-3 shrink-0 pointer-events-none" />
        <span className="truncate pointer-events-none flex-1">{folder.name}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); ctx.openManage(folder.id); }}
          aria-label={`Add items to ${folder.name}`}
          title="Add items"
          className="ml-2 p-0.5 rounded text-neutral-500 hover:text-white hover:bg-neutral-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {isExpanded && (
        <div role="group" className="space-y-1 mt-1 mb-2">
          {children.map(child => <FolderRow key={child.id} folder={child} depth={depth + 1} ctx={ctx} />)}
          {folder.playlistIds.map(id => {
            const item = allItems.find(p => p.id === id);
            if (!item) return null;
            return <ItemRow key={item.id} item={item} parentFolderId={folder.id} indent={indent + 28} ctx={ctx} />;
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const {
    token, profile, currentView, setCurrentView, logout, playlists, albums, navigateToAlbum,
    navigateToPlaylist, customFolders, createFolder, activeFolderId, setActiveFolderId, requestFolderManage,
    draggedItem, setDraggedItem, reorderFolders, moveFolder,
    addPlaylistToFolder, removePlaylistFromFolder, reorderPlaylistInFolder, setContextMenu, setPlaylists, deleteFolder
  } = useUserStore();
  
  // Folder isolation lives in the store so the sidebar and the Library view agree, the global
  // Back button can restore it, and a pinned folder on Home can open it. These aliases keep the
  // rest of this file untouched.
  const isolatedFolderId = activeFolderId;
  const setIsolatedFolderId = setActiveFolderId;
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [dragOverId, setDragOverId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: 'before' | 'into' | 'after' } for folder rows
  const [showCreatePlaylistDialog, setShowCreatePlaylistDialog] = useState(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [createParentId, setCreateParentId] = useState(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const activeFolder = customFolders.find(f => f.id === isolatedFolderId);
  const allItems = [...playlists, ...(albums || [])];
  const { playlists: unfolderedPlaylists, albums: unfolderedAlbums } = getUnfolderedItems(playlists, albums, customFolders);
  
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

  // --- SYNC STATUS ---
  // Deliberately low-key, but never absent: a CORS or config failure is otherwise completely
  // silent, and the worst outcome is believing your folders are backed up when they are not.
  const syncStatus = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const [, forceTick] = useState(0);

  useEffect(() => {
    // Keeps "Synced 2m ago" honest without re-rendering the sidebar constantly
    const id = setInterval(() => forceTick(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const syncLabel = (() => {
    switch (syncStatus) {
      case 'pulling':
      case 'pushing': return { text: 'Syncing…', isError: false };
      case 'offline': return { text: 'Offline — will sync when reconnected', isError: false };
      case 'error': return { text: 'Sync paused — retrying', isError: true };
      case 'disabled': return { text: 'Sync is off', isError: true };
      default:
        if (!lastSyncedAt) return { text: 'Not synced yet', isError: false };
        return { text: `Synced ${formatAgo(lastSyncedAt)}`, isError: false };
    }
  })();

  // --- LOCAL BACKUP / RESTORE ---
  const backupFileInputRef = useRef(null);
  const [backupMessage, setBackupMessage] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);

  const flashBackupMessage = (text, isError = false) => {
    setBackupMessage({ text, isError });
    setTimeout(() => setBackupMessage(null), 6000);
  };

  const handleExportBackup = () => {
    try {
      const backup = downloadBackup();
      flashBackupMessage(`Saved ${backup.counts.folders} folders and ${backup.counts.pins} pins.`);
    } catch (err) {
      console.error('Backup failed:', err);
      flashBackupMessage('Backup failed. See the console for details.', true);
    }
  };

  const handleRestoreFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Let the same file be picked again after a cancel
    if (!file) return;

    try {
      setPendingRestore(parseBackup(await file.text()));
    } catch (err) {
      flashBackupMessage(err.message, true);
    }
  };

  // --- DISCONNECT ---
  // A deliberate disconnect clears this device's copy of the synced data, but only once that
  // data is demonstrably on the server. Note that the involuntary logout() calls in App.jsx --
  // on a failed token refresh or an expiry -- stay soft, because wiping folders over a transient
  // network blip is exactly the bug commit ea508a9 fixed.
  const handleDisconnect = () => {
    const canHardClear = isSafeToHardLogout();
    if (canHardClear) clearMeta();
    logout({ hard: canHardClear });
    window.location.href = '/';
  };

  const handleConfirmRestore = () => {
    try {
      applyBackup(pendingRestore);
      flashBackupMessage('Backup restored.');
    } catch (err) {
      console.error('Restore failed:', err);
      flashBackupMessage('Restore failed. See the console for details.', true);
    } finally {
      setPendingRestore(null);
    }
  };

  const toggleFolderExpand = (e, folderId) => {
    e.stopPropagation();
    setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);
  };

  // Spring-loaded folders: hover anything draggable over a collapsed folder for a moment and it
  // opens, so the drop can land on something inside it without expanding the folder first with
  // the other hand. One timer per folder, so crossing several rows doesn't cancel the first.
  const springTimers = useRef(new Map());
  const armSpringLoad = (folderId) => {
    if (springTimers.current.has(folderId)) return;
    springTimers.current.set(folderId, setTimeout(() => {
      setExpandedFolders(prev => (prev.includes(folderId) ? prev : [...prev, folderId]));
      springTimers.current.delete(folderId);
    }, 600));
  };
  const disarmSpringLoad = (folderId) => {
    const timer = springTimers.current.get(folderId);
    if (timer) { clearTimeout(timer); springTimers.current.delete(folderId); }
  };
  const disarmAllSpringLoads = () => {
    springTimers.current.forEach(clearTimeout);
    springTimers.current.clear();
  };

  const closeFolderDialog = () => { setShowCreateFolderDialog(false); setCreateParentId(null); };

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
      navigateToPlaylist(newPlaylist.id);
    } catch (err) {
      console.error('Sidebar playlist creation failed:', err);
    }
  };

  const handleDragStart = (e, item) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => { setDraggedItem(item); }, 0);
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

  const handleDragLeave = () => setDragOverId(null);
  const handleDragEnd = () => { setDraggedItem(null); setDragOverId(null); setDropTarget(null); disarmAllSpringLoads(); };

  const handleFolderDragOver = (e, folder, forbidden) => {
    e.preventDefault(); e.stopPropagation();
    if (forbidden) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = draggedItem?.type === 'track' ? 'copy' : 'move';
    const position = dropPositionFor(e, draggedItem);
    if (dropTarget?.id !== folder.id || dropTarget.position !== position) setDropTarget({ id: folder.id, position });
    if (position === 'into') armSpringLoad(folder.id); else disarmSpringLoad(folder.id);
  };

  const handleFolderDragLeave = (e, folder) => {
    // dragleave also fires when the pointer crosses into a child element of the same row
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setDropTarget(prev => (prev?.id === folder.id ? null : prev));
    disarmSpringLoad(folder.id);
  };

  const handleFolderDrop = (e, folder, forbidden) => {
    e.preventDefault(); e.stopPropagation();
    const position = dropPositionFor(e, draggedItem);
    setDropTarget(null);
    disarmSpringLoad(folder.id);
    if (!draggedItem || forbidden) return;

    if (draggedItem.type === 'folder' && draggedItem.id !== folder.id) {
      if (position === 'into') moveFolder(draggedItem.id, folder.id);
      else reorderFolders(draggedItem.id, folder.id, position);
    } else if (draggedItem.type === 'playlist' || draggedItem.type === 'album') {
      addPlaylistToFolder(folder.id, draggedItem.id);
    }
    setDraggedItem(null);
  };

  const handleDropOnPlaylist = async (e, targetPlaylistId, parentFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);

    const droppedUri = e.dataTransfer.getData('text/plain');

    if (droppedUri && droppedUri.includes('spotify:track:')) {
      try {
        await addTracksToPlaylist(token, targetPlaylistId, [droppedUri]);
      } catch (err) {
        console.error('Failed to drop track:', err);
      }
      setDraggedItem(null);
      return;
    }

    if (!draggedItem || (draggedItem.type !== 'playlist' && draggedItem.type !== 'album') || !parentFolderId) return;

    if (draggedItem.parentFolderId === parentFolderId && draggedItem.id !== targetPlaylistId) {
      reorderPlaylistInFolder(parentFolderId, draggedItem.id, targetPlaylistId);
    }
    setDraggedItem(null);
  };

  // NEW: Catch items dropped into the empty space of the sidebar to remove them from folders
  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedItem) return;

    // Only unfolder if it's an item that actually came from a folder
    if ((draggedItem.type === 'playlist' || draggedItem.type === 'album') && draggedItem.parentFolderId) {
      removePlaylistFromFolder(draggedItem.parentFolderId, draggedItem.id);
    } else if (draggedItem.type === 'folder' && draggedItem.parentFolderId) {
      // Empty space means "the level I'm looking at": the top level, or the open folder
      moveFolder(draggedItem.id, activeFolder ? activeFolder.id : null);
    }
    setDraggedItem(null);
  };

  const openManage = (folderId) => {
    // Navigate first so the history frame records where you came from
    setCurrentView('library');
    setIsolatedFolderId(folderId);
    requestFolderManage(folderId);
  };

  const openFolderMenu = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: 'folder', folderId: folder.id, folderName: folder.name, x: e.pageX, y: e.pageY,
      onDelete: () => { deleteFolder(folder.id); setContextMenu(null); }
    });
  };

  // Everything the module-scope rows need from this render
  const rowCtx = {
    customFolders, allItems, expandedFolders, draggedItem, dropTarget, dragOverId,
    toggleFolderExpand, handleDragStart, handleDragOver, handleDragLeave, handleDragEnd,
    handleFolderDragOver, handleFolderDragLeave, handleFolderDrop, handleDropOnPlaylist,
    setIsolatedFolderId, openManage, openFolderMenu, setContextMenu, navigateToAlbum, navigateToPlaylist
  };

  const activePath = activeFolder ? folderPath(customFolders, activeFolder.id) : [];
  const activeChildren = activeFolder ? childrenOf(customFolders, activeFolder.id) : [];

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'browse', label: 'Browse', icon: Disc3 },
    { id: 'library', label: 'Your Library', icon: Library },
    { id: 'sevens', label: 'Sevens', icon: Users },
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
              key={item.id}
              // Navigate first so the history frame captures the folder you were in, then leave it
              onClick={() => { setCurrentView(item.id); setIsolatedFolderId(null); }}
              className={`flex items-center space-x-4 transition-colors duration-200 text-left ${isActive ? 'text-white font-bold' : 'text-neutral-400 hover:text-white'}`}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-[var(--brand-mid)]' : 'text-neutral-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div 
        className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-1 custom-scrollbar text-sm font-medium"
        onDragOver={(e) => { 
          e.preventDefault(); 
          if (draggedItem?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
        }}
        onDrop={handleDropOnRoot}
      >
        
        {activeFolder ? (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setIsolatedFolderId(activeFolder.parentId ?? null)} className="flex items-center text-neutral-400 hover:text-white transition-colors group">
                <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" /> Back
              </button>
              <button
                type="button"
                onClick={() => { setCreateParentId(activeFolder.id); setShowCreateFolderDialog(true); }}
                title={`New subfolder in ${activeFolder.name}`}
                aria-label={`New subfolder in ${activeFolder.name}`}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
            <nav aria-label="Folder path" className="flex items-center flex-wrap gap-x-1 px-2 mb-2 text-xs text-neutral-500">
              <button onClick={() => setIsolatedFolderId(null)} className="hover:text-white transition-colors">Library</button>
              {activePath.slice(0, -1).map(crumb => (
                <span key={crumb.id} className="flex items-center gap-x-1">
                  <ChevronRight className="w-3 h-3" />
                  <button onClick={() => setIsolatedFolderId(crumb.id)} className="hover:text-white transition-colors truncate max-w-[6rem]">{crumb.name}</button>
                </span>
              ))}
            </nav>
            <h3 className="text-white font-bold text-lg px-2 mb-3 flex items-center">
              <Folder className="w-5 h-5 mr-2 text-brand-gradient fill-current shrink-0" /> <span className="truncate">{activeFolder.name}</span>
            </h3>
            <div role="tree" aria-label={`Folders in ${activeFolder.name}`} className="space-y-1">
              {activeChildren.map(child => <FolderRow key={child.id} folder={child} depth={0} ctx={rowCtx} />)}
            </div>
            <div className={`space-y-1 ${activeChildren.length ? 'mt-2 pt-2 border-t border-white/5' : ''}`}>
              {activeFolder.playlistIds.map(id => {
                const item = allItems.find(p => p.id === id);
                if (!item) return null;
                return <ItemRow key={item.id} item={item} parentFolderId={activeFolder.id} indent={16} ctx={rowCtx} />;
              })}
            </div>
          </div>
        ) : (
          <div className="animate-fade-in space-y-1">
            <div className="sticky top-0 flex items-center justify-between px-2 pb-3 pt-3 text-neutral-400 bg-transparent backdrop-blur-[3px] border-b border-t border-white/10 z-10">
              <span className="text-xs uppercase tracking-wider font-bold">Library</span>
              <div className="flex items-center gap-3">
                <button onClick={() => { setCreateParentId(null); setShowCreateFolderDialog(true); }} className="hover:text-white transition-colors" title="Create Folder"><FolderPlus className="w-4 h-4" /></button>
                <button onClick={() => setShowCreatePlaylistDialog(true)} className="hover:text-white transition-colors" title="Create Playlist"><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            <div role="tree" aria-label="Folders" className="space-y-1">
              {buildFolderTree(customFolders).roots.map(node => (
                <FolderRow key={node.folder.id} folder={node.folder} depth={0} ctx={rowCtx} />
              ))}
            </div>

            <div className="pt-2 space-y-1">
              {unfolderedPlaylists.map(pl => <ItemRow key={pl.id} item={pl} parentFolderId={null} indent={8} size={8} ctx={rowCtx} />)}
              {unfolderedAlbums.map(album => <ItemRow key={album.id} item={album} parentFolderId={null} indent={8} size={8} ctx={rowCtx} />)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-neutral-800 pt-6 flex flex-col space-y-2 text-xs text-neutral-600 shrink-0">
        <p>{tagline}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleExportBackup} className="text-left hover:text-white transition-colors">Back up data</button>
          <span className="w-1 h-1 rounded-full bg-neutral-700" />
          <button onClick={() => backupFileInputRef.current?.click()} className="text-left hover:text-white transition-colors">Restore</button>
        </div>
        {backupMessage && (
          <p className={backupMessage.isError ? 'text-red-400' : 'text-[var(--brand-start)]'}>{backupMessage.text}</p>
        )}
        <input
          ref={backupFileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleRestoreFileChosen}
          className="hidden"
        />
        <p className={syncLabel.isError ? 'text-red-400' : 'text-neutral-600'}>{syncLabel.text}</p>
        <button onClick={handleDisconnect} className="text-left hover:text-white transition-colors">Disconnect Account</button>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title="Restore this backup?"
        message={pendingRestore
          ? `This replaces your current folders and pins with the backup from ${new Date(pendingRestore.exportedAt).toLocaleString()} (${pendingRestore.counts?.folders ?? 0} folders, ${pendingRestore.counts?.pins ?? 0} pins). Your current local data will be overwritten.`
          : ''}
        confirmLabel="Restore"
        onConfirm={handleConfirmRestore}
        onCancel={() => setPendingRestore(null)}
      />

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
        title={createParentId ? 'Create subfolder' : 'Create folder'}
        submitLabel="Create"
        parentLabel={createParentId ? customFolders.find(f => f.id === createParentId)?.name : ''}
        onSubmit={handleCreateFolder}
        onCancel={closeFolderDialog}
        isSubmitting={isCreatingFolder}
      />
    </aside>
  );
}