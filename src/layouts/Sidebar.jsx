import { useMemo, useRef, useState } from 'react';
import { Home, Library, Search, Folder, ChevronRight, ChevronDown, ChevronLeft, Plus, FolderPlus, Users, UserPlus, Heart } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { addTracksToPlaylist, createPlaylist, uploadPlaylistCoverImage } from '../services/spotify/api';
import PlaylistFormDialog from '../components/PlaylistFormDialog';
import FolderFormDialog from '../components/FolderFormDialog';
import AccountPanel from '../components/AccountPanel';
import { getUnfolderedItems, buildFolderTree, folderPath, isDescendant, byOrder } from '../utils/library';
import { rowButtonProps } from '../utils/a11y';
import { useSlice } from '../store/selectors';
import { artUrl } from '../utils/images';
import { TRACK_DRAG_TYPE } from '../utils/spotifyUri';
import { toast } from '../store/toastStore';

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
        {item.images?.[0]?.url ? <img src={artUrl(item.images, 32)} draggable="false" alt="" width="32" height="32" loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">💿</span>}
      </div>
      <span className="truncate pointer-events-none">{item.name}</span>
    </button>
  );
}

function FolderRow({ folder, depth, ctx }) {
  const { customFolders, itemsById, expandedFolders, draggedItem, dropTarget } = ctx;
  const isExpanded = expandedFolders.includes(folder.id);
  const children = ctx.childrenOf(folder.id);
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
          className="ml-2 p-0.5 rounded text-neutral-500 hover:text-white hover:bg-neutral-700 opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {isExpanded && (
        <div role="group" className="space-y-1 mt-1 mb-2">
          {children.map(child => <FolderRow key={child.id} folder={child} depth={depth + 1} ctx={ctx} />)}
          {folder.playlistIds.map(id => {
            const item = itemsById.get(id);
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
    token, profile, currentView, viewHistory, setCurrentView, playlists, albums, navigateToAlbum,
    navigateToPlaylist, customFolders, createFolder, activeFolderId, setActiveFolderId, requestFolderManage,
    draggedItem, setDraggedItem, reorderFolders, moveFolder,
    addPlaylistToFolder, removePlaylistFromFolder, reorderPlaylistInFolder, setContextMenu, setPlaylists, deleteFolder
  } = useSlice(useUserStore, [
    'token', 'profile', 'currentView', 'viewHistory', 'setCurrentView', 'playlists', 'albums', 'navigateToAlbum',
    'navigateToPlaylist', 'customFolders', 'createFolder', 'activeFolderId', 'setActiveFolderId', 'requestFolderManage',
    'draggedItem', 'setDraggedItem', 'reorderFolders', 'moveFolder',
    'addPlaylistToFolder', 'removePlaylistFromFolder', 'reorderPlaylistInFolder', 'setContextMenu', 'setPlaylists', 'deleteFolder'
  ]);
  
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
  const childrenOfMemo = (parentId) => byParent.get(parentId ?? null) || [];
  // Roots via the tree builder, not byParent(null): orphans and cycle members surface as roots
  const rootFolders = useMemo(() => buildFolderTree(customFolders).roots, [customFolders]);
  const { playlists: unfolderedPlaylists, albums: unfolderedAlbums } = getUnfolderedItems(playlists, albums, customFolders);
  
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

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
          toast(`Created "${name}", but the cover didn't upload`, { tone: 'error', duration: 5000 });
        }
      }

      setPlaylists([...playlists, newPlaylist]);
      navigateToPlaylist(newPlaylist.id);
    } catch (err) {
      console.error('Sidebar playlist creation failed:', err);
      toast(`Couldn't create "${name}"`, { tone: 'error' });
    }
  };

  const handleDragStart = (e, item) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => { setDraggedItem(item); }, 0);
  };

  // A song dragged in from the player bar. Only its types can be read until it is dropped.
  const isTrackDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(TRACK_DRAG_TYPE);
  // Only playlists you own or collaborate on can take a song; albums and followed playlists can't
  const takesSongs = (id) => {
    const p = playlists.find((x) => x.id === id);
    return Boolean(p && (p.owner?.id === profile?.id || p.collaborative));
  };

  const handleDragOver = (e, id) => { 
    e.preventDefault(); 
    e.stopPropagation();

    if (isTrackDrag(e)) {
      if (!takesSongs(id)) {
        e.dataTransfer.dropEffect = 'none';
        if (dragOverId) setDragOverId(null);
        return;
      }
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
    if (forbidden || isTrackDrag(e)) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = 'move';
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

    const plain = e.dataTransfer.getData('text/plain');
    const droppedUri = e.dataTransfer.getData(TRACK_DRAG_TYPE) || (plain.startsWith('spotify:track:') ? plain : '');

    if (droppedUri) {
      setDraggedItem(null);
      if (!takesSongs(targetPlaylistId)) return;
      const name = playlists.find((p) => p.id === targetPlaylistId)?.name || 'the playlist';
      try {
        await addTracksToPlaylist(token, targetPlaylistId, [droppedUri]);
        toast(`Added to ${name}`, { tone: 'success', duration: 1500 });
      } catch (err) {
        console.error('Failed to drop track:', err);
        toast(`Couldn't add it to ${name}`, { tone: 'error' });
      }
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
    customFolders, itemsById, childrenOf: childrenOfMemo, expandedFolders, draggedItem, dropTarget, dragOverId,
    toggleFolderExpand, handleDragStart, handleDragOver, handleDragLeave, handleDragEnd,
    handleFolderDragOver, handleFolderDragLeave, handleFolderDrop, handleDropOnPlaylist,
    setIsolatedFolderId, openManage, openFolderMenu, setContextMenu, navigateToAlbum, navigateToPlaylist
  };

  const activePath = activeFolder ? folderPath(customFolders, activeFolder.id) : [];
  const activeChildren = activeFolder ? childrenOfMemo(activeFolder.id) : [];

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'browse', label: 'Search', icon: Search },
    { id: 'library', label: 'Your Library', icon: Library },
    { id: 'sevens', label: 'Sevens', icon: Users },
    { id: 'friends', label: 'Friends', icon: UserPlus },
  ];
  // Which entry is lit. Pages that aren't entries themselves (a playlist, an album, a person)
  // light the section they belong to; an artist lights wherever you came from.
  const SECTION_OF = { playlist: 'library', album: 'library', 'liked-songs': 'library', user: 'friends' };
  const isNav = (view) => navItems.some((n) => n.id === view);
  const activeSection = isNav(currentView)
    ? currentView
    : SECTION_OF[currentView]
      || [...viewHistory].reverse().map((f) => (isNav(f.view) ? f.view : SECTION_OF[f.view]))?.find(Boolean)
      || 'library';

  return (
    <aside className="hidden md:flex w-64 xl:w-72 bg-black/40 backdrop-blur-md border-r border-white/5 flex-col px-3 py-4 space-y-3 select-none overflow-hidden h-full relative z-10">
      <div className="shrink-0 px-2"><img src="/Jomify-Logo.png" alt="Jomify" className="h-8 w-auto object-contain" /></div>

      <nav className="flex flex-col space-y-0.5 font-semibold shrink-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              // Navigate first so the history frame captures the folder you were in, then leave it
              onClick={() => { setCurrentView(item.id); setIsolatedFolderId(null); }}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors text-left ${isActive ? 'text-white font-bold bg-white/5' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-[var(--brand-mid)]' : ''}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Pinned above the folders, as Spotify keeps it at the top of Your Library */}
      <button
        type="button"
        onClick={() => { setCurrentView('liked-songs'); setIsolatedFolderId(null); }}
        aria-current={currentView === 'liked-songs' ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-lg px-2 py-1.5 shrink-0 transition-colors text-left font-semibold ${currentView === 'liked-songs' ? 'text-white bg-white/5' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
      >
        <span className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-700 to-blue-500 flex items-center justify-center shrink-0 shadow">
          <Heart className="w-4 h-4 fill-white text-white" />
        </span>
        <span className="truncate">Liked Songs</span>
      </button>

      <div 
        className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1 custom-scrollbar text-sm font-medium"
        onDragOver={(e) => { 
          e.preventDefault(); 
          if (isTrackDrag(e)) e.dataTransfer.dropEffect = 'none';
          else if (draggedItem?.parentFolderId) e.dataTransfer.dropEffect = 'move'; 
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
              <Folder className="w-5 h-5 mr-2 text-[var(--brand-mid)] fill-current shrink-0" /> <span className="truncate">{activeFolder.name}</span>
            </h3>
            <div role="tree" aria-label={`Folders in ${activeFolder.name}`} className="space-y-1">
              {activeChildren.map(child => <FolderRow key={child.id} folder={child} depth={0} ctx={rowCtx} />)}
            </div>
            <div className={`space-y-1 ${activeChildren.length ? 'mt-2 pt-2 border-t border-white/5' : ''}`}>
              {activeFolder.playlistIds.map(id => {
                const item = itemsById.get(id);
                if (!item) return null;
                return <ItemRow key={item.id} item={item} parentFolderId={activeFolder.id} indent={16} ctx={rowCtx} />;
              })}
            </div>
          </div>
        ) : (
          <div className="animate-fade-in space-y-1">
            <div className="sticky top-0 flex items-center justify-between px-2 pb-2 pt-1 text-neutral-400 bg-transparent backdrop-blur-[3px] border-b border-white/10 z-10">
              <span className="text-xs uppercase tracking-wider font-bold">Library</span>
              <div className="flex items-center gap-3">
                <button onClick={() => { setCreateParentId(null); setShowCreateFolderDialog(true); }} className="hover:text-white transition-colors" title="Create Folder"><FolderPlus className="w-4 h-4" /></button>
                <button onClick={() => setShowCreatePlaylistDialog(true)} className="hover:text-white transition-colors" title="Create Playlist"><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            <div role="tree" aria-label="Folders" className="space-y-1">
              {rootFolders.map(node => (
                <FolderRow key={node.folder.id} folder={node.folder} depth={0} ctx={rowCtx} />
              ))}
            </div>

            <div className="pt-2 space-y-1">
              {unfolderedPlaylists.filter(pl => pl.owner?.id !== 'spotify').map(pl => <ItemRow key={pl.id} item={pl} parentFolderId={null} indent={8} size={8} ctx={rowCtx} />)}
              {unfolderedAlbums.map(album => <ItemRow key={album.id} item={album} parentFolderId={null} indent={8} size={8} ctx={rowCtx} />)}
              {unfolderedPlaylists.some(pl => pl.owner?.id === 'spotify') && (
                <>
                  <p className="px-2 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Made for you</p>
                  {unfolderedPlaylists.filter(pl => pl.owner?.id === 'spotify').map(pl => <ItemRow key={pl.id} item={pl} parentFolderId={null} indent={8} size={8} ctx={rowCtx} />)}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <AccountPanel variant="footer" tagline={tagline} />

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