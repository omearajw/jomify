import { useEffect, useRef } from 'react';
import { createZenRenderer } from './zenGl';
import { focusAt, fillProgress, layoutFocus, faceKey, SMALL_RATIO, wordFill, followFill, WORD_LEAD_MS } from './lyricFocus';
import { positionNow } from '../../lib/playbackClock';
import { FALLBACK_PALETTE } from './palette';

// The WebGL stage behind Zen's controls: the light, and the lyric lines as glass. It runs its own
// frame loop and never re-renders React per frame. Every line on screen eases towards where it
// belongs (current, previous, next, or leaving), so a new line, a seek, a song change or lyrics
// turned off are all the same motion, and any of them can interrupt another.


const approach = (v, to, dt, tau) => (tau <= 0 ? to : v + (to - v) * (1 - Math.exp(-dt / tau)));

export default function ZenStage({ lines, linesKey, showLyrics, palette, paused, pulse, boxRef, dotsRef, onLine, onFailed, reducedMotion }) {
  const canvasRef = useRef(null);
  const live = useRef({});
  // Read by the frame loop, which outlives any one render
  useEffect(() => {
    live.current = { lines, linesKey, showLyrics, palette: palette || FALLBACK_PALETTE, paused, pulse, onLine, reducedMotion };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let failed = false;
    const fail = (reason) => { if (!failed) { failed = true; onFailed?.(reason); } };
    const r = createZenRenderer(canvas, { onLost: fail, onFail: fail });
    if (!r) return undefined;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; r.resize(); }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const items = new Map(); // key -> the line, its texture and where it is drawn this frame
    const colours = (live.current.palette || FALLBACK_PALETTE).map((c) => c.slice());
    let t = 0, speed = 1, dim = 1, intro = 0, beat = 0, big = 60;
    let last = performance.now();
    let lastCurrent = -2;
    let raf = 0;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      try { draw(now); } catch (err) { cancelAnimationFrame(raf); fail(`drawing failed: ${err?.message || err}`); }
    };
    const draw = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      const calm = L.reducedMotion ? 0 : 1;

      speed = approach(speed, L.paused ? 0.12 : 1, dt, 0.9);
      dim = approach(dim, L.paused ? 0.82 : 1, dt, 0.9);
      intro = approach(intro, 1, dt, 0.7);
      t += dt * speed;
      const target = L.palette || FALLBACK_PALETTE;
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) colours[i][k] = approach(colours[i][k], target[i][k], dt, 0.8);

      const pos = positionNow();
      const sensed = L.pulse?.(pos);
      // Subtle: energy decides how much it breathes, but never more than a slight lift
      beat = approach(beat, (sensed?.beat ?? 0) * (0.35 + 0.4 * (sensed?.energy ?? 0.5)), dt, sensed?.live ? 0.08 : 0.12);

      // Which faces belong on stage, and where
      const box = boxRef?.current?.getBoundingClientRect();
      let targets = {};
      let focus = null;
      if (L.showLyrics && L.lines?.length && box && box.width > 0) {
        focus = focusAt(L.lines, pos);
        big = Math.round(Math.max(40, Math.min(84, box.width * 0.105)) * dpr);
        const want = [];
        if (focus.current !== null) want.push([focus.current, 'big']);
        if (focus.prev !== null) want.push([focus.prev, 'small']);
        if (focus.next !== null) want.push([focus.next, 'small']);
        let made = 0;
        for (const [index, face] of want) {
          const key = `${L.linesKey}|${faceKey(index, face)}`;
          const size = face === 'big' ? big : Math.round(big * SMALL_RATIO);
          const have = items.get(key);
          if (have && Math.abs(have.size - size) <= 1) continue;
          if (made >= 1) break; // one new texture a frame keeps a new song from hitching
          made += 1;
          if (have) r.freeLine(have.line);
          const line = r.makeLine(L.lines[index].text, size, box.width * dpr, face === 'big' ? L.lines[index].words : null);
          if (have) { have.line = line; have.size = size; } else {
            const role = face === 'big' ? 'big' : (focus.current !== null ? index < focus.current : index <= (focus.prev ?? -1)) ? 'prev' : 'next';
            items.set(key, { key, index, face, linesKey: L.linesKey, line, size, x: 0, y: 0, scale: 1, alpha: 0, glass: 0, halo: 0, litVisible: 0, lit: 0, fresh: role });
          }
        }
        const blocks = {};
        for (const it of items.values()) if (it.linesKey === L.linesKey) blocks[faceKey(it.index, it.face)] = { w: it.line.blockW, h: it.line.blockH };
        targets = layoutFocus({ focus, blocks, box: { x: box.left * dpr, y: box.top * dpr, w: box.width * dpr, h: box.height * dpr }, big });
        if (focus.current !== lastCurrent) {
          lastCurrent = focus.current;
          L.onLine?.(focus.current === null ? null : L.lines[focus.current].text);
        }
      } else if (lastCurrent !== -2) {
        lastCurrent = -2;
        L.onLine?.(null);
      }

      // Breathing dots before the first line and in instrumental breaks
      const dots = dotsRef?.current;
      if (dots) {
        const show = Boolean(focus?.gap && focus.next !== null);
        dots.style.opacity = show ? '1' : '0';
        if (show) dots.style.setProperty('--p', focus.gapProgress.toFixed(3));
      }

      // Ease every face towards its place. A face that has lost its place leaves once, in the
      // direction the song is going: up and away, the big face shrinking as it goes, while its
      // other face takes over. With lyrics off they simply fade where they are.
      const anchor = focus ? (focus.current ?? focus.next ?? Infinity) : null;
      for (const [key, it] of items) {
        let to = it.linesKey === L.linesKey ? targets[faceKey(it.index, it.face)] : null;
        if (to) it.exit = null;
        if (it.fresh && to) {
          // The first frame: begin where the line is coming from, faint
          const rise = it.fresh === 'big' ? big * 0.9 : it.fresh === 'prev' ? big * 1.0 : big * 0.5;
          it.x = to.x; it.y = to.y + rise * calm; it.scale = it.fresh === 'big' && calm ? 0.7 : 1;
          // The arriving line waits a beat for the one leaving to clear, so the two never blur together
          it.wait = it.fresh === 'big' && calm ? 0.08 : 0;
          it.fresh = null;
        }
        if (!to) {
          if (!it.exit) {
            const dir = anchor === null || it.linesKey !== L.linesKey ? 0 : it.index <= anchor ? -1 : 1;
            it.exit = { x: it.x, y: it.y + dir * big * (it.face === 'big' ? 1.0 : 0.6) * calm, scale: it.face === 'big' && dir < 0 && calm ? 0.6 : it.scale, alpha: 0, glass: 0, halo: 0, litVisible: 0 };
          }
          to = it.exit;
        }
        const move = calm ? 0.3 : 0;
        if (it.wait > 0) { it.wait -= dt; continue; }
        it.x = approach(it.x, to.x, dt, move);
        it.y = approach(it.y, to.y, dt, move);
        it.scale = approach(it.scale, to.scale, dt, move);
        it.alpha = approach(it.alpha, to.alpha, dt, it.face === 'big' && to.alpha === 0 ? 0.13 : 0.3);
        it.glass = approach(it.glass, to.glass, dt, 0.32);
        it.halo = approach(it.halo, to.halo, dt, 0.4);
        // Quick, so a new line's first word is not late to light
        it.litVisible = approach(it.litVisible, to.litVisible, dt, 0.12);
        if (focus && it.face === 'big' && it.linesKey === L.linesKey) {
          if (it.index === focus.current) {
            // Word by word where the sync has them, a moment early so it reads as in time; otherwise
            // paced to the line's length. The shader's head starts just before the line, so a
            // fraction f of the line is (f + 0.04) / 1.04.
            const f = wordFill(L.lines[it.index].words, it.line.stops, pos + WORD_LEAD_MS);
            const target = f === null ? fillProgress(L.lines, it.index, pos) : f >= 1 ? 1 : f <= 0 ? 0 : (f + 0.04) / 1.04;
            it.lit = followFill(it.lit, target, dt);
          } else if (anchor !== null && it.index < anchor) it.lit = 1;
        }
        if (to.alpha === 0 && it.alpha < 0.01) { r.freeLine(it.line); items.delete(key); }
      }

      const drawn = [...items.values()].filter((it) => it.alpha > 0.003).sort((a, b) => b.alpha - a.alpha).slice(0, 6);
      r.render({ t: t + 40, beat, intro, dim, palette: colours, items: drawn, grain: now / 1000 });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const it of items.values()) r.freeLine(it.line);
      r.destroy();
    };
    // The stage is built once per opening; everything that changes reaches it through `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />;
}

