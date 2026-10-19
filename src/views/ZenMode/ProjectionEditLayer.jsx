import { useRef } from 'react';
import { solveHomography, homographyToMatrix3d, invertHomography, applyHomography } from '../../utils/homography';
import { wallRect, itemPx } from './projectorGeometry';

// Editing on the projected picture itself (Jack, 19 Oct: both screens, not only the laptop). Over
// the picture, invisible except for handles: in the Walls step every wall's corners and body can
// be dragged; in the Assets step every asset can be moved, and the selected one has eight handles.
// Asset drags are worked out on the wall's flat rectangle through the inverse of its warp, so a
// box pulled on a slanted wall still moves along the wall. The drawing of outlines and the picked
// corner is the picture's own (ProjectionCanvas guides); this layer only catches the pointer.

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const MIN = 0.03;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clampCorner = (n) => clamp(n, -0.25, 1.25);

export default function ProjectionEditLayer({ layout, w, h, mode, selection, onChange, onPick }) {
  const drag = useRef(null);
  const line = Math.max(1.5, w / 900);
  const hit = Math.max(16, w / 80);

  const capture = (e) => { try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ } };
  const toWall = (wall, x, y) => {
    const { corners, bw, bh, convex } = wallRect(wall, w, h);
    if (!convex) return null;
    const inv = invertHomography(solveHomography(bw, bh, corners));
    if (!inv) return null;
    const [fx, fy] = applyHomography(inv, x, y);
    return [fx / bw, fy / bh];
  };
  const updateWall = (id, fn) => onChange({ ...layout, walls: layout.walls.map((x) => (x.id === id ? fn(x) : x)) });
  const updateItem = (id, fn) => onChange({ ...layout, items: layout.items.map((x) => (x.id === id ? fn(x) : x)) });

  const start = (e, d) => { e.stopPropagation(); e.preventDefault(); capture(e); drag.current = { ...d, sx: e.clientX, sy: e.clientY }; };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'corner' || d.kind === 'wall') {
      const dx = (e.clientX - d.sx) / w, dy = (e.clientY - d.sy) / h;
      updateWall(d.id, (x) => ({ ...x, corners: d.corners.map(([cx, cy], k) => (d.kind === 'wall' || k === d.k ? [clampCorner(cx + dx), clampCorner(cy + dy)] : [cx, cy])) }));
      return;
    }
    const now = toWall(d.wall, e.clientX, e.clientY);
    if (!now || !d.at) return;
    const dx = now[0] - d.at[0], dy = now[1] - d.at[1];
    if (d.kind === 'move') {
      updateItem(d.id, (i) => ({ ...i, rect: { ...i.rect, x: clamp(d.rect.x + dx, -i.rect.w * 0.5, 1 - i.rect.w * 0.5), y: clamp(d.rect.y + dy, -i.rect.h * 0.5, 1 - i.rect.h * 0.5) } }));
      return;
    }
    let l = d.rect.x, t = d.rect.y, r = d.rect.x + d.rect.w, b = d.rect.y + d.rect.h;
    if (d.dir.includes('w')) l += dx;
    if (d.dir.includes('e')) r += dx;
    if (d.dir.includes('n')) t += dy;
    if (d.dir.includes('s')) b += dy;
    if (r - l < MIN) { if (d.dir.includes('w')) l = r - MIN; else r = l + MIN; }
    if (b - t < MIN) { if (d.dir.includes('n')) t = b - MIN; else b = t + MIN; }
    updateItem(d.id, (i) => ({ ...i, rect: { x: l, y: t, w: r - l, h: b - t } }));
  };
  const onUp = () => { drag.current = null; };

  return (
    <div className="absolute inset-0" style={{ touchAction: 'none' }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {mode === 'walls' && (
        <svg className="absolute left-0 top-0" width={w} height={h}>
          {layout.walls.map((wall) => {
            const pts = wall.corners.map(([x, y]) => [x * w, y * h]);
            return (
              <g key={wall.id}>
                <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="rgba(0,0,0,0.001)" style={{ cursor: 'move' }}
                  onPointerDown={(e) => { onPick({ mode: 'walls', wallId: wall.id, corner: null, itemId: null }); start(e, { kind: 'wall', id: wall.id, corners: wall.corners.map((p) => [...p]) }); }} />
                {pts.map(([x, y], k) => (
                  <circle key={k} cx={x} cy={y} r={hit} fill="rgba(0,0,0,0.001)" style={{ cursor: 'grab' }}
                    onPointerDown={(e) => { onPick({ mode: 'walls', wallId: wall.id, corner: k, itemId: null }); start(e, { kind: 'corner', id: wall.id, k, corners: wall.corners.map((p) => [...p]) }); }} />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {mode === 'assets' && layout.walls.map((wall) => {
        const { corners, bw, bh, convex } = wallRect(wall, w, h);
        if (!convex) return null;
        const warp = homographyToMatrix3d(solveHomography(bw, bh, corners));
        const items = layout.items.filter((i) => i.wallId === wall.id);
        return (
          <div key={wall.id} className="absolute left-0 top-0" style={{ width: bw, height: bh, transform: warp, transformOrigin: '0 0', pointerEvents: 'none' }}>
            {items.map((it) => {
              const r = itemPx(it, bw, bh);
              const sel = selection.itemId === it.id;
              const knob = Math.max(10, bw / 60);
              return (
                <div key={it.id} className="absolute" style={{ ...r, cursor: 'move', pointerEvents: 'auto' }}
                  onPointerDown={(e) => { onPick({ mode: 'assets', wallId: wall.id, corner: null, itemId: it.id }); start(e, { kind: 'move', id: it.id, wall, at: toWall(wall, e.clientX, e.clientY), rect: { ...it.rect } }); }}>
                  {sel && HANDLES.map((d) => (
                    <span key={d} aria-hidden="true" className="absolute -translate-x-1/2 -translate-y-1/2"
                      onPointerDown={(e) => start(e, { kind: 'resize', id: it.id, dir: d, wall, at: toWall(wall, e.clientX, e.clientY), rect: { ...it.rect } })}
                      style={{ left: d.includes('w') ? 0 : d.includes('e') ? '100%' : '50%', top: d.includes('n') ? 0 : d.includes('s') ? '100%' : '50%', width: knob, height: knob, background: '#fff', boxShadow: `0 0 0 ${line}px #000`, cursor: CURSOR[d] }} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
