// The colours of Zen's light, taken from the cover: its two main hues by area, weighted by how
// coloured each pixel is, plus its average for the deep base. Picking the most saturated pixels
// instead chose Currents' thin red line and gold drip over the purple that fills the cover.

import { loadArt } from '../../utils/blurBackdrop.js';

// Jomify's own pink and a cool blue, for covers with almost no colour (White Pony)
export const FALLBACK_PALETTE = [[0.98, 0.15, 0.42], [0.35, 0.55, 1.0], [0.5, 0.45, 0.6]];

function hsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const s = mx ? (mx - mn) / mx : 0;
  let h = 0;
  if (mx !== mn) {
    if (mx === r) h = ((g - b) / (mx - mn)) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
  }
  return { h: (h * 60 + 360) % 360, s, v: mx };
}

const lift = (c, to) => {
  const m = Math.max(c[0], c[1], c[2]) || 1;
  return c.map((v) => (v / m) * to);
};

// pixels: RGBA bytes, as from getImageData
export function paletteFromPixels(pixels) {
  const bins = Array.from({ length: 12 }, (_, i) => ({ i, w: 0, r: 0, g: 0, b: 0 }));
  const avg = [0, 0, 0];
  let count = 0;
  for (let k = 0; k + 3 < pixels.length; k += 4) {
    const r = pixels[k] / 255;
    const g = pixels[k + 1] / 255;
    const b = pixels[k + 2] / 255;
    avg[0] += r; avg[1] += g; avg[2] += b; count += 1;
    const { h, s, v } = hsv(r, g, b);
    const w = s * v * v;
    if (w < 0.04) continue;
    const bin = bins[Math.floor(h / 30) % 12];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  if (!count) return FALLBACK_PALETTE;
  const mean = avg.map((v) => v / count);
  const ranked = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const first = ranked[0];
  if (!first || first.w / count < 0.03) return [FALLBACK_PALETTE[0], FALLBACK_PALETTE[1], lift(mean, 0.75)];
  const hueGap = (b) => Math.min(Math.abs(b.i - first.i), 12 - Math.abs(b.i - first.i));
  const other = ranked.find((b) => hueGap(b) >= 2 && b.w > first.w * 0.08) || ranked[1];
  const colour = (b) => [b.r / b.w, b.g / b.w, b.b / b.w];
  const second = other ? colour(other) : colour(first).slice().reverse();
  return [lift(colour(first), 1), lift(second, 0.9), lift(mean, 0.7)];
}

const cache = new Map();

export function paletteForArt(url) {
  if (!url) return Promise.resolve(FALLBACK_PALETTE);
  if (cache.has(url)) return cache.get(url);
  const work = loadArt(url).then((img) => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 32);
    return paletteFromPixels(ctx.getImageData(0, 0, 32, 32).data);
  }).catch(() => FALLBACK_PALETTE);
  cache.set(url, work);
  return work;
}

// For CSS: the accent (a light tint of the main colour) and its glow
export function paletteCss([c1]) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return {
    accent: `rgb(${c1.map((v) => to255(v * 0.6 + 0.4)).join(',')})`,
    glow: `rgba(${c1.map(to255).join(',')},0.45)`
  };
}
