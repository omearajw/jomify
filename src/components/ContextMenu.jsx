import { useEffect, useRef, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { addToQueue, addTracksToPlaylist, removeTrackFromPlaylist } from '../services/spotify/api';
import { ListPlus, Plus, ChevronRight, Folder, Trash2 } from 'lucide-react';

export default function ContextMenu() {
  const { 
    contextMenu, setContextMenu, token, triggerQueueRefresh, 
    addManuallyQueuedTrack, injectOptimisticQueueItem, 
    playlists, customFolders, profile 
  } = useUserStore();
  
  const { deviceId } = usePlayerStore();
  const menuRef = useRef(null);
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);

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

  // CHECK IF WE CAN REMOVE THIS TRACK
  const sourcePlaylist = contextMenu.sourcePlaylistId ? playlists.find(p => p.id === contextMenu.sourcePlaylistId) : null;
  const canRemove = sourcePlaylist && sourcePlaylist.owner.id === profile?.id;

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
      // NOTE: You may want to trigger a re-fetch of your playlist data here to update the UI
      setContextMenu(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ top: contextMenu.y, left: contextMenu.x }}
      className="fixed z-50 w-56 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 overflow-visible"
    >
      <button
        onClick={handleAddToQueue}
        className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
      >
        <ListPlus className="w-4 h-4 text-neutral-400" />
        <span>Add to Queue</span>
      </button>

      {/* NEW: Remove from Playlist Button */}
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
    </div>
  );
}