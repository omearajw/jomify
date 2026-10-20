import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '../../store/playerStore';
import { positionNow } from '../../lib/playbackClock';
import { focusAt } from './lyricFocus';

// Zen's lyrics without WebGL: the lite scene, or a device whose WebGL failed. The same staging as
// the glass (one line large, the ones either side small) in plain text, and the same calm motion.


function useFocus(lines) {
  const [focus, setFocus] = useState(() => focusAt(lines, positionNow()));
  useEffect(() => {
    const id = setInterval(() => {
      const next = focusAt(lines, positionNow());
      setFocus((was) => (was.current === next.current && was.prev === next.prev && was.next === next.next && was.gap === next.gap ? was : next));
    }, 120);
    return () => clearInterval(id);
  }, [lines]);
  return focus;
}

export function ZenFocusLyricsLite({ lines }) {
  const focus = useFocus(lines);
  const shown = [focus.prev, focus.current, focus.next].filter((i) => i !== null);
  // A long line shrinks, with the ones either side, until the three fit the box's height (Jack,
  // 20 Oct: they ran out of it). Measured on an unseen copy with no transitions, so the size is
  // the one being eased to, not one on the way; the shown lines ease to it. (Inline: the line's
  // own transition is unlayered CSS and beats any Tailwind class.)
  const boxRef = useRef(null);
  const copyRef = useRef(null);
  const shownKey = shown.join(',');
  useLayoutEffect(() => {
    const box = boxRef.current, copy = copyRef.current;
    if (!box || !copy) return undefined;
    const fit = () => {
      let f = 1;
      for (let k = 0; k < 8; k++) {
        copy.style.setProperty('--fit', f);
        const over = copy.offsetHeight / box.clientHeight;
        if (over <= 1 || f <= 0.35) break;
        f = Math.max(0.35, f * Math.max(0.7, 1 / Math.sqrt(over)));
      }
      box.style.setProperty('--fit', f);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [shownKey]);
  return (
    <div ref={boxRef} className="@container absolute inset-0 flex flex-col justify-center gap-6">
      <div ref={copyRef} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-col gap-6">
        {shown.map((i) => <p key={i} className={`zen-lite-line font-extrabold tracking-tight leading-[1.1] ${i === focus.current ? 'is-current' : ''}`} style={{ transition: 'none' }}>{lines[i].text}</p>)}
      </div>
      <AnimatePresence initial mode="popLayout">
        {shown.map((i) => {
          const isCurrent = i === focus.current;
          return (
            <motion.p
              key={i}
              layout="position"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: isCurrent ? 1 : 0.32, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className={`zen-lite-line font-extrabold tracking-tight leading-[1.1] text-white ${isCurrent ? 'is-current' : ''}`}
            >
              {lines[i].text}
            </motion.p>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Lyrics with no timings: the whole text, drifting past at the pace of the song, which is about
// where the words are. A scroll by hand holds it for a few seconds.
export function ZenPlainLyrics({ lines }) {
  const box = useRef(null);
  const heldAt = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current;
      const { playbackState } = usePlayerStore.getState();
      if (!el || !playbackState?.duration || Date.now() - heldAt.current < 4000) return;
      const to = (positionNow() / playbackState.duration) * (el.scrollHeight - el.clientHeight);
      el.scrollTop += (to - el.scrollTop) * 0.05;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const hold = () => { heldAt.current = Date.now(); };
  return (
    <div
      ref={box}
      onWheel={hold}
      onTouchMove={hold}
      className="absolute inset-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)] py-[22vh]"
    >
      {lines.map((line, i) => (
        <p key={i} className="text-2xl md:text-3xl font-bold tracking-tight leading-snug text-white/75 mb-5">{line || ' '}</p>
      ))}
    </div>
  );
}
