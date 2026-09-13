import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { resolvePlaybackDeviceId, handlePlaybackError } from '../services/spotify/playbackController';
import { addToQueue, addTracksToPlaylist, removeTrackFromPlaylist, unfollowPlaylist, unsaveAlbum } from '../services/spotify/api';
import { ListPlus, Plus, ChevronRight, ChevronDown, ChevronUp, Folder, Trash2, FolderPlus, Pin, PinOff, Pencil, CornerDownRight } from 'lucide-react';
import FolderFormDialog from './FolderFormDialog';
import { toast } from '../store/toastStore';
import { flattenFolderTree, descendantIds, childrenOf } from '../utils/library';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useSlice } from '../store/selectors';

// One picker for every "Move to…" list: playlists, albums and folders. Rows are indented by
// depth and labelled with their path so two "Favourites" folders in different places can be
// told apart. `excludeIds` hides a folder and its subtree (a folder can't move into itself).
function MoveToList({ folders, currentParentId, excludeIds, allowRoot = false, onPick, footer }) {
  const rows = flattenFolderTree(folders, { exclude: excludeIds || new Set() });
  return (
    <div className="max-h-[40dvh] md:max-h-48 overflow-y-auto custom-scrollbar">
      {allowRoot && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(null); }}
          disabled={currentParentId === null}
          className="w-full text-left px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate"
        >
          Top level
        </button>
      )}
      {rows.map(({ folder, depth, path }) => (
        <button
          key={folder.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(folder.id); }}
          disabled={folder.id === currentParentId}
          title={path.join(' › ')}
          style={{ paddingLeft: 16 + depth * 12 }}
          className="w-full text-left pr-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate flex items-center gap-2"
        >
          {depth > 0 && <CornerDownRight className="w-3 h-3 text-neutral-600 shrink-0" />}
          <span className="truncate">{folder.name}</span>
        </button>
      ))}
      {footer}
    </div>
  );
}

const MENU_WIDTH = 224;     // w-56
const SUBMENU_WIDTH = 256;  // w-64
const VIEWPORT_PAD = 8;
import ConfirmDialog from './ConfirmDialog';
import { getUnfolderedItems } from '../utils/library';

