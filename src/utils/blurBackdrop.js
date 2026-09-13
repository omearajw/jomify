// ZenMode's wash of colour behind the album art used to be the art itself, full-viewport, under a
// 120-150px CSS blur on two layers (one spinning). That is the most expensive rasterisation in
// the app and the reason entering ZenMode hitched. Blurring a 48px copy on a canvas once and
// stretching that up gives the same soft wash for nothing per frame.

const SIZE = 48;
const cache = new Map(); // art url -> blob url (or null when the canvas tainted)

export function getBlurredBackdrop(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if ('filter' in ctx) ctx.filter = 'blur(3px) saturate(2)';
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        canvas.toBlob((blob) => {
          const out = blob ? URL.createObjectURL(blob) : null;
          cache.set(url, out);
          resolve(out);
        }, 'image/png');
      } catch {
        // Tainted canvas (no CORS on the image): the caller falls back to a CSS blur
        cache.set(url, null);
        resolve(null);
      }
    };
    img.onerror = () => { cache.set(url, null); resolve(null); };
    img.src = url;
  });
}
