import { quadBounds, isConvexQuad } from '../../utils/homography';
import { estimateAspect } from './projectorLayouts';

// Where an asset's content sits inside its box: its own shape, letterboxed, not stretched
export function contentBox(bw, bh, aspect, align = 'center') {
  if (!aspect) return { left: 0, top: 0, width: bw, height: bh };
  let width = bw;
  let height = bw / aspect;
  if (height > bh) { height = bh; width = bh * aspect; }
  const left = align === 'left' ? 0 : align === 'right' ? bw - width : (bw - width) / 2;
  return { left, top: (bh - height) / 2, width, height };
}

// The wall's flat rectangle: as wide as the quad, as tall as its shape says
export function wallRect(wall, w, h) {
  const corners = wall.corners.map(([x, y]) => [x * w, y * h]);
  const bounds = quadBounds(corners);
  const aspect = wall.aspect || estimateAspect(corners);
  const bw = Math.max(1, Math.round(bounds.width));
  const bh = Math.max(1, Math.round(bw / aspect));
  return { corners, bw, bh, aspect, convex: isConvexQuad(corners) };
}

export const itemPx = (item, bw, bh) => ({ left: item.rect.x * bw, top: item.rect.y * bh, width: Math.max(1, item.rect.w * bw), height: Math.max(1, item.rect.h * bh) });
