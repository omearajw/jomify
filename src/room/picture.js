import { useUserStore } from '../store/userStore';

// Shows a picture large (PictureViewer.jsx), growing from the element it sat in. Spotify sends
// each picture at a few sizes; the largest is the one worth looking at.
export function showPicture(el, images, name) {
  const url = [...(images || [])].filter((i) => i?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
  if (!url || !el) return;
  const r = el.getBoundingClientRect();
  useUserStore.getState().setBigPicture({ url, name, from: { x: r.left, y: r.top, w: r.width, h: r.height } });
}
