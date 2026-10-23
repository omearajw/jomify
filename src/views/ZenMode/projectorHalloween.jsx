import { useEffect, useRef } from 'react';

// Halloween on the projector (Jack, 23 Oct, for his party). The picture stays seamless: the
// background is black, which a projector shows as no light at all, so nothing here lights the
// wall around the assets. Bats and spiders are black too: invisible on the wall itself, they show
// as silhouettes only where they cross a lit asset (the art, the lyrics). Eyes and ghosts are lit,
// and keep to the dark parts of a wall.
//
// Settings live on the layout (halloweenOf in projectorLayouts.js).

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// A canvas sized to its box at the screen's pixel density, redrawn every frame by `draw(ctx, t, dt)`
function useCanvasLoop(ref, w, h, draw, deps) {
  useEffect(() => {
    const c = ref.current;
    if (!c || !w || !h) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    let raf = 0, last = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, now / 1000, dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, ...deps]);
}

// --- bats -------------------------------------------------------------------------------------

// A bat seen from the front, the classic silhouette: body upright, ears up, wings spread left and
// right with scalloped trailing edges. `s` is the wingspan; `flap` 0 (tips raised) to 1 (lowered).
function drawBat(ctx, s, flap) {
  // the tips never swing below the body: a bat with its wings down read as upside down
  const tipY = s * (-0.3 + flap * 0.3);
  ctx.beginPath();
  ctx.ellipse(0, s * 0.02, s * 0.055, s * 0.1, 0, 0, TAU);        // body
  ctx.moveTo(s * 0.05, -s * 0.09);
  ctx.ellipse(0, -s * 0.09, s * 0.05, s * 0.045, 0, 0, TAU);       // head
  ctx.fill();
  ctx.beginPath();                                                  // ears
  ctx.moveTo(-s * 0.045, -s * 0.1); ctx.lineTo(-s * 0.035, -s * 0.18); ctx.lineTo(-s * 0.012, -s * 0.11);
  ctx.moveTo(s * 0.045, -s * 0.1); ctx.lineTo(s * 0.035, -s * 0.18); ctx.lineTo(s * 0.012, -s * 0.11);
  ctx.fill();
  for (const side of [-1, 1]) {
    const shoulder = [side * s * 0.04, -s * 0.05];
    const tip = [side * s * 0.5, tipY];
    const hip = [side * s * 0.045, s * 0.08];
    ctx.beginPath();
    ctx.moveTo(shoulder[0], shoulder[1]);
    // the leading edge arcs up and out to the tip
    ctx.quadraticCurveTo(side * s * 0.24, tipY - s * 0.12 + (shoulder[1] - tipY) * 0.2, tip[0], tip[1]);
    // the trailing edge back to the hip in four scallops, each bowed in towards the body
    const n = 4;
    let from = tip;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const to = [tip[0] + (hip[0] - tip[0]) * f, tip[1] + (hip[1] - tip[1]) * f + Math.sin(f * Math.PI) * s * 0.12];
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - s * 0.07];
      ctx.quadraticCurveTo(mid[0], mid[1], to[0], to[1]);
      from = to;
    }
    ctx.closePath();
    ctx.fill();
  }
}

// Bats across the whole picture, in front of everything: a flock now and then from one side,
// each bat flapping at its own pace on a gently wavering path. `count` the most at once.
export function BatsLayer({ w, h, count }) {
  const ref = useRef(null);
  const bats = useRef([]);
  const nextFlock = useRef(0);
  useCanvasLoop(ref, w, h, (ctx, t, dt) => {
    if (t > nextFlock.current && bats.current.length < count) {
      const fromLeft = Math.random() < 0.5;
      const n = Math.min(count - bats.current.length, Math.round(rand(2, 6)));
      const y0 = rand(0.12, 0.8) * h;
      const speed = rand(0.16, 0.26) * w;
      for (let k = 0; k < n; k++) {
        const s = rand(0.09, 0.15) * h;
        bats.current.push({
          x: fromLeft ? -s * 2 - k * rand(20, 60) : w + s * 2 + k * rand(20, 60),
          y: y0 + rand(-0.08, 0.08) * h,
          vx: (fromLeft ? 1 : -1) * speed * rand(0.85, 1.15),
          s, phase: rand(0, TAU), rate: rand(7, 10), wobble: rand(0, TAU), drift: rand(-0.04, 0.04) * h
        });
      }
      nextFlock.current = t + rand(3, 7);
    }
    ctx.fillStyle = '#000';
    bats.current = bats.current.filter((b) => {
      b.x += b.vx * dt;
      b.phase += b.rate * dt;
      b.wobble += dt * 1.3;
      const y = b.y + Math.sin(b.wobble) * h * 0.03 + b.drift * Math.sin(b.wobble * 0.4);
      const flap = (Math.sin(b.phase) + 1) / 2;
      ctx.save();
      ctx.translate(b.x, y + (flap - 0.5) * b.s * 0.08);
      // leaning a little into the direction of flight, and rocking as it flaps
      ctx.rotate((b.vx > 0 ? 0.08 : -0.08) + Math.sin(b.wobble) * 0.1);
      drawBat(ctx, b.s, flap);
      ctx.restore();
      return b.vx > 0 ? b.x < w + b.s * 3 : b.x > -b.s * 3;
    });
  }, [count]);
  if (!count) return null;
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute left-0 top-0" style={{ width: w, height: h }} />;
}

