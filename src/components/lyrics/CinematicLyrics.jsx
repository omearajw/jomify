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
// The words near the current line are glass: the text is drawn solid and an SVG lighting filter
// (GLASS_FILTERS) turns it into a clear body with a fine bright rim, a sharp highlight from the top
// left, a darker lower edge and a soft shadow. As the current line is sung it fills with light from
// left to right, row by row: a glowing copy of each row the line wrapped to, uncovered by a soft-
// edged mask on its own layer, so the glass under it is never redrawn. When the next line starts,
// the fill fades back to glass. A soft light behind the current line follows it down the list.
// WebKit runs the glass filter on the CPU, so it is never changed on a line that is already glass;
// only the line coming into range is filtered afresh. Lines further off, and the lite scene, keep a
// cheap frosted fill.
//
// Things that drew boxes in WebKit and must not come back: a text-shadow glow under filtered text
// (cut off at the line's box), a mask across wrapped inline text, a drop-shadow filter on
// background-clip:text, and -webkit-text-stroke (it traced the variable font's inner contours).

const DEPTH_RADIUS = 10;
const GLASS_RADIUS = 4;
// Without word timings, the fill is paced to the line's length, and done before the next line
const FILL_MS_PER_CHAR = 85;
const FILL_MIN_MS = 800;
const FILL_FADE_MS = 900;
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

// The rows a line actually wrapped to, read from its laid-out text, so the fill can sweep the first
// row before the second instead of both at once
function visualRows(el) {
  const node = el?.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const text = node.textContent;
  const range = document.createRange();
  const word = /\S+\s*/g;
  const out = [];
  let start = 0;
  let top = null;
  let m;
  while ((m = word.exec(text))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + 1);
    const t = range.getBoundingClientRect().top;
    if (top !== null && t > top + 4) { out.push(text.slice(start, m.index).trimEnd()); start = m.index; }
    top = t;
  }
  out.push(text.slice(start).trimEnd());
  return out.filter(Boolean);
}

function fillTiming(lines, i) {
  const start = lines[i].timeMs;
  const gap = (lines[i + 1]?.timeMs ?? Infinity) - start - 150;
  return { start, ms: Math.max(300, Math.min(Math.max(FILL_MIN_MS, lines[i].text.length * FILL_MS_PER_CHAR), gap)) };
}

// Uncover each row's glowing copy up to its share of p, with a soft leading edge
function paintFill(geom, p) {
  if (geom.p === p) return;
  geom.p = p;
  let left = p * geom.total;
  for (const part of geom.parts) {
    const f = clamp01(left / part.width);
    left -= part.width;
    const head = part.inset + f * part.width;
    const a = f >= 1 ? part.box : f <= 0 ? 0 : head - geom.soft;
    const b = f >= 1 ? part.box : f <= 0 ? 0 : head + geom.soft;
    part.el.style.setProperty('--fill-a', `${a}px`);
    part.el.style.setProperty('--fill-b', `${b}px`);
  }
}

