// Projector layouts: the walls of a room, and what sits on each. Saved on this device only, since
// a layout describes a physical room, and kept outside the synced store for the same reason.
// Export and import move one between devices by hand.
//
// Two layers. A wall is a four-cornered patch the user drags onto the real surface; everything
// on it is laid out on a flat grid, as if the wall were a rectangle in front of you, and the
// wall's projection does the rest. Format 1 gave every asset its own corners; those layouts
// are converted on load, each old surface becoming a wall with one asset filling it.

const STORAGE_KEY = 'jomify_projector';
export const LAYOUT_FORMAT = 2;

// What an asset can be. `aspect` is the shape the content is designed for; it is letterboxed
// inside its box rather than stretched.
export const WIDGETS = {
  art: { label: 'Album art', aspect: 1 },
  title: { label: 'Title and artist', aspect: 2 },
  progress: { label: 'Progress bar', aspect: 6 },
  lyrics: { label: 'Lyrics', aspect: 2 },
  clock: { label: 'Clock', aspect: 3 },
  waveform: { label: 'Waveform', aspect: 3 },
  next: { label: 'Up next', aspect: 3 },
  wash: { label: 'Colour wash', aspect: null },
  // During a party: the join code, who asked for this song, and the requests coming up
  partyqr: { label: 'Party QR', aspect: 0.78 },
  requestedby: { label: 'Requested by', aspect: 5 },
  partyqueue: { label: 'Party queue', aspect: 1.8 }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function newWall(corners, name = 'Wall') {
  return { id: uid(), name, corners: corners.map((p) => [...p]), aspect: null };
}

// An asset on a wall. `rect` is in fractions of the wall: x, y of the top-left, w, h of the box.
export function newItem(wallId, widget, rect) {
  return { id: uid(), wallId, widget, rect: { ...rect }, options: widget === 'title' ? { align: 'left' } : {} };
}

// Where a dropped asset lands: a box of a sensible size centred on the drop point, kept inside
// the wall. Sizes are fractions of the wall, so they follow the wall's shape.
export function dropRect(widget, x, y, wallAspect = 1.6) {
  const aspect = WIDGETS[widget]?.aspect;
  let w = 0.5;
  let h = aspect ? clamp((w * wallAspect) / aspect, 0.08, 0.9) : 0.5;
  if (h > 0.9) { h = 0.9; w = aspect ? (h * aspect) / wallAspect : 0.5; }
  return { x: clamp(x - w / 2, 0, 1 - w), y: clamp(y - h / 2, 0, 1 - h), w, h };
}

// The shape of a wall as the projector sees it: the average horizontal edge over the average
// vertical one. Right for a wall roughly facing the projector; the user can nudge it when not.
export function estimateAspect(pxCorners) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [tl, tr, br, bl] = pxCorners;
  const horizontal = (d(tl, tr) + d(bl, br)) / 2;
  const vertical = (d(tl, bl) + d(tr, br)) / 2;
  if (!(horizontal > 0) || !(vertical > 0)) return 1;
  return clamp(horizontal / vertical, 0.2, 5);
}

// Corners are fractions of the screen, clockwise from top-left, so a layout survives a change
// of resolution. A corner of a room: the left wall carries the words, the right the art.
export function cornerLayout(name = 'Corner') {
  const left = newWall([[0.06, 0.2], [0.46, 0.3], [0.46, 0.7], [0.06, 0.8]], 'Left wall');
  const right = newWall([[0.54, 0.3], [0.94, 0.2], [0.94, 0.8], [0.54, 0.7]], 'Right wall');
  return {
    id: uid(),
    name,
    walls: [left, right],
    items: [
      newItem(left.id, 'title', { x: 0.08, y: 0.3, w: 0.84, h: 0.3 }),
      newItem(left.id, 'progress', { x: 0.08, y: 0.66, w: 0.84, h: 0.08 }),
      newItem(right.id, 'art', { x: 0.15, y: 0.1, w: 0.7, h: 0.8 })
    ]
  };
}