// --- creatures on a wall ----------------------------------------------------------------------

// The empty parts of a wall: a spot of `rw` × `rh` (fractions) clear of every asset by `pad`
function emptySpot(rects, rw, rh, pad = 0.03) {
  for (let tries = 0; tries < 40; tries++) {
    const x = rand(0.04, 0.96 - rw), y = rand(0.05, 0.95 - rh);
    const clear = rects.every((r) => x + rw + pad < r.x || x > r.x + r.w + pad || y + rh + pad < r.y || y > r.y + r.h + pad);
    if (clear) return { x, y };
  }
  return null;
}

const EYE_COLOURS = { orange: '#ffad2a', white: '#f4f6ff' };

function drawEyes(ctx, e, bw, bh, t) {
  const size = e.size * bh;
  const cx = e.x * bw, cy = e.y * bh;
  // open (0 shut, 1 wide), with blinks
  const life = t - e.born;
  let open = Math.min(1, life / 0.6, (e.until - t) / 0.6);
  const blink = (t - e.blinkAt);
  if (blink > 0 && blink < 0.18) open *= Math.abs(blink - 0.09) / 0.09;
  if (blink > 0.18) { e.blinkAt = t + rand(2.5, 6); }
  if (open <= 0.01) return;
  const glance = Math.sin(t * 0.7 + e.seed) * 0.35 + (Math.sin(t * 2.3 + e.seed) > 0.97 ? 0.4 : 0);
  ctx.save();
  ctx.shadowColor = e.colour;
  ctx.shadowBlur = size * 0.9;
  for (const side of [-1, 1]) {
    const ex = cx + side * size * 0.9;
    ctx.save();
    ctx.translate(ex, cy);
    ctx.rotate(side * -0.18);
    ctx.scale(1, open);
    // almond eye
    ctx.beginPath();
    ctx.moveTo(-size * 0.55, 0);
    ctx.quadraticCurveTo(0, -size * 0.55, size * 0.55, 0);
    ctx.quadraticCurveTo(0, size * 0.42, -size * 0.55, 0);
    ctx.fillStyle = e.colour;
    ctx.fill();
    // slit pupil
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(glance * size * 0.25, 0, size * 0.07, size * 0.3, 0, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawGhost(ctx, g, bw, bh, t) {
  const s = g.size * bh;
  const life = t - g.born;
  const fade = Math.max(0, Math.min(1, life / 2, (g.until - t) / 2));
  if (!fade) return;
  const x = g.x * bw + Math.sin(t * 0.3 + g.seed) * bw * 0.04 + (t - g.born) * g.vx * bw;
  const y = g.y * bh + Math.sin(t * 0.9 + g.seed) * s * 0.12;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = fade * g.alpha;
  // pale and glowing at the head, thinning to nothing at the hem
  const grad = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
  grad.addColorStop(0, 'rgba(245,248,255,1)');
  grad.addColorStop(0.55, 'rgba(225,232,255,0.8)');
  grad.addColorStop(1, 'rgba(200,212,255,0.05)');
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(210,222,255,0.9)';
  ctx.shadowBlur = s * 0.45;
  // a sheet: round top, a hem that ripples in a smooth wave
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, s * 0.32);
  ctx.bezierCurveTo(-s * 0.38, -s * 0.58, s * 0.38, -s * 0.58, s * 0.3, s * 0.32);
  for (let k = 16; k >= 0; k--) {
    const f = k / 16;
    ctx.lineTo(-s * 0.3 + f * s * 0.6, s * 0.32 + Math.sin(f * Math.PI * 3 + t * 2.4 + g.seed) * s * 0.055);
  }
  ctx.closePath();
  ctx.fill();
  // hollow eyes and mouth
  ctx.globalCompositeOperation = 'destination-out';
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * s * 0.1, -s * 0.12, s * 0.045, s * 0.07, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(0, s * 0.03, s * 0.05, s * 0.07, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawSpider(ctx, sp, bw, bh, t) {
  const s = sp.size * bh;
  // down from the top over `drop` of the way, hangs, bobs, climbs back
  const p = (t - sp.born) / sp.span;
  const reach = p < 0.3 ? p / 0.3 : p < 0.75 ? 1 : Math.max(0, 1 - (p - 0.75) / 0.25);
  const ease = 1 - Math.pow(1 - reach, 2);
  const x = sp.x * bw;
  const top = sp.top * bh;
  const y = top + ease * sp.drop * bh + Math.sin(t * 2.2 + sp.seed) * s * 0.15 * (p > 0.3 && p < 0.75 ? 1 : 0.2);
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  // the thread
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
  // eight legs, wriggling
  ctx.lineWidth = Math.max(1.2, s * 0.045);
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const a = (-0.6 + k * 0.42) + Math.sin(t * 7 + k + sp.seed) * 0.12;
      const kx = x + side * Math.cos(a) * s * 0.42, ky = y + Math.sin(a) * s * 0.42;
      const fx = x + side * Math.cos(a + 0.5) * s * 0.75, fy = y + Math.sin(a + 0.5) * s * 0.75 + s * 0.12;
      ctx.beginPath(); ctx.moveTo(x + side * s * 0.08, y); ctx.lineTo(kx, ky - s * 0.12); ctx.lineTo(fx, fy); ctx.stroke();
    }
  }
  // body and head
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.05, s * 0.2, s * 0.25, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.22, s * 0.12, s * 0.11, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// Eyes, ghosts and spiders on one wall, drawn flat on the wall's rectangle (bw × bh) and warped
// with it. `rects` are the wall's assets, in fractions, kept clear of by the lit creatures.
export function WallCreatures({ bw, bh, rects, settings }) {
  const ref = useRef(null);
  const live = useRef({ eyes: [], ghosts: [], spiders: [], nextEyes: 0, nextGhost: 0, nextSpider: 0 });
  const rectKey = rects.map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)},${r.h.toFixed(3)}`).join(';');
  const { eyes, eyeColour, ghosts, spiders } = settings;
  const any = eyes || ghosts || spiders;
  useCanvasLoop(ref, bw, bh, (ctx, t) => {
    const L = live.current;
    // what a new eye pair or ghost keeps clear of: the assets, and every lit creature already out
    const lit = () => [...rects, ...L.eyes.map((e) => ({ x: e.x - 0.1, y: e.y - 0.06, w: 0.2, h: 0.12 })), ...L.ghosts.map((g) => ({ x: g.x - 0.12, y: g.y - 0.15, w: 0.24, h: 0.3 }))];
    // eyes: pairs open in the dark parts, stay a while, close; another pair elsewhere
    L.eyes = L.eyes.filter((e) => t < e.until);
    if (L.eyes.length < eyes && t > L.nextEyes) {
      const spot = emptySpot(lit(), 0.18, 0.11);
      if (spot) L.eyes.push({ x: spot.x + 0.09, y: spot.y + 0.055, size: rand(0.04, 0.065), born: t, until: t + rand(7, 16), blinkAt: t + rand(1.5, 4), seed: rand(0, 100), colour: EYE_COLOURS[eyeColour] || EYE_COLOURS.orange });
      L.nextEyes = t + rand(1.5, 5);
    }
    // ghosts: drift across slowly, faint
    L.ghosts = L.ghosts.filter((g) => t < g.until);
    if (L.ghosts.length < ghosts && t > L.nextGhost) {
      const spot = emptySpot(lit(), 0.14, 0.2, 0.01);
      if (spot) L.ghosts.push({ x: spot.x + 0.07, y: spot.y + 0.1, vx: rand(-0.012, 0.012), size: rand(0.16, 0.24), alpha: rand(0.5, 0.7), born: t, until: t + rand(10, 18), seed: rand(0, 100) });
      L.nextGhost = t + rand(4, 9);
    }
    // spiders: drop over an asset on a thread, seen only against it
    L.spiders = L.spiders.filter((s) => t < s.born + s.span);
    if (L.spiders.length < spiders && rects.length && t > L.nextSpider) {
      const r = rects[Math.floor(Math.random() * rects.length)];
      L.spiders.push({ x: r.x + rand(0.15, 0.85) * r.w, top: r.y, drop: r.h * rand(0.3, 0.6), size: rand(0.035, 0.05), born: t, span: rand(9, 14), seed: rand(0, 100) });
      L.nextSpider = t + rand(4, 10);
    }
    L.ghosts.forEach((g) => drawGhost(ctx, g, bw, bh, t));
    L.eyes.forEach((e) => drawEyes(ctx, e, bw, bh, t));
    L.spiders.forEach((s) => drawSpider(ctx, s, bw, bh, t));
  }, [rectKey, eyes, eyeColour, ghosts, spiders]);
  if (!any) return null;
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute left-0 top-0" style={{ width: bw, height: bh }} />;
}