// One filter per text size: the bevel, rim and shadow are in pixels, so each is scaled to its
// letters (s = font size / 48px). Values were tuned by eye against a reference glass effect in
// WebKit and Chromium. Built once as markup; nothing in it comes from outside.
const glassFilter = (id, s) => `
<filter id="${id}" x="-10%" y="-30%" width="120%" height="170%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceAlpha" stdDeviation="${1.4 * s}" result="bump"/>
  <feSpecularLighting in="bump" surfaceScale="6" specularConstant="1.6" specularExponent="40" lighting-color="#fff" result="spec">
    <feDistantLight azimuth="225" elevation="42"/>
  </feSpecularLighting>
  <feComponentTransfer in="spec" result="specSharp">
    <feFuncA type="table" tableValues="0 0 0.15 1 1"/>
    <feFuncR type="linear" slope="1.4"/><feFuncG type="linear" slope="1.4"/><feFuncB type="linear" slope="1.4"/>
  </feComponentTransfer>
  <feComposite in="specSharp" in2="SourceAlpha" operator="in" result="gloss"/>
  <feMorphology in="SourceAlpha" operator="erode" radius="${0.7 * s}" result="inner1"/>
  <feComposite in="SourceAlpha" in2="inner1" operator="out" result="contour"/>
  <feFlood flood-color="#0a1020" flood-opacity="0.35"/>
  <feComposite in2="contour" operator="in" result="outline"/>
  <feMorphology in="SourceAlpha" operator="erode" radius="${1.2 * s}" result="core"/>
  <feGaussianBlur in="core" stdDeviation="${1.2 * s}" result="coreSoft"/>
  <feComposite in="SourceAlpha" in2="coreSoft" operator="out" result="edge"/>
  <feFlood flood-color="#fff" flood-opacity="0.35"/>
  <feComposite in2="edge" operator="in" result="rimLight"/>
  <feOffset in="SourceAlpha" dx="${-1.4 * s}" dy="${-1.8 * s}" result="shifted"/>
  <feComposite in="SourceAlpha" in2="shifted" operator="out" result="lower"/>
  <feGaussianBlur in="lower" stdDeviation="${0.7 * s}" result="lowerSoft"/>
  <feFlood flood-color="#05070d" flood-opacity="0.45"/>
  <feComposite in2="lowerSoft" operator="in"/>
  <feComposite in2="SourceAlpha" operator="in" result="lowerDark"/>
  <feFlood flood-color="#fff" flood-opacity="0.08"/>
  <feComposite in2="SourceAlpha" operator="in" result="body"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="${2.2 * s}" result="dsBlur"/>
  <feOffset in="dsBlur" dx="${s}" dy="${3 * s}" result="dsOff"/>
  <feFlood flood-color="#000" flood-opacity="0.45"/>
  <feComposite in2="dsOff" operator="in"/>
  <feComposite in2="SourceAlpha" operator="out" result="drop"/>
  <feMerge><feMergeNode in="drop"/><feMergeNode in="body"/><feMergeNode in="rimLight"/><feMergeNode in="lowerDark"/><feMergeNode in="outline"/><feMergeNode in="gloss"/></feMerge>
</filter>`;
const GLASS_FILTERS = [['s', 0.55], ['m', 0.75], ['l', 1], ['xl', 1.25]]
  .map(([size, s]) => glassFilter(`lyric-glass-${size}`, s)).join('');

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
  const light = useRef(null);
  // The current line's fill, and the one before it fading back to glass
  const [fill, setFill] = useState(null);
  const [fading, setFading] = useState(null);
  const fillNow = useRef(null);
  const fillGeom = useRef(null);
  // Bumped when the list is laid out afresh (Zen's art column animates its width as the lyrics open,
  // so lines rewrap after they were centred), to centre and measure again
  const content = useRef(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const centredLine = useRef(null);

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
      const geom = fillGeom.current;
      if (geom && geom.index === idx) paintFill(geom, clamp01((pos - geom.start) / geom.ms));
      if (idx < 0 && dots.current && lines[0]) {
        dots.current.style.setProperty('--p', String(clamp01(pos / Math.max(1, lines[0].timeMs - LYRIC_LEAD_IN_MS))));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the current line centred: at once when the lyrics appear or the list is laid out afresh,
  // smoothly when the line moves on; a moment's grace after the user scrolls by hand. Only this box
  // scrolls: scrollIntoView also moved every scrolling parent, and on the lyrics page that slid the
  // header off the top.
  useLayoutEffect(() => {
    const row = rows.current[Math.max(0, active)];
    const box = scroller.current;
    if (light.current) {
      const lit = active >= 0 && rows.current[active];
      light.current.style.opacity = lit ? '1' : '0';
      if (lit) {
        light.current.style.transform = `translate(-50%, ${lit.offsetTop + lit.offsetHeight / 2}px) translateY(-50%)`;
        // No wider than this box, which clips what overhangs it: the oval must fade out inside it
        light.current.style.width = `${Math.min(lit.offsetWidth + 240, box?.clientWidth || 0)}px`;
        light.current.style.height = `${lit.offsetHeight + 160}px`;
      }
    }
    if (!row || !box || !pad) return;
    const top = row.offsetTop + row.offsetHeight / 2 - box.clientHeight / 2;
    const moved = centredLine.current !== active;
    centredLine.current = active;
    if (!placed.current) { placed.current = true; box.scrollTo({ top, behavior: 'auto' }); return; }
    if (nowMs() - userScrolledAt.current < USER_SCROLL_HOLD_MS) return;
    box.scrollTo({ top, behavior: moved ? 'smooth' : 'auto' });
  }, [active, pad, layoutTick]);

  // Read the rows the current line wrapped to, whenever the line or the size changes
  useLayoutEffect(() => {
    const glassText = active >= 0 ? rows.current[active]?.querySelector('.lyric-glass') : null;
    const next = glassText ? { index: active, rows: visualRows(glassText) } : null;
    const prev = fillNow.current;
    fillNow.current = next;
    if (prev && prev.index !== next?.index) setFading(prev);
    setFill(next);
  }, [active, pad, layoutTick]);

  // Measure the fill once it is on screen; the line before it is shown fully lit as it fades
  useLayoutEffect(() => {
    const old = fillGeom.current;
    if (old && old.index !== fill?.index) paintFill(old, 1);
    const host = fill ? rows.current[fill.index]?.querySelector('.lyric-fill') : null;
    if (!host) { fillGeom.current = null; return; }
    const parts = [...host.children].map((el) => {
      const cs = getComputedStyle(el);
      const inset = parseFloat(cs.paddingLeft) || 0;
      return { el, box: el.offsetWidth, inset, width: Math.max(1, el.offsetWidth - inset - (parseFloat(cs.paddingRight) || 0)) };
    });
    const soft = (parseFloat(getComputedStyle(host).fontSize) || 40) * 0.4;
    fillGeom.current = { index: fill.index, parts, total: parts.reduce((sum, part) => sum + part.width, 0), soft, p: -1, ...fillTiming(lines, fill.index) };
    paintFill(fillGeom.current, clamp01((positionMs() - fillGeom.current.start) / fillGeom.current.ms));
  }, [fill, lines]);

  useEffect(() => {
    if (!fading) return undefined;
    const timer = setTimeout(() => setFading(null), FILL_FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);

  const heldByUser = () => { userScrolledAt.current = nowMs(); };

  return (
    <div
      ref={scroller}
      onWheel={heldByUser}
      onTouchMove={heldByUser}
      // min-h-0: a flex child grows to fit its content unless told it may shrink, and a list as tall
      // as itself has nothing to scroll, so centring did nothing
      className={`relative flex-1 min-h-0 h-full w-full overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] lyrics-${variant} ${lite ? 'lyrics-lite' : ''}`}
      // An even fade at the very edges only; the line in the middle is what is lit. The page's box
      // ends at the card's edge, so its lower fade is longer or the last line looks cut off
      style={lite ? undefined : { maskImage: EDGE_FADE[variant] || EDGE_FADE.zen, WebkitMaskImage: EDGE_FADE[variant] || EDGE_FADE.zen }}
    >
      {!lite && <svg width="0" height="0" className="absolute" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLASS_FILTERS }} />}
      {!lite && <div ref={light} className="lyric-light" aria-hidden="true" />}
      <div ref={content} style={{ paddingTop: pad, paddingBottom: pad }} className="max-w-4xl mx-auto px-6 flex flex-col items-center text-center gap-4 md:gap-6">
        {lines.map((line, i) => {
          const isActive = i === active;
          const past = active >= 0 && i < active;
          const distance = active < 0 ? i + 1 : Math.abs(i - active);
          const opacity = isActive ? 1 : past ? Math.max(0.1, 0.42 - distance * 0.08) : Math.max(0.14, 0.7 - distance * 0.1);
          // Glass lines fall back by opacity and scale alone. Rows near the current line, and their
          // glass text, are on layers of their own (will-change): otherwise WebKit re-ran the glass
          // filter whenever anything in the row changed, with 150-400ms frames at each line change
          // in testing. Only near rows, because a layer per line of large text costs memory.
          const glass = !lite && distance <= GLASS_RADIUS;
          const lit = fill?.index === i ? fill : fading?.index === i ? fading : null;
          const blur = lite || glass || distance > DEPTH_RADIUS ? 0 : Math.min(3.5, 0.5 + distance * 0.45);
          return (
            <div
              key={i}
              ref={(el) => { rows.current[i] = el; }}
              onClick={() => onSeek?.(line.timeMs)}
              className="relative cursor-pointer select-none py-1 transition-[opacity,transform,filter] duration-500 ease-out hover:!opacity-90"
              style={{ opacity, transform: `scale(${isActive ? 1 : 0.94})`, filter: blur ? `blur(${blur}px)` : undefined, willChange: !lite && distance <= GLASS_RADIUS + 1 ? 'transform, opacity' : undefined }}
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
                  <p className={`lyric-line ${SIZES[variant] || SIZES.zen} ${isActive ? 'is-active' : ''} ${glass ? 'is-near' : ''}`}>
                    <span className="lyric-glass">{line.text}</span>
                    {lit && (
                      <span className={`lyric-fill ${lit === fill ? '' : 'is-fading'}`} aria-hidden="true">
                        {lit.rows.map((text, k) => <span key={k} className="lyric-fill-row">{text}</span>)}
                      </span>
                    )}
                  </p>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
