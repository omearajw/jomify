// Projector layouts: walls and the assets on them, format-1 conversion, files. Run with
// node scripts/projector-cases.mjs
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = await import('../src/views/ZenMode/projectorLayouts.js');
let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

const corner = L.cornerLayout();
check('presets are valid', L.isValidLayout(corner) && L.isValidLayout(L.flatWallLayout()));
check('corner preset: two walls, three assets on them', corner.walls.length === 2 && corner.items.length === 3 && corner.items.every((i) => corner.walls.some((w) => w.id === i.wallId)));

// Format 1 conversion
const legacy = { id: 'old', name: 'Old room', surfaces: [
  { id: 's1', widget: 'title', corners: [[0.1, 0.2], [0.4, 0.3], [0.4, 0.7], [0.1, 0.8]], options: { align: 'center' } },
  { id: 's2', widget: 'art', corners: [[0.5, 0.3], [0.9, 0.2], [0.9, 0.8], [0.5, 0.7]] }
] };
check('a format-1 layout is recognised', L.isLegacyLayout(legacy) && !L.isValidLayout(legacy));
const migrated = L.migrateLayout(legacy);
check('conversion: one wall per old surface, the asset filling it', L.isValidLayout(migrated) && migrated.walls.length === 2 && migrated.items.length === 2 && migrated.items.every((i) => i.rect.x === 0 && i.rect.w === 1) && migrated.items[0].options.align === 'center' && migrated.walls[0].corners[0][0] === 0.1);
mem.set('jomify_projector', JSON.stringify({ format: 1, activeId: 'old', layouts: [legacy] }));
const loaded = L.loadProjectorState();
check('load converts a saved format-1 state and keeps the active layout', loaded.format === 2 && loaded.activeId === 'old' && loaded.layouts[0].walls.length === 2);
mem.set('jomify_projector', 'not json');
check('garbage falls back to the defaults', L.loadProjectorState().layouts.length === 2);

// Dropping
const r = L.dropRect('art', 0.5, 0.5, 1.6);
check('a dropped asset is centred on the point and inside the wall', Math.abs(r.x + r.w / 2 - 0.5) < 1e-9 && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1);
const edge = L.dropRect('progress', 0.98, 0.02, 1.6);
check('a drop near the edge is pulled inside', edge.x + edge.w <= 1 + 1e-9 && edge.y >= 0);
check('aspect estimate of a square on screen is 1', Math.abs(L.estimateAspect([[0, 0], [100, 0], [100, 100], [0, 100]]) - 1) < 1e-9);
check('aspect estimate of a wide quad', L.estimateAspect([[0, 0], [300, 20], [300, 120], [0, 100]]) > 2.5);

// Files
const text = L.exportLayout(corner);
const back = L.parseLayoutFile(text);
check('export and import round-trip with fresh ids', L.isValidLayout(back) && back.id !== corner.id && back.walls.length === 2 && back.items.every((i) => back.walls.some((w) => w.id === i.wallId)) && back.items.every((i) => !corner.items.some((o) => o.id === i.id)));
check('a format-1 file imports converted', L.parseLayoutFile(JSON.stringify({ app: 'jomify', kind: 'projector-layout', format: 1, layout: legacy })).walls.length === 2);
let threw = false; try { L.parseLayoutFile('{"nope":1}'); } catch { threw = true; }
check('a stray file is refused', threw);
const clone = L.cloneLayout(corner, 'Copy');
check('clone keeps assets on their walls', clone.items.every((i) => clone.walls.some((w) => w.id === i.wallId)) && clone.name === 'Copy');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
