import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import AudioWaveform from '../AudioWaveform';

// Synced lyrics, shared by Zen mode and the lyrics page so the two can't drift apart.
//
// It keeps its own clock from the player's last known position, so it opens on the line being
// sung: Zen used to work the line out before the list was on screen, scroll to nothing, and sit
// at the top until the next line. The current line is always centred, first and last included
// (the list is padded by half its own height), and lines further from it fall back in depth.
// The words are frosted glass (see .lyric-glass in index.css). The current line has a second, lit
// copy over it that fades in when the line comes round, its bloom made of text shadows, which
// follow the letters. (A drop-shadow filter on clipped-background text drew a box in WebKit.)

const DEPTH_RADIUS = 10;
const USER_SCROLL_HOLD_MS = 4000;

const positionMs = () => {
  const { playbackState, positionAt } = usePlayerStore.getState();
  if (!playbackState) return 0;
  return playbackState.position + (playbackState.paused ? 0 : Date.now() - positionAt);
};
const lineAt = (lines, pos) => {
  let found = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].timeMs <= pos + LYRIC_LEAD_IN_MS) found = i; else break; }
  return found;
};
const isInstrumental = (line) => !line.text || line.text.trim() === '♪' || /instrumental/i.test(line.text);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const nowMs = () => Date.now();

const EDGE_FADE = {
  zen: 'linear-gradient(to bottom, transparent 0, black 9%, black 91%, transparent 100%)',
  page: 'linear-gradient(to bottom, transparent 0, black 9%, black 80%, transparent 100%)'
};

const SIZES = {
  zen: 'text-2xl md:text-4xl lg:text-5xl',
  page: 'text-3xl md:text-5xl lg:text-6xl'
};

export default function CinematicLyrics({ lines, onSeek, variant = 'zen', lite = false }) {
  const [active, setActive] = useState(() => lineAt(lines, positionMs()));
  const [pad, setPad] = useState(0);
  const scroller = useRef(null);
  const rows = useRef([]);
  const dots = useRef(null);
  const userScrolledAt = useRef(0);
  const placed = useRef(false);

  // Room above the first line and below the last, so any line can sit in the middle. Taken from
  // the window, never from this box: where no parent fixes the box's height (the lyrics page),
  // padding by its own height grew it, which grew the padding, until it was a million pixels tall.
  useLayoutEffect(() => {
    const measure = () => setPad(Math.round(window.innerHeight * 0.42));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // The clock: which line is current, how far through it, and the intro before the first
  useEffect(() => {
    let raf = 0;
    let last = -2;
    const tick = () => {
      const pos = positionMs();
      const idx = lineAt(lines, pos);
      if (idx !== last) { last = idx; setActive(idx); }
      if (idx < 0 && dots.current && lines[0]) {
        dots.current.style.setProperty('--p', String(clamp01(pos / Math.max(1, lines[0].timeMs - LYRIC_LEAD_IN_MS))));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  // Keep the current line centred: at once when the lyrics appear, smoothly after; a moment's
  // grace after the user scrolls by hand. Only this box scrolls: scrollIntoView also moved every
  // scrolling parent, and on the lyrics page that slid the header off the top.
  useLayoutEffect(() => {
    const row = rows.current[Math.max(0, active)];
    const box = scroller.current;
    if (!row || !box || !pad) return;
    const top = row.offsetTop + row.offsetHeight / 2 - box.clientHeight / 2;
    if (!placed.current) { placed.current = true; box.scrollTo({ top, behavior: 'auto' }); return; }
    if (nowMs() - userScrolledAt.current < USER_SCROLL_HOLD_MS) return;
    box.scrollTo({ top, behavior: 'smooth' });
  }, [active, pad]);

  const heldByUser = () => { userScrolledAt.current = nowMs(); };

  return (
    <div
      ref={scroller}
      onWheel={heldByUser}
      onTouchMove={heldByUser}
      // min-h-0: a flex child grows to fit its content unless told it may shrink, and a list as tall
      // as itself has nothing to scroll, so centring did nothing
      className={`relative flex-1 min-h-0 h-full w-full overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] ${lite ? 'lyrics-lite' : ''}`}
      // An even fade at the very edges only; the line in the middle is what is lit. The page's box
      // ends at the card's edge, so its lower fade is longer or the last line looks cut off
      style={lite ? undefined : { maskImage: EDGE_FADE[variant] || EDGE_FADE.zen, WebkitMaskImage: EDGE_FADE[variant] || EDGE_FADE.zen }}
    >
      <div style={{ paddingTop: pad, paddingBottom: pad }} className="max-w-4xl mx-auto px-6 flex flex-col items-center text-center gap-4 md:gap-6">
        {lines.map((line, i) => {
          const isActive = i === active;
          const past = active >= 0 && i < active;
          const distance = active < 0 ? i + 1 : Math.abs(i - active);
          const opacity = isActive ? 1 : past ? Math.max(0.1, 0.42 - distance * 0.08) : Math.max(0.14, 0.7 - distance * 0.1);
          const blur = lite || isActive || distance > DEPTH_RADIUS ? 0 : Math.min(3.5, 0.5 + distance * 0.45);
          return (
            <div
              key={i}
              ref={(el) => { rows.current[i] = el; }}
              onClick={() => onSeek?.(line.timeMs)}
              className="relative cursor-pointer select-none py-1 transition-[opacity,transform,filter] duration-500 ease-out hover:!opacity-90"
              style={{ opacity, transform: `scale(${isActive ? 1 : 0.94})`, filter: blur ? `blur(${blur}px)` : undefined }}
            >
              {i === 0 && active < 0 && (
                <div ref={dots} className="flex justify-center gap-2.5 mb-5" aria-label="The singing starts soon">
                  {[0, 1, 2].map((k) => (
                    <span key={k} className="w-3 h-3 rounded-full bg-white/90 shadow-[0_0_14px_rgba(255,255,255,0.6)]" style={{ opacity: `clamp(0.18, calc(var(--p, 0) * 3 - ${k}), 1)`, transform: `scale(clamp(0.7, calc(0.7 + (var(--p, 0) * 3 - ${k}) * 0.3), 1))` }} />
                  ))}
                </div>
              )}
              {isInstrumental(line)
                ? <AudioWaveform size={variant === 'zen' ? 'lg' : 'md'} isActive={isActive} />
                : (
                  <p className={`lyric-line ${SIZES[variant] || SIZES.zen} ${isActive ? 'is-active' : ''}`}>
                    <span className="lyric-glass">{line.text}</span>
                    <span className="lyric-lit" aria-hidden="true">{line.text}</span>
                  </p>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
