import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, Mic2, Speaker, Volume1, Volume2 } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { useProgress } from '../../hooks/useProgress';
import { usePlayingFrom, playingFromLabel } from '../../hooks/usePlayingFrom';
import { togglePlay, next, previous, seek, setVolume } from '../../services/spotify/playbackController';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';
import { formatTime } from '../../utils/formatTime';
import LikeButton from '../../components/LikeButton';
import QueueColumn from '../QueueColumn';
import { ZenFocusLyricsLite, ZenPlainLyrics } from '../../views/ZenMode/ZenLyricsDom';
import { useNowLyrics } from './useNowLyrics';
import JomifyMark from '../../components/JomifyMark';
import Artists from '../Artists';

// The room on a phone (DESIGN.md §5, 13 Oct): the cover, the song, the controls and up next, on
// the cover's own light. The queue stays here because it is edited; the phone is the controller.
// Lyrics are a state of this room: the cover shrinks up beside the song, the lyrics take the
// middle, and the queue steps aside. Its lists scroll in place and never open the sheet.

const MOVE = { layout: { duration: 0.55, ease: [0.2, 0.75, 0.2, 1] } };

export function Progress() {
  const { position, duration, track } = useProgress();
  const [scrub, setScrub] = useState(null);
  const shown = scrub ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const commit = () => { if (scrub !== null) { seek(scrub); setScrub(null); } };
  return (
    <div className="flex items-center gap-3 text-[11px] tabular-nums text-[var(--room-dim)]" style={{ fontFamily: 'var(--font-mono)' }}>
      <span className="w-9 text-right">{formatTime(shown)}</span>
      <div className="relative flex h-8 flex-1 items-center">
        <div className="relative h-[2px] w-full rounded-full bg-white/15">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--room-paper)]" style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 -ml-[6px] -mt-[6px] h-3 w-3 rounded-full bg-[var(--room-paper)]" style={{ left: `${pct}%` }} />
        </div>
        <input type="range" min="0" max={duration || 100} value={Math.min(shown, duration || 100)} disabled={!track}
          onChange={(e) => setScrub(parseInt(e.target.value, 10))} onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit}
          aria-label="Seek" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </div>
      <span className="w-9">{formatTime(duration)}</span>
    </div>
  );
}

