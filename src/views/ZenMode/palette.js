// The colours of Zen's light, taken from the cover: its two main hues by area, weighted by how
// coloured each pixel is, plus its average for the deep base. Picking the most saturated pixels
// instead chose Currents' thin red line and gold drip over the purple that fills the cover; and
// counting only bright, saturated pixels called most covers colourless (After Hours' red too).

import { loadArt } from '../../utils/blurBackdrop.js';

// Jomify's own pink and a cool blue, for when the cover cannot be read at all
export const FALLBACK_PALETTE = [[0.98, 0.15, 0.42], [0.35, 0.55, 1.0], [0.5, 0.45, 0.6]];

// Black can't be light (adding black adds nothing), so a black-and-white cover is drawn in white
// light: a bright silver and a dimmer one. Kept below full white so it sits at about the
// brightness of the coloured ribbons. Neutral: a blue cast here was bent through the lyrics' glass
// as a blue light no cover had (Jack, 19 Oct).
export const SILVER = [0.87, 0.87, 0.88];
export const DIM_SILVER = [0.65, 0.65, 0.66];

// The second shade of a cover with only one colour: that colour, paled towards white, so a gold
// cover is gold and pale-gold light rather than gold and an invented colour
const paled = (c) => lift(c.map((v) => v + (1 - v) * 0.55), 0.82);

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
    // Coloured enough to count: grey, near-black and near-white pixels say nothing about the hue
    if (s < 0.18 || v < 0.12) continue;
    const w = s * Math.sqrt(v);
    const bin = bins[Math.floor(h / 30) % 12];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  if (!count) return FALLBACK_PALETTE;
  const mean = avg.map((v) => v / count);
  const ranked = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const first = ranked[0];
  // Only a cover with almost no colour at all (black and white, greys) borrows Jomify's own
  if (!first || first.w / count < 0.008) return [SILVER, DIM_SILVER, lift(mean, 0.75)];
  const hueGap = (b) => Math.min(Math.abs(b.i - first.i), 12 - Math.abs(b.i - first.i));
  // A second colour only if the cover really has one; otherwise the first, paled
  const other = ranked.find((b) => hueGap(b) >= 2 && b.w > first.w * 0.08);
  const colour = (b) => [b.r / b.w, b.g / b.w, b.b / b.w];
  if (!other) return [lift(colour(first), 1), paled(lift(colour(first), 1)), lift(mean, 0.7)];
  const second = colour(other);
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
