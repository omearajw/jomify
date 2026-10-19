import { useEffect, useRef, useState } from 'react';
import { getBlurredBackdrop } from '../utils/blurBackdrop';
import { useRoomStore } from './roomStore';
import { useLyricsView } from '../views/Lyrics/useLyricsView';
import { ZenFocusLyricsLite, ZenPlainLyrics } from '../views/ZenMode/ZenLyricsDom';
import { lineAt } from '../views/ZenMode/lyricFocus';
import { positionNow } from '../lib/playbackClock';
import Artists from './Artists';

// The playing song's lyrics on the room's language: a small head (cover, where the words come
// from, the song) and the words filling the column, staged as the phone's room shows them
// (ZenLyricsDom). The logic is useLyricsView, shared with the old page. The old page's glass list
// let a line be clicked to play from it; here that is "Every line", the whole timed text as words
// to press, so the stage itself stays the phone's.

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, lit, children }) => <button type="button" onClick={onClick} aria-pressed={lit || undefined} className="ui-word">{children}</button>;

function State({ title, detail, action }) {
  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
      <Mono className="text-[var(--room-faint)]">{title}</Mono>
      {detail && <p className="mt-3 max-w-md text-[13px] leading-relaxed text-[var(--room-dim)]">{detail}</p>}
      {action && <p className="mt-5">{action}</p>}
    </div>
  );
}

const HOLD_MS = 4000;

function EveryLine({ lines, onSeek }) {
  const box = useRef(null);
  const heldAt = useRef(0);
  const placed = useRef(false);
  const [at, setAt] = useState(() => lineAt(lines, positionNow()));
  useEffect(() => {
    const id = setInterval(() => {
      const next = lineAt(lines, positionNow());
      setAt((was) => (was === next ? was : next));
    }, 200);
    return () => clearInterval(id);
  }, [lines]);
  // Scrolled by hand inside the box rather than scrollIntoView, which would also scroll the
  // column (or the phone's sheet) and take the head with it
  useEffect(() => {
    const el = box.current;
    const line = el?.querySelector(`[data-line="${Math.max(0, at)}"]`);
    if (!el || !line || Date.now() - heldAt.current < HOLD_MS) return;
    el.scrollTo({ top: line.offsetTop - el.clientHeight / 2 + line.offsetHeight / 2, behavior: placed.current ? 'smooth' : 'auto' });
    placed.current = true;
  }, [at]);
  const hold = () => { heldAt.current = Date.now(); };
  return (
    <div ref={box} onWheel={hold} onTouchMove={hold}
      className="absolute inset-0 overflow-y-auto overscroll-y-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]">
      <div aria-hidden="true" className="h-[40%]" />
      {lines.map((line, i) => (
        <button key={i} type="button" data-line={i} onClick={() => onSeek(line.timeMs)} title="Play from this line"
          className={`block w-full py-1.5 text-left text-[22px] font-semibold leading-snug tracking-[-0.015em] transition-colors hover:text-[var(--room-paper)] @max-md:text-[18px] ${i === at ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)]'}`}
          style={{ transitionDuration: 'var(--room-mid)' }}>
          {line.text || '♪'}
        </button>
      ))}
      <div aria-hidden="true" className="h-[40%]" />
    </div>
  );
}

export default function RoomLyrics() {
  const {
    currentTrack: track, albumArt, containerRef, fitHeight, isFullscreen, toggleFullscreen,
    plainLyrics, syncedLyrics, loading, error, notFound, retry, answeredFor, timing, handleSeek
  } = useLyricsView({ minHeight: 240, bottomGap: 'padding' });
  const [every, setEvery] = useState(false);

  // the cover's light behind the column, drawn by the layer as for a playlist's cover
  const setLight = useRoomStore((s) => s.setLight);
  useEffect(() => {
    let gone = false;
    getBlurredBackdrop(albumArt).then((url) => { if (!gone) setLight(url || null); });
    return () => { gone = true; setLight(null); };
  }, [albumArt, setLight]);

  const waiting = Boolean(track) && (loading || answeredFor !== track.id);
  const synced = !waiting && syncedLyrics?.length ? syncedLyrics : null;
  const plain = !waiting && !synced && plainLyrics.length ? plainLyrics : null;
  // Word-timed lyrics come from Jomify's own /api/lyrics (Spicy Lyrics); everything else is lrclib
  const from = timing ? 'Spicy Lyrics' : 'lrclib';
  const facts = ['Lyrics', synced ? (timing === 'words' ? 'Word sync' : 'Line sync') : plain ? 'Not synced' : null, synced || plain ? from : null].filter(Boolean).join(' · ');

  return (
    <div ref={containerRef} className="relative flex flex-col [&:fullscreen]:bg-[var(--room-solid)] [&:fullscreen]:px-12 [&:fullscreen]:py-10"
      style={{ height: fitHeight || undefined, fontFamily: 'var(--font-room)' }}>

      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 pt-1">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[4px] bg-white/5 @max-md:h-12 @max-md:w-12">
          {albumArt && <img src={albumArt} alt="" className="h-full w-full object-cover" draggable="false" />}
        </div>
        <div className="min-w-0 flex-1">
          <Mono className="truncate text-[var(--room-faint)]">{facts}</Mono>
          <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[var(--room-paper)] @max-md:text-[18px]">{track?.name || 'Nothing playing'}</h1>
          {track && <Artists artists={track.artists} className="mt-0.5 block truncate text-[13px] text-[var(--room-dim)]" />}
        </div>
        {track && (
          <span className="flex shrink-0 items-center gap-x-5 @max-md:w-full @max-md:pl-16">
            {synced && <Word onClick={() => setEvery((v) => !v)} lit={every}>Every line</Word>}
            {/* the phone sheet has no full screen of its own to give; the old page hid it there too */}
            <span className="@max-md:hidden"><Word onClick={toggleFullscreen} lit={isFullscreen}>{isFullscreen ? 'Leave full screen' : 'Full screen'}</Word></span>
          </span>
        )}
      </header>

      <div className="relative mt-6 min-h-0 flex-1 @max-md:mt-4" aria-label="Lyrics">
        {!track ? <State title="Nothing playing" detail="Play a song and its words show here." />
          : waiting ? <State title="Finding the words" />
          : synced ? (every ? <EveryLine key={track.id} lines={synced} onSeek={handleSeek} /> : <ZenFocusLyricsLite key={track.id} lines={synced} />)
          : plain ? <ZenPlainLyrics key={track.id} lines={plain} />
          : error && !notFound ? <State title="Couldn't load the words" detail={error} action={<Word onClick={retry}>Try again</Word>} />
          : <State title="No lyrics for this one" />}
      </div>
    </div>
  );
}
