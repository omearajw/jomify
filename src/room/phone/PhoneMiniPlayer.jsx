import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useProgress } from '../../hooks/useProgress';
import { togglePlay, next, previous } from '../../services/spotify/playbackController';
import { artUrl } from '../../utils/images';

// The player at the bottom of the phone while the sheet is up (Jack, 20 Oct: the sheet covered the
// controls, and the top of a phone is hard to reach). The sheet stands on it: as the sheet rises,
// this rises from the bottom edge beneath it, so the controls stay under the thumb rather than
// travelling past the sheet. A tap on it (not on a button) puts the sheet away, back to the room.
// `lift`: 0 hidden, 1 shown, in between while the sheet is being dragged.

export const BAR_PX = 64;

export default function PhoneMiniPlayer({ lift = 0, dragging = false, onOpen }) {
  const { position, duration, paused, track } = useProgress();
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const art = track?.album?.images?.length ? artUrl(track.album.images, 80) : null;
  return (
    <div
      role="region"
      aria-label="Now playing"
      aria-hidden={lift < 0.5 || undefined}
      onClick={onOpen}
      className="fixed inset-x-0 bottom-0 z-40 cursor-pointer select-none"
      style={{
        height: `calc(${BAR_PX}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        transform: `translateY(${(1 - lift) * 100}%)`,
        transition: dragging ? 'none' : 'transform 420ms cubic-bezier(0.2, 0.75, 0.2, 1)',
        pointerEvents: lift < 0.5 ? 'none' : 'auto',
        background: 'var(--room-solid)',
        boxShadow: '0 -1px 0 var(--room-hair)',
        color: 'var(--room-paper)',
        fontFamily: 'var(--font-room)'
      }}
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-white/10">
        <div className="h-full bg-[var(--room-paper)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex h-full items-center gap-3 px-4">
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-white/5">
          {art && <img src={art} alt="" draggable="false" className="h-full w-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-semibold">{track?.name || 'Nothing playing'}</b>
          <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{(track?.artists || []).map((a) => a.name).join(', ')}</span>
        </span>
        <span className="flex shrink-0 items-center" data-control onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={previous} aria-label="Previous" className="room-press grid h-11 w-10 place-items-center text-[var(--room-dim)]"><SkipBack className="h-5 w-5" /></button>
          <button type="button" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} className="grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-90">
            {paused ? <Play key="play" className="room-turn ml-0.5 h-6 w-6 fill-current" /> : <Pause key="pause" className="room-turn h-6 w-6 fill-current" />}
          </button>
          <button type="button" onClick={next} aria-label="Next" className="room-press grid h-11 w-10 place-items-center text-[var(--room-dim)]"><SkipForward className="h-5 w-5" /></button>
        </span>
      </div>
    </div>
  );
}
