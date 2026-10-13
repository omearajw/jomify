import { useEffect, useRef } from 'react';
import { createZenRenderer } from './zenGl';
import { focusAt, fillProgress, layoutFocus, faceKey, SMALL_RATIO, wordFill, followFill, WORD_LEAD_MS, chorusLines, endingAt } from './lyricFocus';
import { positionNow } from '../../lib/playbackClock';
import { FALLBACK_PALETTE } from './palette';
import { sceneFor } from './scenes';

// The WebGL stage behind Zen's controls: the light, and the lyric lines as glass. It runs its own
// frame loop and never re-renders React per frame. Every line on screen eases towards where it
// belongs (current, previous, next, or leaving), so a new line, a seek, a song change or lyrics
// turned off are all the same motion, and any of them can interrupt another.


const approach = (v, to, dt, tau) => (tau <= 0 ? to : v + (to - v) * (1 - Math.exp(-dt / tau)));

// A song's own scene (scenes/): the stage fades it over the light, carries the cover from the
// screen onto the scene and back, and tells Zen when the handover is done so the layout can follow
export default function ZenStage({ lines, linesKey, showLyrics, palette, paused, pulse, character, boxRef, dotsRef, onLine, onFailed, reducedMotion, track, durationMs, coverRef, coverUrl, onScene, lyricAlign }) {
  const canvasRef = useRef(null);
  const live = useRef({});
  // Read by the frame loop, which outlives any one render
  useEffect(() => {
    live.current = { lines, linesKey, showLyrics, palette: palette || FALLBACK_PALETTE, paused, pulse, character, onLine, reducedMotion, track, durationMs, coverRef, coverUrl, onScene, lyricAlign };
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
    // The song's character, eased so a new song's scene arrives over a few seconds
    const mood = { energy: 0.5, valence: 0.5, acoustic: 0, minor: 0, lift: 0 };
    let ending = 0;
    let chorus = { key: null, set: new Set() };
    let last = performance.now();
    let lastCurrent = -2;
    let raf = 0;

    // The song's scene, if it has one. fade runs 0..1 as it comes up over the light; the cover's
    // handover: 'screen' (the DOM cover where Zen put it), 'flying' (carried towards the sleeve),
    // 'scene' (the sleeve drawn in the room), and back. The DOM cover is moved by its transform
    // alone, so React's layout never sees it move.
    let scene = null; // { def, room, trackId, schedule, fade, hand, flyAt, from }
    const HANDOVER_MS = 1400;
    const coverImage = { url: null, img: null };
    const easeFly = (u) => 1 - Math.pow(1 - u, 3);
    const endScene = () => { if (!scene) return; scene.room.destroy(); scene = null; };
    const coverEl = () => live.current.coverRef?.current;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      try { draw(now); } catch (err) { cancelAnimationFrame(raf); fail(`drawing failed: ${err?.message || err}`); }
    };
    const draw = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      const calm = L.reducedMotion ? 0 : 1;

      const ch = L.character;
      mood.energy = approach(mood.energy, ch ? ch.energy : 0.5, dt, 2.5);
      mood.valence = approach(mood.valence, ch ? ch.valence : 0.5, dt, 2.5);
      mood.acoustic = approach(mood.acoustic, ch ? ch.acousticness : 0, dt, 2.5);
      mood.minor = approach(mood.minor, ch && ch.mode === 0 ? 1 : 0, dt, 2.5);
      // Calm songs drift slowly, energetic ones move along
      speed = approach(speed, L.paused ? 0.12 : 0.55 + 0.95 * mood.energy, dt, 0.9);
      dim = approach(dim, (L.paused ? 0.82 : 1) * (1 - 0.35 * ending), dt, 0.9);
      intro = approach(intro, 1, dt, 0.7);
      t += dt * speed;
      const target = L.palette || FALLBACK_PALETTE;
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) colours[i][k] = approach(colours[i][k], target[i][k], dt, 0.8);

      const pos = positionNow();
      const sensed = L.pulse?.(pos);

      // Which scene the song wants, and the handover of the cover between the screen and the room
      const want = sceneFor(L.track);
      const trackId = L.track?.id || null;
      if (scene && (!want || scene.trackId !== trackId) && scene.hand !== 'leaving' && scene.hand !== 'returning') {
        // the song has changed: the sleeve hands the cover back to the screen as the room fades
        scene.hand = 'leaving'; scene.flyAt = now; scene.leaveFrom = null;
        L.onScene?.({ phase: 'leaving' });
      }
      if (!scene && want) {
        try {
          scene = { def: want, room: want.create(r), trackId, schedule: null, fade: 0, hand: 'screen', flyAt: now, from: null, linesKey: null };
          L.onScene?.({ phase: 'entering' });
        } catch (err) { fail(`scene failed: ${err?.message || err}`); }
      }
      let drawScene = null;
      if (scene) {
        const sc = scene;
        const leaving = sc.hand === 'leaving' || sc.hand === 'returning';
        sc.fade = approach(sc.fade, leaving ? 0 : 1, dt, leaving ? 0.9 : 1.1);
        if (sc.schedule === null || sc.linesKey !== L.linesKey) { sc.schedule = sc.def.schedule({ lines: L.lines, durationMs: L.durationMs, trackId }); sc.linesKey = L.linesKey; }
        const state = sc.def.stateAt(sc.schedule, pos);
        // the cover's picture, for the sleeve
        if (L.coverUrl && coverImage.url !== L.coverUrl) {
          coverImage.url = L.coverUrl; coverImage.img = null;
          const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { if (coverImage.url === L.coverUrl) coverImage.img = img; }; img.src = L.coverUrl;
        }
        if (coverImage.img) sc.room.setCover(coverImage.img, coverImage.url);
        const el = coverEl();
        const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
        const box = sc.def.sleeveScreenBox(state.two, cssW, cssH);
        // The handover: the DOM cover flies from where Zen laid it out to the sleeve's place on
        // screen, then the sleeve takes over; and the reverse on the way out
        const flyTo = (fromRect, u) => {
          if (!el || !fromRect) return;
          const e = easeFly(u);
          const sx = box.w / fromRect.width, sy = box.h / fromRect.height;
          const tx = (box.x - fromRect.left) * e, ty = (box.y - fromRect.top) * e;
          el.style.transformOrigin = '0 0';
          el.style.transform = `translate(${tx}px, ${ty}px) scale(${1 + (sx - 1) * e}, ${1 + (sy - 1) * e})`;
          el.style.opacity = String(1 - Math.max(0, (e - 0.85) / 0.15));
        };
        if (sc.hand === 'screen' && sc.fade > 0.35 && el) { sc.hand = 'flying'; sc.flyAt = now; sc.from = el.getBoundingClientRect(); L.onScene?.({ phase: 'flying' }); }
        if (sc.hand === 'flying') {
          const u = Math.min(1, (now - sc.flyAt) / (calm ? HANDOVER_MS : 1));
          flyTo(sc.from, u);
          if (u >= 1) { sc.hand = 'scene'; L.onScene?.({ phase: 'scene' }); }
        }
        if (sc.hand === 'leaving') {
          // the screen's cover is laid out again (hidden) first; once it has a place, fly back to it
          if (el && !sc.leaveFrom) { const rect = el.getBoundingClientRect(); if (rect.width > 0) { sc.leaveFrom = rect; sc.flyAt = now; sc.hand = 'returning'; } }
        }
        if (sc.hand === 'returning') {
          const u = Math.min(1, (now - sc.flyAt) / (calm ? HANDOVER_MS : 1));
          flyTo(sc.leaveFrom, 1 - u);
          if (u >= 1) { if (el) { el.style.transform = ''; el.style.opacity = ''; } L.onScene?.({ phase: 'off' }); endScene(); }
        }
        if (scene) {
          const sleeve = sc.hand === 'scene' || sc.hand === 'leaving' ? 1 : sc.hand === 'flying' ? Math.max(0, ((now - sc.flyAt) / HANDOVER_MS - 0.85) / 0.15) : sc.hand === 'returning' ? Math.max(0, 1 - ((now - sc.flyAt) / HANDOVER_MS) / 0.15) : 0;
          const fade = sc.fade, roomDim = dim;
          drawScene = () => sc.room.draw({ state, t: now / 1000, fade, dim: roomDim, sleeve: Math.min(1, sleeve) });
        }
      }

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
        targets = layoutFocus({ focus, blocks, box: { x: box.left * dpr, y: box.top * dpr, w: box.width * dpr, h: box.height * dpr }, big, align: L.lyricAlign || 'left' });
        if (focus.current !== lastCurrent) {
          lastCurrent = focus.current;
          L.onLine?.(focus.current === null ? null : L.lines[focus.current].text);
        }
      } else if (lastCurrent !== -2) {
        lastCurrent = -2;
        L.onLine?.(null);
      }

      // The chorus opens the light up; the last line lets it settle, like closing credits
      if (L.lines?.length && chorus.key !== L.linesKey) chorus = { key: L.linesKey, set: chorusLines(L.lines) };
      const inChorus = Boolean(focus && focus.current !== null && chorus.key === L.linesKey && chorus.set.has(focus.current));
      mood.lift = approach(mood.lift, inChorus && !L.paused ? 1 : 0, dt, inChorus ? 0.8 : 1.6);
      ending = approach(ending, L.showLyrics && L.lines?.length ? endingAt(L.lines, pos) : 0, dt, 1.2);

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
      r.render({ t: t + 40, beat, intro, dim, palette: colours, items: drawn, grain: now / 1000, mood, drawScene });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const it of items.values()) r.freeLine(it.line);
      endScene();
      r.destroy();
    };
    // The stage is built once per opening; everything that changes reaches it through `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />;
}

