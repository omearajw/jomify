import { solveHomography, homographyToMatrix3d, isConvexQuad } from '../../utils/homography';
import { aspectOf, WIDGETS, halloweenOf } from './projectorLayouts';
import { BatsLayer, WallCreatures } from './projectorHalloween';
import { WidgetView } from './projectorWidgets';
import { contentBox, wallRect, itemPx } from './projectorGeometry';

// The picture the projector throws, drawn at any size: the projector's own window draws it at
// full screen, the editor's stage draws the same thing smaller. Walls are corners in fractions of
// the frame; each wall's content is laid out flat and warped onto its corners.

// A wall's assets on its flat rectangle (bw × bh)
export function WallContent({ items, track, bw, bh, editing }) {
  return items.map((item) => {
    const r = itemPx(item, bw, bh);
    const inner = contentBox(r.width, r.height, aspectOf(item), item.options?.align);
    const box = { left: r.left + inner.left, top: r.top + inner.top, width: inner.width, height: inner.height };
    return <WidgetView key={item.id} widget={item.widget} track={track} box={box} options={item.options} editing={editing} label={WIDGETS[item.widget]?.label || item.widget} />;
  });
}

// The whole picture at w × h. `guides`, while someone is editing: every wall's outline and
// corners, the one being worked on brighter, the corner being moved large, the asset selected
// outlined, and a grid on the wall if asked for. No fills ever: a tinted wall is a lit panel.
export function ProjectionCanvas({ layout, track, w, h, guides = null, editing = false }) {
  const g = guides?.on ? guides : null;
  const line = Math.max(1.5, w / 900);
  const spooky = halloweenOf(layout);
  const themed = spooky.theme !== 'off' ? `proj-halloween${spooky.theme === 'font' ? ' proj-halloween-font' : ''}` : '';
  return (
    <div className={`absolute left-0 top-0 overflow-hidden bg-black ${themed}`} style={{ width: w, height: h }}>
      {layout.walls.map((wall) => {
        const { corners, bw, bh, convex } = wallRect(wall, w, h);
        if (!convex) return null;
        const warp = homographyToMatrix3d(solveHomography(bw, bh, corners));
        const items = layout.items.filter((i) => i.wallId === wall.id);
        const here = g && g.wallId === wall.id;
        const picked = here && g.itemId ? items.find((i) => i.id === g.itemId) : null;
        return (
          <div key={wall.id} className="absolute left-0 top-0 overflow-hidden" style={{ width: bw, height: bh, transform: warp, transformOrigin: '0 0', backfaceVisibility: 'hidden' }}>
            <WallContent items={items} track={track} bw={bw} bh={bh} editing={editing} />
            <WallCreatures bw={bw} bh={bh} rects={items.map((i) => i.rect)} settings={spooky} />
            {here && g.grid && (
              <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: `${bw / 8}px ${bh / 8}px` }} />
            )}
            {picked && <div className="pointer-events-none absolute" style={{ ...itemPx(picked, bw, bh), outline: `${line * 1.5}px dashed rgba(255,255,255,0.9)` }} />}
          </div>
        );
      })}
      {/* in front of every wall: black, so seen only where they cross something lit */}
      <BatsLayer w={w} h={h} count={spooky.bats} />
      {g && (
        <svg className="pointer-events-none absolute left-0 top-0" width={w} height={h} aria-hidden="true">
          {layout.walls.map((wall) => {
            const pts = wall.corners.map(([x, y]) => [x * w, y * h]);
            const here = g.wallId === wall.id;
            const ok = isConvexQuad(pts);
            return (
              <g key={wall.id}>
                <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={ok ? (here ? '#fff' : 'rgba(255,255,255,0.45)') : 'rgb(248,113,113)'} strokeWidth={here ? line * 2 : line} strokeDasharray={ok ? undefined : `${line * 6} ${line * 4}`} />
                {pts.map(([x, y], k) => {
                  const big = here && g.corner === k;
                  return <circle key={k} cx={x} cy={y} r={big ? line * 9 : here ? line * 5 : line * 3.5} fill={big ? '#fff' : 'none'} stroke="#fff" strokeWidth={line * 1.5} />;
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
