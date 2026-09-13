// Spotify returns images largest first ([640, 300, 64]). A 40px thumbnail decoding a 640px JPEG
// costs ~100x the pixels it needs, and a long playlist does that once per row. Pick the smallest
// image that still covers the rendered size on this screen; mosaics with a single size (playlist
// covers) fall back to whatever is there.
export function artUrl(images, px) {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const needed = px * dpr;
  let best = null;
  for (const image of images) {
    if (!image?.url) continue;
    if (typeof image.width !== 'number') continue;
    if (image.width >= needed && (!best || image.width < best.width)) best = image;
  }
  return (best || images[0])?.url;
}