export function flatWallLayout(name = 'Flat wall') {
  const wall = newWall([[0.08, 0.15], [0.92, 0.15], [0.92, 0.85], [0.08, 0.85]], 'Wall');
  return {
    id: uid(),
    name,
    walls: [wall],
    items: [
      newItem(wall.id, 'art', { x: 0.04, y: 0.1, w: 0.32, h: 0.8 }),
      newItem(wall.id, 'title', { x: 0.42, y: 0.22, w: 0.54, h: 0.36 }),
      newItem(wall.id, 'progress', { x: 0.42, y: 0.64, w: 0.54, h: 0.08 })
    ]
  };
}

export function defaultState() {
  const corner = cornerLayout();
  const flat = flatWallLayout();
  return { format: LAYOUT_FORMAT, activeId: corner.id, layouts: [corner, flat] };
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n));
const isCorners = (c) => Array.isArray(c) && c.length === 4 && c.every(isPoint);
const isRect = (r) => r && typeof r === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k]));

export function isValidWall(w) {
  return Boolean(w) && typeof w === 'object' && typeof w.id === 'string' && isCorners(w.corners) && (w.aspect == null || Number.isFinite(w.aspect));
}
export function isValidItem(i, wallIds) {
  return Boolean(i) && typeof i === 'object' && typeof i.id === 'string' && Boolean(WIDGETS[i.widget]) && isRect(i.rect) && wallIds.has(i.wallId);
}
export function isValidLayout(l) {
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || typeof l.name !== 'string') return false;
  if (!Array.isArray(l.walls) || !l.walls.every(isValidWall)) return false;
  const ids = new Set(l.walls.map((w) => w.id));
  return Array.isArray(l.items) && l.items.every((i) => isValidItem(i, ids));
}

// Format 1: { surfaces: [{ id, widget, corners, options }] }
const isLegacySurface = (s) => s && typeof s === 'object' && WIDGETS[s.widget] && isCorners(s.corners);
export const isLegacyLayout = (l) => Boolean(l) && typeof l === 'object' && typeof l.name === 'string' && Array.isArray(l.surfaces) && l.surfaces.every(isLegacySurface);

export function migrateLayout(legacy) {
  const walls = [];
  const items = [];
  legacy.surfaces.forEach((s) => {
    const wall = newWall(s.corners, WIDGETS[s.widget].label);
    walls.push(wall);
    items.push({ ...newItem(wall.id, s.widget, { x: 0, y: 0, w: 1, h: 1 }), options: s.options || {} });
  });
  return { id: typeof legacy.id === 'string' ? legacy.id : uid(), name: legacy.name, walls, items };
}

const normalizeLayout = (l) => (isValidLayout(l) ? l : isLegacyLayout(l) ? migrateLayout(l) : null);

export function loadProjectorState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.layouts) || parsed.layouts.length === 0) return defaultState();
    const layouts = parsed.layouts.map(normalizeLayout);
    if (layouts.some((l) => !l)) return defaultState();
    const activeId = layouts.some((l) => l.id === parsed.activeId) ? parsed.activeId : layouts[0].id;
    return { format: LAYOUT_FORMAT, activeId, layouts };
  } catch {
    return defaultState();
  }
}

export function saveProjectorState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, format: LAYOUT_FORMAT })); } catch { /* private mode or full: the layout lives for the session */ }
}

export function newLayoutId() { return uid(); }

// A layout as a copy with fresh ids throughout, items following their walls
export function cloneLayout(layout, name = layout.name) {
  const wallIds = new Map(layout.walls.map((w) => [w.id, uid()]));
  return {
    id: uid(),
    name,
    walls: layout.walls.map((w) => ({ ...w, id: wallIds.get(w.id), corners: w.corners.map((p) => [...p]) })),
    items: layout.items.map((i) => ({ ...i, id: uid(), wallId: wallIds.get(i.wallId), rect: { ...i.rect }, options: { ...(i.options || {}) } }))
  };
}

// One layout as a file, and back. Ids are regenerated on import so a layout can be brought in
// twice without colliding with itself; a format-1 file is converted.
export function exportLayout(layout) {
  return JSON.stringify({ app: 'jomify', kind: 'projector-layout', format: LAYOUT_FORMAT, layout }, null, 2);
}

export function parseLayoutFile(text) {
  const parsed = JSON.parse(text);
  const layout = normalizeLayout(parsed?.kind === 'projector-layout' ? parsed.layout : parsed);
  if (!layout) throw new Error('Not a Jomify projector layout');
  return cloneLayout(layout);
}