export default function ContextMenu() {
  const {
    contextMenu, setContextMenu, token, triggerQueueRefresh,
    addManuallyQueuedTrack,
    playlists, customFolders, profile, deletePlaylist, deleteFolder, setCurrentView, setActivePlaylistId, activePlaylistId,
    removeAlbumFromLibrary, addPlaylistToFolder, removePlaylistFromFolder, renameFolder, createFolder, moveFolder,
    reorderFolders, reorderPlaylistInFolder,
    pinnedItems, togglePin
  } = useSlice(useUserStore, [
    'contextMenu', 'setContextMenu', 'token', 'triggerQueueRefresh',
    'addManuallyQueuedTrack',
    'playlists', 'customFolders', 'profile', 'deletePlaylist', 'deleteFolder', 'setCurrentView', 'setActivePlaylistId', 'activePlaylistId',
    'removeAlbumFromLibrary', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'renameFolder', 'createFolder', 'moveFolder',
    'reorderFolders', 'reorderPlaylistInFolder',
    'pinnedItems', 'togglePin'
  ]);

  const menuRef = useRef(null);
  const isMobile = useIsMobile();
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFolderOpen, setConfirmFolderOpen] = useState(false);
  // Which folder dialog is open, and what it should do with the name it collects. The menu
  // itself has usually closed by the time the dialog is on screen, so the item id is captured
  // here rather than read from contextMenu later.
  const [folderDialog, setFolderDialog] = useState(null); // { mode: 'rename', folderId, name } | { mode: 'create', itemId?, parentId? }
  const [showMoveFolder, setShowMoveFolder] = useState(false);

  // Which folder groups in the "Add to Playlist" submenu are expanded. Every folder starts
  // closed each time the menu opens, so a big library is a short list of folders rather than
  // one long scroll of every playlist.
  const [openFolderIds, setOpenFolderIds] = useState(() => new Set());

  const closeMenu = () => {
    setContextMenu(null);
    setShowPlaylistMenu(false);
    setShowMoveFolder(false);
    setOpenFolderIds(new Set());
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContextMenu]);

  // Keep the menu on screen. Position is written straight to the element rather than held in
  // state so that hover re-renders (which open the submenu) never reset it. useLayoutEffect
  // runs before paint, so there is no flash at the unclamped position.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !contextMenu) return;

    // On a phone the menu is a sheet pinned to the bottom edge by its classes; inline
    // coordinates from an earlier desktop-sized render would override that
    if (isMobile) {
      el.style.left = '';
      el.style.top = '';
      return;
    }

    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_PAD;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(contextMenu.x, maxLeft));
    const top = Math.max(VIEWPORT_PAD, Math.min(contextMenu.y, maxTop));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [contextMenu, isMobile]);

  if (!contextMenu) return null;

  // Submenu geometry, derived from the click position rather than measured. The clamp above
  // only ever moves the menu UP or LEFT, so using the raw coordinates here is conservative:
  // the real menu has at least this much room.
  const menuLeft = Math.min(contextMenu.x, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD);
  const flipSubmenu = menuLeft + MENU_WIDTH + SUBMENU_WIDTH + VIEWPORT_PAD > window.innerWidth;
  const submenuMaxHeight = Math.max(160, window.innerHeight - contextMenu.y - VIEWPORT_PAD - 48);

  // Anything you can actually add tracks to: playlists you own, plus collaborative ones. The
  // old owner-only filter silently hid collaborative playlists you had write access to.
  const userPlaylists = playlists.filter(p => p.owner?.id === profile?.id || p.collaborative);
  const { playlists: unfolderedPlaylists } = getUnfolderedItems(userPlaylists, [], customFolders);

  // Last row of every "Move to..." list. With no folders at all it is the only row, so the
  // heading no longer sits over an empty box.
  const newFolderEntry = (itemId) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setFolderDialog({ mode: 'create', itemId });
        setContextMenu(null);
      }}
      className="w-full text-left px-4 py-2 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors flex items-center gap-2"
    >
      <Plus className="w-3.5 h-3.5 text-neutral-500" /> New folder…
    </button>
  );

  const toggleFolderOpen = (folderId) => {
    setOpenFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  const sourcePlaylist = contextMenu.sourcePlaylistId ? playlists.find(p => p.id === contextMenu.sourcePlaylistId) : null;
  const folder = contextMenu?.folderId ? customFolders.find(f => f.id === contextMenu.folderId) : null;
  const canRemove = sourcePlaylist && sourcePlaylist.owner.id === profile?.id;

  // One-step reordering for touch screens, where the sidebar's drag-and-drop can't be used.
  // Neighbour ids drive the same store actions a drop would.
  const moveRows = (() => {
    if (contextMenu?.type === 'folder' && folder) {
      const siblings = childrenOf(customFolders, folder.parentId ?? null);
      const i = siblings.findIndex(f => f.id === folder.id);
      return {
        canUp: i > 0,
        canDown: i >= 0 && i < siblings.length - 1,
        up: () => reorderFolders(folder.id, siblings[i - 1].id, 'before'),
        down: () => reorderFolders(folder.id, siblings[i + 1].id, 'after')
      };
    }
    const itemId = contextMenu?.playlistId || contextMenu?.albumId;
    const parent = contextMenu?.parentFolderId ? customFolders.find(f => f.id === contextMenu.parentFolderId) : null;
    if (itemId && parent) {
      const ids = parent.playlistIds;
      const i = ids.indexOf(itemId);
      return {
        canUp: i > 0,
        canDown: i >= 0 && i < ids.length - 1,
        up: () => reorderPlaylistInFolder(parent.id, itemId, ids[i - 1]),
        down: () => reorderPlaylistInFolder(parent.id, itemId, ids[i + 1])
      };
    }
    return null;
  })();

  // Sandbox Pinning Logic
  const activeId = contextMenu?.playlistId || contextMenu?.albumId || contextMenu?.folderId;
  const activeType = contextMenu?.type;
  const canPin = ['playlist', 'album', 'folder'].includes(activeType);
  const isPinned = canPin ? pinnedItems.some(i => i.id === activeId) : false;

  const handleAddToQueue = async () => {
    const track = contextMenu.track;
    if (!token || !track) return;
    const deviceId = resolvePlaybackDeviceId();
    if (!deviceId) return;

    try {
      await addToQueue(token, deviceId, track.uri);
      // Only record the optimistic entry once Spotify has accepted it. It's persisted, so a
      // failed add used to leave a phantom in the queue panel that survived restarts.
      addManuallyQueuedTrack(track);

      setTimeout(() => triggerQueueRefresh(), 750);
      closeMenu();
      toast(`Queued "${track.name}"`, { tone: 'success' });
    } catch (err) {
      handlePlaybackError(err);
      if (err?.code !== 'NO_ACTIVE_DEVICE') toast("Couldn't add to the queue", { tone: 'error' });
    }
  };

  const handleAddToPlaylist = async (playlistId) => {
    if (!token || !contextMenu.track) return;
    const playlistName = playlists.find(p => p.id === playlistId)?.name || 'playlist';
    const trackName = contextMenu.track.name;
    try {
      await addTracksToPlaylist(token, playlistId, [contextMenu.track.uri]);
      closeMenu();
      toast(`Added "${trackName}" to ${playlistName}`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Couldn't add to ${playlistName}`, { tone: 'error' });
    }
  };

  const handleRemoveFromPlaylist = async () => {
    if (!token || !contextMenu.track || !contextMenu.sourcePlaylistId) return;
    try {
      await removeTrackFromPlaylist(token, contextMenu.sourcePlaylistId, contextMenu.track.uri);
      setContextMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeletePlaylist = () => {
    if (!contextMenu?.playlistId) return;
    setConfirmOpen(true);
  };

  const confirmDeletePlaylist = async () => {
    if (!token || !contextMenu?.playlistId) return;
    const playlist = playlists.find(p => p.id === contextMenu.playlistId);
    if (!playlist || playlist.owner.id !== profile?.id) {
      setContextMenu(null);
      setConfirmOpen(false);
      return;
    }

    try {
      await unfollowPlaylist(token, playlist.id);
      deletePlaylist(playlist.id);
      if (contextMenu.playlistId === activePlaylistId) {
        setCurrentView('library');
        setActivePlaylistId(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setContextMenu(null);
      setConfirmOpen(false);
    }
  };

  const handleDeleteFolder = () => {
    if (!contextMenu?.folderId) return;
    setConfirmFolderOpen(true);
  };

  const confirmDeleteFolder = () => {
    if (!contextMenu?.folderId) return;

    if (typeof contextMenu.onDelete === 'function') {
      contextMenu.onDelete();
    } else {
      deleteFolder(contextMenu.folderId);
      setContextMenu(null);
    }

    setConfirmFolderOpen(false);
  };

  const handleRemoveAlbum = async () => {
    if (!token || !contextMenu.albumId) return;
    try {
      // unsaveAlbum throws on a non-2xx response, so local state is only touched once Spotify
      // has actually removed it. Previously the response was ignored and the album vanished
      // locally even when the request failed, leaving the library diverged until reload.
      await unsaveAlbum(token, contextMenu.albumId);
      removeAlbumFromLibrary(contextMenu.albumId);
      closeMenu();
    } catch (err) {
      console.error('Failed to remove album:', err);
    }
  };

  return createPortal(
    <>
      {/* The document click-outside handler closes the menu when this is tapped */}
      {isMobile && <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm animate-fade-in" aria-hidden="true" />}
    <div
      ref={menuRef}
      role="menu"
      className={isMobile
        ? 'fixed z-[9999] inset-x-0 bottom-0 w-full max-h-[80dvh] overflow-y-auto bg-neutral-900 border-t border-neutral-700 rounded-t-2xl shadow-2xl pt-2 pb-[env(safe-area-inset-bottom)] select-none'
        : 'fixed z-[9999] w-56 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 overflow-visible'}
    >
      {isMobile && <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />}
      {isMobile && (contextMenu.track?.name || contextMenu.folderName || (contextMenu.playlistId && playlists.find(p => p.id === contextMenu.playlistId)?.name)) && (
        <p className="px-4 pb-2 text-xs font-bold uppercase tracking-wider text-neutral-500 truncate border-b border-white/5 mb-1">
          {contextMenu.track?.name || contextMenu.folderName || playlists.find(p => p.id === contextMenu.playlistId)?.name}
        </p>
      )}

      {/* UNIVERSAL PIN TOGGLE */}
      {canPin && (
        <button
          onClick={() => { togglePin(activeId, activeType); setContextMenu(null); }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors border-b border-white/5"
        >
          {isPinned ? <PinOff className="w-4 h-4 text-neutral-400" /> : <Pin className="w-4 h-4 text-neutral-400" />}
          <span>{isPinned ? 'Unpin from Home' : 'Pin to Home'}</span>
        </button>
      )}

      {moveRows && (
        <div className="flex border-b border-white/5">
          <button
            type="button"
            disabled={!moveRows.canUp}
            onClick={(e) => { e.stopPropagation(); moveRows.up(); }}
            className="flex-1 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-center space-x-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4 text-neutral-400" />
            <span>Move up</span>
          </button>
          <button
            type="button"
            disabled={!moveRows.canDown}
            onClick={(e) => { e.stopPropagation(); moveRows.down(); }}
            className="flex-1 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-center space-x-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-l border-white/5"
          >
            <ChevronDown className="w-4 h-4 text-neutral-400" />
            <span>Move down</span>
          </button>
        </div>
      )}

      {(contextMenu?.type === 'track' || contextMenu?.track) && (
        <>
          <button
            onClick={handleAddToQueue}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <ListPlus className="w-4 h-4 text-neutral-400" />
            <span>Add to Queue</span>
          </button>

          {canRemove && (
            <button
              onClick={handleRemoveFromPlaylist}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from this playlist</span>
            </button>
          )}

          <div
            className="relative"
            onMouseEnter={() => { if (!isMobile) setShowPlaylistMenu(true); }}
            onMouseLeave={() => { if (!isMobile) setShowPlaylistMenu(false); }}
          >
            <button
              // Click as well as hover, so it works on touch screens
              onClick={() => setShowPlaylistMenu(v => !v)}
              className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Plus className="w-4 h-4 text-neutral-400" />
                <span>Add to Playlist</span>
              </div>
              {showPlaylistMenu && isMobile ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
            </button>

            {/* Desktop: a flyout beside the menu. Phone: the list unfolds inside the sheet. */}
            {showPlaylistMenu && (
              <div className={isMobile ? 'w-full' : `absolute top-0 z-50 ${flipSubmenu ? 'right-full pr-2 -mr-2' : 'left-full pl-2 -ml-2'}`}>
                <div
                  style={isMobile ? undefined : { maxHeight: submenuMaxHeight }}
                  className={isMobile
                    ? 'w-full max-h-[45dvh] bg-black/30 border-y border-white/5 py-2 overflow-y-auto'
                    : 'w-64 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-2 overflow-y-auto custom-scrollbar'}
                >
                  {unfolderedPlaylists.map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => handleAddToPlaylist(pl.id)}
                      className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors"
                    >
                      {pl.name}
                    </button>
                  ))}

                  {flattenFolderTree(customFolders).map(({ folder, path }) => {
                    const folderPls = userPlaylists.filter(p => folder.playlistIds.includes(p.id));
                    if (folderPls.length === 0) return null;
                    const isOpen = openFolderIds.has(folder.id);

                    return (
                      <div key={folder.id} className="mt-1 pt-1 border-t border-white/5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleFolderOpen(folder.id); }}
                          aria-expanded={isOpen}
                          title={path.join(' › ')}
                          className="w-full px-4 py-2 flex items-center justify-between text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                        >
                          <span className="flex items-center min-w-0">
                            <Folder className={`w-3.5 h-3.5 mr-2 shrink-0 ${isOpen ? 'text-brand-gradient' : 'text-neutral-500'}`} />
                            {/* Nested folders show their path; the accordion itself stays one level deep */}
                            <span className="truncate font-medium">{path.join(' › ')}</span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="text-[10px] font-bold text-neutral-500 tabular-nums">{folderPls.length}</span>
                            {isOpen
                              ? <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
                              : <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />}
                          </span>
                        </button>

                        {isOpen && folderPls.map(pl => (
                          <button
                            key={pl.id}
                            onClick={() => handleAddToPlaylist(pl.id)}
                            className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors pl-9"
                          >
                            {pl.name}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {(contextMenu?.type === 'playlist' || contextMenu?.playlistId) && (
        <>
          <button
            onClick={handleDeletePlaylist}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Delete playlist</span>
          </button>

          {contextMenu?.parentFolderId && (
            <button
              onClick={async () => {
                try {
                  removePlaylistFromFolder(contextMenu.parentFolderId, contextMenu.playlistId);
                } catch (err) {
                  console.error('Failed to remove from folder', err);
                } finally {
                  setContextMenu(null);
                }
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          <div className="px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider font-bold flex items-center"><FolderPlus className="w-3 h-3 mr-2" /> Move to...</div>
          <MoveToList
            folders={customFolders}
            currentParentId={contextMenu?.parentFolderId ?? null}
            onPick={(folderId) => { addPlaylistToFolder(folderId, contextMenu.playlistId); closeMenu(); }}
            footer={newFolderEntry(contextMenu.playlistId)}
          />
        </>
      )}

      {(contextMenu?.type === 'album' || contextMenu?.albumId) && (
        <>
          <button
            onClick={handleRemoveAlbum}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Remove from Library</span>
          </button>

          {contextMenu?.parentFolderId && (
            <button
              onClick={async () => {
                try {
                  removePlaylistFromFolder(contextMenu.parentFolderId, contextMenu.albumId);
                } catch (err) {
                  console.error('Failed to remove from folder', err);
                } finally {
                  setContextMenu(null);
                }
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          <div className="px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider font-bold flex items-center"><FolderPlus className="w-3 h-3 mr-2" /> Move to...</div>
          <MoveToList
            folders={customFolders}
            currentParentId={contextMenu?.parentFolderId ?? null}
            onPick={(folderId) => { addPlaylistToFolder(folderId, contextMenu.albumId); closeMenu(); }}
            footer={newFolderEntry(contextMenu.albumId)}
          />
        </>
      )}

      {contextMenu?.type === 'folder' && folder && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFolderDialog({ mode: 'rename', folderId: folder.id, name: folder.name });
              setContextMenu(null);
            }}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Pencil className="w-4 h-4 text-neutral-400" />
            <span>Rename folder</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFolderDialog({ mode: 'create', parentId: folder.id });
              setContextMenu(null);
            }}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <FolderPlus className="w-4 h-4 text-neutral-400" />
            <span>New subfolder</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMoveFolder(v => !v); }}
            aria-expanded={showMoveFolder}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-between transition-colors"
          >
            <span className="flex items-center space-x-3">
              <CornerDownRight className="w-4 h-4 text-neutral-400" />
              <span>Move folder to…</span>
            </span>
            {showMoveFolder ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
          </button>
          {showMoveFolder && (
            <MoveToList
              folders={customFolders}
              currentParentId={folder.parentId ?? null}
              excludeIds={new Set([folder.id, ...descendantIds(customFolders, folder.id)])}
              allowRoot
              onPick={(targetId) => { moveFolder(folder.id, targetId); closeMenu(); }}
            />
          )}
          <button
            onClick={handleDeleteFolder}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Delete folder</span>
          </button>
        </>
      )}

      <FolderFormDialog
        open={Boolean(folderDialog)}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : (folderDialog?.parentId ? 'New subfolder' : 'New folder')}
        submitLabel={folderDialog?.mode === 'rename' ? 'Rename' : 'Create'}
        initialName={folderDialog?.mode === 'rename' ? folderDialog.name : ''}
        parentLabel={folderDialog?.parentId ? customFolders.find(f => f.id === folderDialog.parentId)?.name : ''}
        onSubmit={({ name }) => {
          if (folderDialog?.mode === 'rename') renameFolder(folderDialog.folderId, name);
          else createFolder(name, folderDialog.itemId ? [folderDialog.itemId] : [], folderDialog.parentId ?? null);
          setFolderDialog(null);
        }}
        onCancel={() => setFolderDialog(null)}
      />
      
      <ConfirmDialog
        open={confirmOpen}
        title="Delete Playlist"
        message={contextMenu?.playlistId ? `Delete "${playlists.find(p => p.id === contextMenu.playlistId)?.name}" from your library?` : 'Delete this playlist from your library?'}
        confirmLabel="Delete Playlist"
        onConfirm={confirmDeletePlaylist}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={confirmFolderOpen}
        title="Delete Folder"
        message={(() => {
          const subs = folder ? descendantIds(customFolders, folder.id).length : 0;
          return `Delete "${contextMenu?.folderName || folder?.name}"?${subs ? ` This also deletes ${subs} subfolder${subs === 1 ? '' : 's'}.` : ''} Your playlists will not be deleted.`;
        })()}
        confirmLabel="Delete Folder"
        onConfirm={confirmDeleteFolder}
        onCancel={() => setConfirmFolderOpen(false)}
      />
    </div>
    </>,
    document.body
  );
}