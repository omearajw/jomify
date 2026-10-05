// Projector layouts: which patches of wall show what. Saved on this device only, since a layout
// describes a physical room, and kept outside the synced store for the same reason. Export and
// import move one between devices by hand.

const STORAGE_KEY = 'jomify_projector';
export const LAYOUT_FORMAT = 1;

// What a surface can show. `aspect` is the shape the content is designed for; the surface
// itself can be any quad, and the content is letterboxed inside it rather than stretched.
export const WIDGETS = {
  art: { label: 'Album art', aspect: 1 },
  title: { label: 'Title and artist', aspect: 2 },
  progress: { label: 'Progress bar', aspect: 6 },
  lyrics: { label: 'Lyrics', aspect: 2 },
  clock: { label: 'Clock', aspect: 3 },
  waveform: { label: 'Waveform', aspect: 3 },
  next: { label: 'Up next', aspect: 3 },
  wash: { label: 'Colour wash', aspect: null }
};

const uid = () => Math.random().toString(36).slice(2, 9);

// Corners are fractions of the screen, clockwise from top-left, so a layout survives a change
// of resolution. A corner of a room: the left wall carries the words, the right the art.
export function cornerLayout(name = 'Corner') {
  return {
    id: uid(),
    name,
    surfaces: [
      { id: uid(), widget: 'title', corners: [[0.06, 0.28], [0.46, 0.36], [0.46, 0.64], [0.06, 0.72]], options: { align: 'left' } },
      { id: uid(), widget: 'art', corners: [[0.54, 0.36], [0.94, 0.28], [0.94, 0.72], [0.54, 0.64]], options: {} }
    ]
  };
}

export function flatWallLayout(name = 'Flat wall') {
  return {
    id: uid(),
    name,
    surfaces: [
      { id: uid(), widget: 'art', corners: [[0.08, 0.2], [0.38, 0.2], [0.38, 0.8], [0.08, 0.8]], options: {} },
      { id: uid(), widget: 'title', corners: [[0.44, 0.3], [0.92, 0.3], [0.92, 0.62], [0.44, 0.62]], options: { align: 'left' } },
      { id: uid(), widget: 'progress', corners: [[0.44, 0.68], [0.92, 0.68], [0.92, 0.76], [0.44, 0.76]], options: {} }
    ]
  };
}

export function defaultState() {
  const corner = cornerLayout();
  const flat = flatWallLayout();
  return { format: LAYOUT_FORMAT, activeId: corner.id, layouts: [corner, flat] };
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n));

export function isValidSurface(s) {
  return s && typeof s === 'object' && typeof s.id === 'string' && WIDGETS[s.widget]
    && Array.isArray(s.corners) && s.corners.length === 4 && s.corners.every(isPoint);
}

export function isValidLayout(l) {
  return l && typeof l === 'object' && typeof l.id === 'string' && typeof l.name === 'string'
    && Array.isArray(l.surfaces) && l.surfaces.every(isValidSurface);
}

export function loadProjectorState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.layouts) || parsed.layouts.length === 0 || !parsed.layouts.every(isValidLayout)) return defaultState();
    const activeId = parsed.layouts.some((l) => l.id === parsed.activeId) ? parsed.activeId : parsed.layouts[0].id;
    return { format: LAYOUT_FORMAT, activeId, layouts: parsed.layouts };
  } catch {
    return defaultState();
  }
}

export function saveProjectorState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode or full: the layout lives for the session */ }
}

export function newSurface(widget, corners) {
  return { id: uid(), widget, corners, options: widget === 'title' ? { align: 'left' } : {} };
}

export function newLayoutId() { return uid(); }

// One layout as a file, and back. Ids are regenerated on import so a layout can be brought in
// twice without colliding with itself.
export function exportLayout(layout) {
  return JSON.stringify({ app: 'jomify', kind: 'projector-layout', format: LAYOUT_FORMAT, layout }, null, 2);
}

export function parseLayoutFile(text) {
  const parsed = JSON.parse(text);
  const layout = parsed?.kind === 'projector-layout' ? parsed.layout : parsed;
  if (!isValidLayout(layout)) throw new Error('Not a Jomify projector layout');
  return { ...layout, id: uid(), surfaces: layout.surfaces.map((s) => ({ ...s, id: uid(), options: s.options || {} })) };
}
