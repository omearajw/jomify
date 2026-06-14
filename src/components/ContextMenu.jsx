import { useEffect, useRef } from 'react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { addToQueue } from '../services/spotify/api';
import { ListPlus } from 'lucide-react';

export default function ContextMenu() {
  const { contextMenu, setContextMenu, token, triggerQueueRefresh, addManuallyQueuedTrack, injectOptimisticQueueItem } = useUserStore();
  const { deviceId } = usePlayerStore();
  const menuRef = useRef(null);

  // Close the menu if you click anywhere else on the screen
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [setContextMenu]);

  if (!contextMenu) return null;

  const handleAddToQueue = async () => {
    if (!token || !deviceId || !contextMenu.track) return;
    
    try {
      addManuallyQueuedTrack(contextMenu.track);
      
      // 2. Instantly force the track to the top of the UI queue locally
      injectOptimisticQueueItem(contextMenu.track);
      
      await addToQueue(token, deviceId, contextMenu.track.uri);
      
      setTimeout(() => {
        triggerQueueRefresh(); 
      }, 750);
      
      setContextMenu(null); 
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ top: contextMenu.y, left: contextMenu.x }}
      className="fixed z-50 w-48 bg-neutral-800 border border-neutral-700 rounded-md shadow-2xl py-1 overflow-hidden"
    >
      <button
        onClick={handleAddToQueue}
        className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-700 flex items-center space-x-3 transition-colors"
      >
        <ListPlus className="w-4 h-4 text-green-500" />
        <span>Add to Queue</span>
      </button>
    </div>
  );
}