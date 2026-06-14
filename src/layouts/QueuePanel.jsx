import { useEffect } from 'react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { fetchQueue } from '../services/spotify/api';
import { formatTime } from '../utils/formatTime';
import { X, ListPlus } from 'lucide-react';

const cleanString = (str) => {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

export default function QueuePanel() {
  const { token, isQueueOpen, toggleQueue, queueRefreshTrigger, manuallyQueuedTracks, queueData, setQueueData } = useUserStore();
  const { playbackState } = usePlayerStore(); 

  const currentTrackUid = playbackState?.track_window?.current_track?.uid;

  useEffect(() => {
    if (isQueueOpen && token) {
      const timeoutId = setTimeout(() => {
        fetchQueue(token).then(setQueueData).catch(console.error);
      }, 400);
      return () => clearTimeout(timeoutId);
    }
  }, [isQueueOpen, token, currentTrackUid, queueRefreshTrigger, setQueueData]);

  if (!isQueueOpen) return null;

  return (
    <div className="w-80 bg-black border-l border-neutral-800 flex flex-col h-full overflow-hidden shrink-0 animate-slide-in-right">
      
      <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
        <h2 className="text-xl font-bold text-white tracking-tight">Queue</h2>
        <button onClick={toggleQueue} className="text-neutral-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 select-none">
        
        {/* Currently Playing */}
        {queueData?.currently_playing && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Now Playing</h3>
            <div className="flex items-center space-x-3">
              <img src={queueData.currently_playing.album.images[0]?.url} alt="" className="w-12 h-12 rounded object-cover shadow-md" />
              <div className="flex flex-col truncate">
                <span className="text-green-500 text-sm font-medium truncate">{queueData.currently_playing.name}</span>
                <span className="text-neutral-400 text-xs truncate">{queueData.currently_playing.artists.map(a => a.name).join(', ')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Up Next List */}
        {queueData?.queue?.length > 0 && (
          <div>
             <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Next In Queue</h3>
             <div className="flex flex-col space-y-3">
               {(() => {
                 const visualMemory = [...manuallyQueuedTracks];

                 return queueData.queue.map((track, index) => {
                   let isManuallyQueued = false;
                   
                   const memIndex = visualMemory.findIndex(t => 
                     t.id === track.id || 
                     t.uri === track.uri ||
                     (cleanString(t.name) === cleanString(track.name) &&
                      t.artists?.[0]?.name === track.artists?.[0]?.name)
                   );

                   if (memIndex > -1) {
                     isManuallyQueued = true;
                     visualMemory.splice(memIndex, 1); // Safely consume the marker instance
                   }

                   return (
                     <div key={`${track.id}-${index}`} className="flex items-center space-x-3 group cursor-default">
                       <img src={track.album.images[0]?.url} alt="" className="w-10 h-10 rounded object-cover" />
                       <div className="flex flex-col truncate flex-1 pr-2">
                         
                         <div className="flex items-center space-x-2">
                           <span className="text-white text-sm font-medium truncate">{track.name}</span>
                           {isManuallyQueued && (
                             <ListPlus className="w-3.5 h-3.5 text-green-500 shrink-0" title="Manually Queued" />
                           )}
                         </div>
                         
                         <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
                       </div>
                       <span className="text-neutral-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                         {formatTime(track.duration_ms)}
                       </span>
                     </div>
                   );
                 });
               })()}
             </div>
          </div>
        )}
      </div>
    </div>
  );
}