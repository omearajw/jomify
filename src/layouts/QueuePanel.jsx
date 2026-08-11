import { useEffect, useMemo, useRef, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { fetchQueue } from '../services/spotify/api';
import { formatTime } from '../utils/formatTime';
import { X, ListPlus } from 'lucide-react';

const cleanString = (str) => {
  if (!str) return '';
  return str.split(/[-(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

const isTrackMatch = (a, b) => {
  if (!a || !b) return false;

  if (a.id && b.id && a.id === b.id) return true;
  if (a.uri && b.uri && a.uri === b.uri) return true;

  return cleanString(a.name) === cleanString(b.name) && a.artists?.[0]?.name === b.artists?.[0]?.name;
};

const removeManualMatchesFromQueue = (queueTracks, manualTracks) => {
  const remaining = [...queueTracks];

  for (let manualIndex = manualTracks.length - 1; manualIndex >= 0; manualIndex -= 1) {
    const manualTrack = manualTracks[manualIndex];

    for (let queueIndex = remaining.length - 1; queueIndex >= 0; queueIndex -= 1) {
      if (isTrackMatch(remaining[queueIndex], manualTrack)) {
        remaining.splice(queueIndex, 1);
        break;
      }
    }
  }

  return remaining;
};

export default function QueuePanel() {
  const { token, isQueueOpen, toggleQueue, queueRefreshTrigger, manuallyQueuedTracks, queueData, setQueueData } = useUserStore();
  const { playbackState } = usePlayerStore();
  const [regularQueueEntries, setRegularQueueEntries] = useState([]);

  const currentTrackUid = playbackState?.track_window?.current_track?.uid;

  const manualQueueEntries = useMemo(() => manuallyQueuedTracks.map((track, index) => ({
    key: `manual-${index}-${track?.uri || track?.id || cleanString(track?.name)}`,
    track,
  })), [manuallyQueuedTracks]);

  useEffect(() => {
    const filteredQueue = removeManualMatchesFromQueue(queueData?.queue || [], manuallyQueuedTracks);
    // Since we no longer need complex stable keys for drag-and-drop, we can map directly
    const nextEntries = filteredQueue.map((track, index) => ({
      key: `queue-${index}-${track.id || cleanString(track.name)}`,
      track
    }));
    setRegularQueueEntries(nextEntries);
  }, [queueData?.queue, manuallyQueuedTracks]);

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
    <div className="w-80 bg-black/40 backdrop-blur-md border-l border-white/5 flex flex-col h-full overflow-hidden shrink-0 animate-slide-in-right shadow-2xl">
      <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
        <h2 className="text-xl font-bold text-white tracking-tight">Queue</h2>
        <button onClick={toggleQueue} className="text-neutral-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 select-none">
        {queueData?.currently_playing && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Now Playing</h3>
            <div className="flex items-center space-x-3">
              <img src={queueData.currently_playing.album.images[0]?.url} alt="" className="w-12 h-12 rounded object-cover shadow-md" />
              <div className="flex flex-col truncate">
                <span className="text-brand-gradient text-sm font-medium truncate">{queueData.currently_playing.name}</span>
                <span className="text-neutral-400 text-xs truncate">{queueData.currently_playing.artists.map(a => a.name).join(', ')}</span>
              </div>
            </div>
          </div>
        )}

        {manualQueueEntries.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Up Next</h3>
            <div className="flex flex-col space-y-3 mb-6">
              {manualQueueEntries.map(({ key, track }) => (
                <div key={key} className="flex items-center space-x-3 group cursor-default rounded-md px-2 py-1.5 border border-[var(--brand-mid)]/15 bg-[var(--brand-mid)]/5">
                  <ListPlus className="w-4 h-4 text-[var(--brand-mid)] shrink-0" title="Queued item" />
                  <img src={track.album.images[0]?.url} alt="" className="w-10 h-10 rounded object-cover" draggable="false" />
                  <div className="flex flex-col truncate flex-1 pr-2 min-w-0">
                    <span className="text-white text-sm font-medium truncate">{track.name}</span>
                    <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
                  </div>
                  <span className="text-neutral-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatTime(track.duration_ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {regularQueueEntries.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Next In Queue</h3>
            <div className="flex flex-col space-y-3">
              {regularQueueEntries.map(({ key, track }) => (
                <div
                  key={key}
                  className="flex items-center space-x-3 group cursor-default rounded-md px-2 py-1.5 border border-transparent hover:bg-white/5 transition-colors"
                >
                  <img src={track.album.images[0]?.url} alt="" className="w-10 h-10 rounded object-cover" draggable="false" />
                  <div className="flex flex-col truncate flex-1 pr-2 min-w-0">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-white text-sm font-medium truncate">{track.name}</span>
                    </div>
                    <span className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</span>
                  </div>
                  <span className="text-neutral-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatTime(track.duration_ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}