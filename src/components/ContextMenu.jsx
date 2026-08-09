import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { addToQueue, addTracksToPlaylist, removeTrackFromPlaylist, unfollowPlaylist, saveAlbumToLibrary } from '../services/spotify/api';
import { ListPlus, Plus, ChevronRight, Folder, Trash2, FolderPlus, Pin, PinOff } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

export default function ContextMenu() {
  const { 
    contextMenu, setContextMenu, token, triggerQueueRefresh, 
    addManuallyQueuedTrack, injectOptimisticQueueItem, 
    playlists, customFolders, profile, deletePlaylist, deleteFolder, setCurrentView, setActivePlaylistId, activePlaylistId,
    albums, setAlbums, addPlaylistToFolder, removePlaylistFromFolder,
    pinnedItems, togglePin
  } = useUserStore();

  const { deviceId } = usePlayerStore();
  const menuRef = useRef(null);
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFolderOpen, setConfirmFolderOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
        setShowPlaylistMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [setContextMenu]);

  if (!contextMenu) return null;

  const userPlaylists = playlists.filter(p => p.owner.id === profile?.id);
  const unfolderedPlaylists = userPlaylists.filter(p => !customFolders.some(f => f.playlistIds.includes(p.id)));
  const sourcePlaylist = contextMenu.sourcePlaylistId ? playlists.find(p => p.id === contextMenu.sourcePlaylistId) : null;
  const folder = contextMenu?.folderId ? customFolders.find(f => f.id === contextMenu.folderId) : null;
  const canRemove = sourcePlaylist && sourcePlaylist.owner.id === profile?.id;

  // Sandbox Pinning Logic
  const activeId = contextMenu?.playlistId || contextMenu?.albumId || contextMenu?.folderId;
  const activeType = contextMenu?.type;
  const canPin = ['playlist', 'album', 'folder'].includes(activeType);
  const isPinned = canPin ? pinnedItems.some(i => i.id === activeId) : false;

  const handleAddToQueue = async () => {
    if (!token || !deviceId || !contextMenu.track) return;
    try {
      addManuallyQueuedTrack(contextMenu.track);
      injectOptimisticQueueItem(contextMenu.track);
      await addToQueue(token, deviceId, contextMenu.track.uri);
      setTimeout(() => triggerQueueRefresh(), 750);
      setContextMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddToPlaylist = async (playlistId) => {
    if (!token || !contextMenu.track) return;
    try {
      await addTracksToPlaylist(token, playlistId, [contextMenu.track.uri]);
      setContextMenu(null);
      setShowPlaylistMenu(false);
    } catch (err) {
      console.error(err);
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
      await fetch(`https://api.spotify.com/v1/me/albums?ids=${contextMenu.albumId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (albums && setAlbums) {
        setAlbums(albums.filter(a => a.id !== contextMenu.albumId));
      }
      
      customFolders.forEach(f => {
         if (f.playlistIds.includes(contextMenu.albumId)) {
             removePlaylistFromFolder(f.id, contextMenu.albumId);
         }
      });
      
      setContextMenu(null);
    } catch (err) {
      console.error('Failed to remove album:', err);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: contextMenu.y, left: contextMenu.x }}
      className="fixed z-[9999] w-56 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 overflow-visible"
    >
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
            onMouseEnter={() => setShowPlaylistMenu(true)}
            onMouseLeave={() => setShowPlaylistMenu(false)}
          >
            <button className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-between transition-colors">
              <div className="flex items-center space-x-3">
                <Plus className="w-4 h-4 text-neutral-400" />
                <span>Add to Playlist</span>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-500" />
            </button>

            {showPlaylistMenu && (
              <div className="absolute left-full top-0 pl-2 -ml-2 z-50">
                <div className="w-64 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-2 max-h-96 overflow-y-auto custom-scrollbar">
                  {unfolderedPlaylists.map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => handleAddToPlaylist(pl.id)}
                      className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors"
                    >
                      {pl.name}
                    </button>
                  ))}

                  {customFolders.map(folder => {
                    const folderPls = userPlaylists.filter(p => folder.playlistIds.includes(p.id));
                    if (folderPls.length === 0) return null;

                    return (
                      <div key={folder.id} className="mt-2 pt-2 border-t border-white/5">
                        <div className="px-4 py-1 flex items-center text-xs font-bold text-neutral-500 uppercase tracking-wider">
                          <Folder className="w-3 h-3 mr-2" /> {folder.name}
                        </div>
                        {folderPls.map(pl => (
                          <button
                            key={pl.id}
                            onClick={() => handleAddToPlaylist(pl.id)}
                            className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors pl-8"
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
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {customFolders.map(folder => (
              <button
                key={folder.id}
                onClick={(e) => {
                  e?.stopPropagation?.();
                  addPlaylistToFolder(folder.id, contextMenu.playlistId);
                  setContextMenu(null);
                }}
                disabled={folder.id === contextMenu?.parentFolderId}
                className="w-full text-left px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate"
              >
                {folder.name}
              </button>
            ))}
          </div>
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
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {customFolders.map(folder => (
              <button
                key={folder.id}
                onClick={(e) => {
                  e?.stopPropagation?.();
                  addPlaylistToFolder(folder.id, contextMenu.albumId);
                  setContextMenu(null);
                }}
                disabled={folder.id === contextMenu?.parentFolderId}
                className="w-full text-left px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate"
              >
                {folder.name}
              </button>
            ))}
          </div>
        </>
      )}

      {contextMenu?.type === 'folder' && folder && (
        <>
          <button
            onClick={handleDeleteFolder}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Delete folder</span>
          </button>
        </>
      )}
      
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
        message={`Delete "${contextMenu?.folderName || folder?.name}"? Your playlists will not be deleted.`}
        confirmLabel="Delete Folder"
        onConfirm={confirmDeleteFolder}
        onCancel={() => setConfirmFolderOpen(false)}
      />
    </div>,
    document.body
  );
}