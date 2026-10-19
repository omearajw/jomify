import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useSlice } from '../store/selectors';
import { artUrl } from '../utils/images';
import { usePlayerStore } from '../store/playerStore';
import { fetchQueue, playContextFromTrack, playUris } from '../services/spotify/api';
import { playOn } from '../services/spotify/playbackController';
import { rowButtonProps } from '../utils/a11y';
import { formatTime } from '../utils/formatTime';
import { X, ListPlus } from 'lucide-react';
import MoreButton from '../components/MoreButton';
import { cleanString } from '../utils/strings';
import { useQueueStore } from '../store/queueStore';
import { withoutQueued } from '../services/queueLogic';
import QueueList from '../room/QueueList';

// The queue endpoint returns episode objects whenever a podcast is queued. They have `show`
// instead of `album`, and rendering them as tracks used to throw and blank the whole app.
const isRenderableTrack = (item) => Boolean(item) && item.type !== 'episode';

export default function QueuePanel() {
  const { token, isQueueOpen, toggleQueue, queueRefreshTrigger, queueData, setQueueData, setContextMenu } = useSlice(useUserStore, ['token', 'isQueueOpen', 'toggleQueue', 'queueRefreshTrigger', 'queueData', 'setQueueData', 'setContextMenu']);
  // Jomify's own queue: the songs added by hand, in the order Jomify will hand them to Spotify
  const queued = useQueueStore((s) => s.items);
  const removeQueued = useQueueStore((s) => s.remove);
  const currentTrackUid = usePlayerStore((s) => s.playbackState?.track_window?.current_track?.uid);
  const contextUri = usePlayerStore((s) => s.playbackState?.context?.uri || null);

  const manualQueueEntries = useMemo(() => queued.map((track) => ({ key: track.key, track })), [queued]);

  // What Spotify will play after Jomify's queue: its own queue, less the songs Jomify is holding
  const regularQueueEntries = useMemo(() => {
    const tracksOnly = (queueData?.queue || []).filter(isRenderableTrack);
    return withoutQueued(tracksOnly, queued).map((track, index) => ({
      key: `queue-${index}-${track.id || cleanString(track.name)}`,
      track
    }));
  }, [queueData?.queue, queued]);

  // "Play from here". Spotify's API can't jump within a queue, so the queue is remade from that
  // song: a song of the playing context starts the context there (the rest follows); a song you
  // added by hand plays with the hand-added ones after it.
  const playFromHere = (entry, kind) => {
    if (!token || !entry?.track?.uri) return;
    const track = entry.track;
    if (kind === 'regular' && contextUri) {
      playOn((deviceId) => playContextFromTrack(token, deviceId, contextUri, track.uri), { track });
      return;
    }
    const list = kind === 'manual' ? manualQueueEntries : regularQueueEntries;
    const at = list.findIndex((e) => e.key === entry.key);
    const uris = list.slice(Math.max(0, at)).map((e) => e.track?.uri).filter(Boolean).slice(0, 100);
    playOn((deviceId) => playUris(token, deviceId, uris, 0), { track });
  };
  const isMobile = useIsMobile();
  // the new queue (src/queue) shows itself, the same list as the room's
  const newQueue = useUserStore((s) => s.playbackSettings?.queueEngine === true);


  useEffect(() => {
    if (isQueueOpen && token && !newQueue) {
      const timeoutId = setTimeout(() => {
        fetchQueue(token).then(setQueueData).catch(console.error);
      }, 400);
      return () => clearTimeout(timeoutId);
    }
  }, [isQueueOpen, token, currentTrackUid, queueRefreshTrigger, setQueueData, newQueue]);

  if (!isQueueOpen) return null;

  // The same song menu as anywhere else, by right-click or long-press: go to the artist or
  // album, add to a playlist. Rows used to do nothing at all.
  const openTrackMenu = (e, track) => {
    e.preventDefault();
    setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track });
  };

  // Desktop: a column beside the content. Phone: the same panel, full screen, above everything
  const panel = (
    <div className={isMobile
      ? 'fixed inset-0 z-[9001] bg-neutral-950 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] animate-fade-in'
      : 'w-80 bg-black/40 backdrop-blur-md border-l border-white/5 flex flex-col h-full overflow-hidden shrink-0 animate-slide-in-right shadow-2xl'}>
      <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
        <h2 className="text-xl font-bold text-white tracking-tight">Queue</h2>
        <button onClick={toggleQueue} aria-label="Close queue" title="Close queue" className="text-neutral-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {newQueue ? <div className="flex-1 overflow-y-auto p-4 select-none"><QueueList /></div> : (
      <div className="flex-1 overflow-y-auto p-4 space-y-8 select-none">
        {!queueData?.currently_playing && manualQueueEntries.length === 0 && regularQueueEntries.length === 0 && (
          <p className="px-2 py-10 text-center text-sm text-neutral-500">Nothing queued. Play something, or add songs with "Add to Queue" from a song's menu.</p>
        )}
        {queueData?.currently_playing && manualQueueEntries.length === 0 && regularQueueEntries.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-neutral-500">Nothing after this one yet.</p>
        )}
        {queueData?.currently_playing && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Now Playing</h3>
            <div className="flex items-center space-x-3">
              <img
                src={artUrl(queueData.currently_playing.album?.images || queueData.currently_playing.images, 48)}
                alt=""
                className="w-12 h-12 rounded object-cover shadow-md bg-neutral-800"
              />
              <div className="flex flex-col truncate">
                <span className="text-brand-gradient text-sm font-medium truncate">{queueData.currently_playing.name}</span>
                <span className="text-neutral-400 text-xs truncate">
                  {(queueData.currently_playing.artists || []).map(a => a.name).join(', ')
                    || queueData.currently_playing.show?.name
                    || ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {manualQueueEntries.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4">Up Next</h3>
            <div className="flex flex-col space-y-3 mb-6">
              {manualQueueEntries.map(({ key, track }) => (
                <div key={key} onClick={() => playFromHere({ key, track }, 'manual')} {...rowButtonProps(() => playFromHere({ key, track }, 'manual'))} onContextMenu={(e) => openTrackMenu(e, track)} title="Play from here" className="flex items-center space-x-3 group cursor-pointer rounded-md px-2 py-1.5 border border-[var(--brand-mid)]/15 bg-[var(--brand-mid)]/5 hover:bg-[var(--brand-mid)]/10">
                  <ListPlus className="w-4 h-4 text-[var(--brand-mid)] shrink-0" title="Queued item" />
                  <img src={artUrl(track.album?.images, 40)} alt="" width="40" height="40" loading="lazy" decoding="async" className="w-10 h-10 rounded object-cover bg-neutral-800" draggable="false" />
                  <div className="flex flex-col truncate flex-1 pr-2 min-w-0">
                    <span className="text-white text-sm font-medium truncate">{track.name}</span>
                    <span className="text-neutral-400 text-xs truncate">{(track.artists || []).map(a => a.name).join(', ')}</span>
                  </div>
                  <span className="text-neutral-500 text-xs opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                    {formatTime(track.duration_ms)}
                  </span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeQueued(key); }} aria-label={`Remove ${track.name} from the queue`} title="Remove from queue" className="w-7 h-7 grid place-items-center rounded-full text-neutral-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <MoreButton onOpen={(e) => openTrackMenu(e, track)} />
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
                  onClick={() => playFromHere({ key, track }, 'regular')}
                  {...rowButtonProps(() => playFromHere({ key, track }, 'regular'))}
                  onContextMenu={(e) => openTrackMenu(e, track)}
                  title="Play from here"
                  className="flex items-center space-x-3 group cursor-pointer rounded-md px-2 py-1.5 border border-transparent hover:bg-white/5 transition-colors"
                >
                  <img src={artUrl(track.album?.images, 40)} alt="" width="40" height="40" loading="lazy" decoding="async" className="w-10 h-10 rounded object-cover bg-neutral-800" draggable="false" />
                  <div className="flex flex-col truncate flex-1 pr-2 min-w-0">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-white text-sm font-medium truncate">{track.name}</span>
                    </div>
                    <span className="text-neutral-400 text-xs truncate">{(track.artists || []).map(a => a.name).join(', ')}</span>
                  </div>
                  <span className="text-neutral-500 text-xs opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                    {formatTime(track.duration_ms)}
                  </span>
                  <MoreButton onOpen={(e) => openTrackMenu(e, track)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );

  return isMobile ? createPortal(panel, document.body) : panel;
}