import { Play, Pause, SkipForward, MonitorSpeaker } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { useProgress } from '../hooks/useProgress';
import { togglePlay, next } from '../services/spotify/playbackController';
import LikeButton from '../components/LikeButton';
import { rowButtonProps } from '../utils/a11y';
import { artUrl } from '../utils/images';

// The strip above the tab bar on a phone. Tapping it opens the full Now Playing sheet.
export default function MiniPlayer() {
  const setNowPlayingOpen = useUserStore((s) => s.setNowPlayingOpen);
  const setDevicePickerOpen = useUserStore((s) => s.setDevicePickerOpen);
  const activeDevice = usePlayerStore((s) => s.activeDevice);
  const { position, duration, paused, track } = useProgress();
  const percent = duration > 0 ? (position / duration) * 100 : 0;

  if (!track) {
    return (
      <button
        type="button"
        onClick={() => setDevicePickerOpen(true)}
        className="shrink-0 h-14 px-4 flex items-center gap-3 bg-neutral-900/90 backdrop-blur-xl border-t border-white/5 text-left"
      >
        <MonitorSpeaker className="w-5 h-5 text-neutral-400" />
        <span className="text-sm text-neutral-400">
          {activeDevice ? `Nothing playing on ${activeDevice.name}` : 'Nothing playing · choose a device'}
        </span>
      </button>
    );
  }

  const art = artUrl(track.album?.images, 40);
  const open = () => setNowPlayingOpen(true);

  return (
    <div className="shrink-0 relative bg-neutral-900/90 backdrop-blur-xl border-t border-white/5 select-none">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10" aria-hidden="true">
        <div className="h-full bg-brand-gradient" style={{ width: `${percent}%` }} />
      </div>
      <div className="h-14 px-3 flex items-center gap-3">
        <div
          onClick={open}
          {...rowButtonProps(open)}
          aria-label="Open Now Playing"
          className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
        >
          {art
            ? <img src={art} alt="" width="40" height="40" decoding="async" className="w-10 h-10 rounded object-cover shadow-md shrink-0" draggable="false" />
            : <div className="w-10 h-10 rounded bg-neutral-800 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{track.name}</p>
            <p className="text-xs text-neutral-400 truncate">
              {(track.artists || []).map(a => a.name).join(', ')}
              {activeDevice && !activeDevice.isLocal && activeDevice.name !== 'This browser' ? ` · ${activeDevice.name}` : ''}
            </p>
          </div>
        </div>
        {track.id && <LikeButton trackId={track.id} />}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? 'Play' : 'Pause'}
          className="w-11 h-11 flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          {paused ? <Play className="w-6 h-6 fill-current ml-0.5" /> : <Pause className="w-6 h-6 fill-current" />}
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next track"
          className="w-11 h-11 flex items-center justify-center text-neutral-300 active:scale-95 transition-transform"
        >
          <SkipForward className="w-5 h-5 fill-current" />
        </button>
      </div>
    </div>
  );
}