// A speaker's volume, when the music is on one: the phone's own buttons only ever reach the
// phone (a web page can't catch them), so this is the only way to turn an Alexa down from here.
// setVolume debounces, so dragging sends a handful of requests rather than one per pixel.
function RemoteVolume() {
  const activeDevice = usePlayerStore((s) => s.activeDevice);
  const isLocalActive = usePlayerStore((s) => s.isLocalActive);
  const remoteVolume = usePlayerStore((s) => s.remoteVolume);
  const [draft, setDraft] = useState(null);
  if (!activeDevice || isLocalActive || activeDevice.isLocal) return null;
  if (activeDevice.supportsVolume === false) return <p className="room-mono mt-2 text-center text-[var(--room-faint)]">{activeDevice.name} won't take volume from apps</p>;
  const shown = draft ?? remoteVolume ?? 50;
  const settle = () => setDraft(null);
  return (
    <div className="mt-1 flex items-center gap-3 text-[var(--room-faint)]">
      <Volume1 className="h-4 w-4 shrink-0" />
      <input type="range" min="0" max="100" value={shown} aria-label={`Volume on ${activeDevice.name}`}
        onChange={(e) => { const v = parseInt(e.target.value, 10); setDraft(v); setVolume(v); }}
        onPointerUp={settle} onTouchEnd={settle} onKeyUp={settle}
        className="zen-range reach-in-narrow h-11 min-w-0 flex-1" style={{ '--v': `${shown}%`, backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />
      <Volume2 className="h-4 w-4 shrink-0" />
    </div>
  );
}

export default function PhoneNowPlaying({ bottomInset }) {
  const playbackState = usePlayerStore((s) => s.playbackState);
  const activeDevice = usePlayerStore((s) => s.activeDevice);
  const isLocalActive = usePlayerStore((s) => s.isLocalActive);
  const showLyrics = useUserStore((s) => Boolean(s.playbackSettings?.phoneLyrics));
  const setPlaybackSetting = useUserStore((s) => s.setPlaybackSetting);
  const setDevicePickerOpen = useUserStore((s) => s.setDevicePickerOpen);
  const from = usePlayingFrom();
  const track = playbackState?.track_window?.current_track || null;
  const paused = playbackState?.paused ?? true;
  const art = track?.album?.images?.[0]?.url || null;
  const lyrics = useNowLyrics(track, playbackState?.duration, showLyrics);
  const hasLyrics = Boolean(lyrics.synced?.length || lyrics.plain?.length);

  // the cover's light behind everything, pre-blurred (WebKit drops a large CSS blur)
  const [wash, setWash] = useState({ art: null, url: null });
  useEffect(() => {
    if (!art) return undefined;
    let gone = false;
    getBlurredBackdrop(art).then((url) => { if (!gone) setWash({ art, url }); });
    return () => { gone = true; };
  }, [art]);
  const washUrl = wash.art === art ? wash.url : null;

  const device = isLocalActive ? 'This phone' : activeDevice?.name || 'Choose where it plays';
  const lyricsOn = showLyrics;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--room-ink)', color: 'var(--room-paper)', fontFamily: 'var(--font-room)' }}>
      {washUrl && <div aria-hidden="true" className="absolute inset-0 scale-110 bg-cover bg-center opacity-55" style={{ backgroundImage: `url(${washUrl})` }} />}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(13,12,18,0.25), rgba(13,12,18,0.55) 55%, var(--room-ink))' }} />

      <div className="relative flex h-full flex-col px-6 pt-[calc(env(safe-area-inset-top)+14px)]" style={{ paddingBottom: bottomInset }}>
        {/* where it comes from and where it plays; nothing to drag up here, the top edge is the system's */}
        <div className="flex items-center justify-between gap-4">
          <p className="room-mono flex min-w-0 items-center gap-2.5 text-[var(--room-faint)]"><JomifyMark size={20} className="-ml-1" /><span className="truncate">{from ? playingFromLabel(from).replace(/^Playing from /, 'From ') : ''}</span></p>
          <button type="button" onClick={() => setDevicePickerOpen(true)} className="ui-word inline-flex min-h-[44px] max-w-[55%] items-center gap-1.5 truncate" aria-label={`Playing on ${device}; choose where it plays`}>
            <Speaker className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{device}</span>
          </button>
        </div>

        {/* the cover and the song: stacked at rest, side by side when the lyrics are on */}
        <div className={`mt-3 ${lyricsOn ? 'flex items-center gap-4' : ''}`}>
          <motion.div layout transition={MOVE} className={`shrink-0 overflow-hidden rounded-[6px] bg-white/5 ${lyricsOn ? 'h-16 w-16' : 'mx-auto aspect-square w-full max-w-[min(100%,34dvh)]'}`}>
            {art && <img src={art} alt="" draggable="false" className="h-full w-full object-cover" />}
          </motion.div>
          <motion.div layout="position" transition={MOVE} className={`min-w-0 ${lyricsOn ? 'flex-1' : 'mt-5'}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className={`m-0 truncate font-semibold leading-tight tracking-[-0.02em] ${lyricsOn ? 'text-[18px]' : 'text-[24px]'}`}>{track?.name || 'Nothing playing'}</h1>
                <Artists artists={track?.artists} className="room-mono mt-1.5 block truncate text-[var(--room-dim)]" />
              </div>
              {track?.id && <span className="room-like -mr-2 flex h-11 w-11 shrink-0 items-center justify-center [&_svg]:h-5 [&_svg]:w-5"><LikeButton trackId={track.id} /></span>}
            </div>
          </motion.div>
        </div>

        {lyricsOn && (
          <div className="relative mt-4 min-h-0 flex-1" aria-label="Lyrics">
            {lyrics.loading && <p className="room-mono absolute inset-x-0 top-1/2 -translate-y-1/2 text-[var(--room-faint)]">Finding the words</p>}
            {!lyrics.loading && !hasLyrics && <p className="room-mono absolute inset-x-0 top-1/2 -translate-y-1/2 text-[var(--room-faint)]">No lyrics for this one</p>}
            {lyrics.synced?.length ? <ZenFocusLyricsLite lines={lyrics.synced} /> : lyrics.plain?.length ? <ZenPlainLyrics lines={lyrics.plain} /> : null}
          </div>
        )}

        <motion.div layout="position" transition={MOVE} className="mt-4">
          <Progress />
          <div className="mt-1 flex items-center justify-between" data-control>
            <button type="button" onClick={() => setPlaybackSetting('phoneLyrics', !lyricsOn)} aria-pressed={lyricsOn} aria-label={lyricsOn ? 'Hide lyrics' : 'Show lyrics'} className={`grid h-11 w-11 place-items-center ${lyricsOn ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)]'}`}><Mic2 className="h-5 w-5" /></button>
            <div className="flex items-center gap-7">
              <button type="button" onClick={previous} aria-label="Previous" className="grid h-11 w-11 place-items-center text-[var(--room-dim)]"><SkipBack className="h-6 w-6" /></button>
              <button type="button" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'} className="grid h-16 w-16 place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] active:scale-95">
                {paused ? <Play className="ml-0.5 h-7 w-7 fill-current" /> : <Pause className="h-7 w-7 fill-current" />}
              </button>
              <button type="button" onClick={next} aria-label="Next" className="grid h-11 w-11 place-items-center text-[var(--room-dim)]"><SkipForward className="h-6 w-6" /></button>
            </div>
            <span className="h-11 w-11" aria-hidden="true" />
          </div>
          <RemoteVolume />
        </motion.div>

        {/* up next: scrolls in place, never opens the sheet; steps aside while the lyrics are on */}
        {!lyricsOn && (
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
            <QueueColumn />
          </div>
        )}
      </div>
    </div>
  );
}
