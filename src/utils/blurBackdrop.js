// ZenMode's wash of colour behind the album art used to be the art itself, full-viewport, under a
// 120-150px CSS blur on two layers (one spinning). That is the most expensive rasterisation in
// the app and the reason entering ZenMode hitched. Blurring a small copy on a canvas once and
// stretching that up gives the same soft wash for nothing per frame.
//
// The copy is drawn with a wide margin and its edge feathered to transparent, so the layer it is
// stretched onto can spin without a rectangle ever showing: a white sleeve used to sweep its
// hard edges across the screen. Big enough, and blurred enough, that stretching it does not
// read as pixels.

const SIZE = 256;          // the canvas
const ART = 160;           // the art inside it, leaving room for the blur and the feather
const cache = new Map();   // art url -> blob url (or null when the canvas tainted)

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
        const inset = (SIZE - ART) / 2;
        if ('filter' in ctx) ctx.filter = 'blur(14px) saturate(1.8)';
        ctx.drawImage(img, inset, inset, ART, ART);
        ctx.filter = 'none';
        // Feather: keep the middle, fade to nothing well before the canvas edge
        const fade = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.18, SIZE / 2, SIZE / 2, SIZE * 0.5);
        fade.addColorStop(0, 'rgba(0,0,0,1)');
        fade.addColorStop(0.55, 'rgba(0,0,0,0.85)');
        fade.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = fade;
        ctx.fillRect(0, 0, SIZE, SIZE);
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
