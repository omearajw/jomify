import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { toast } from '../../store/toastStore';
import { useProjectorStore, activeLayout } from './projectorStore';
import { ProjectionCanvas, WallContent } from './projectorCanvas';
import { wallRect, itemPx } from './projectorGeometry';
import { openProjectorWindow } from './projectorBridge';
import {
  WIDGETS, newWall, newItem, dropRect, cornerLayout, flatWallLayout, cloneLayout, exportLayout, parseLayoutFile, newLayoutId
} from './projectorLayouts';
import { isConvexQuad } from '../../utils/homography';

// The projector editor, on the laptop's own screen while the projector shows the result on the
// wall (Jack, 15 Oct: editing on the projected picture itself was finicky). Two steps:
//   Walls   the projector's whole picture, in its shape; drag a wall's corners until its outline
//           on the real wall sits on the real corners. The wall shows the outlines while you do.
//   Assets  one wall, flat, the way it will read: drop assets on it, move them, pull any of
//           eight handles to size them, with snapping to the wall and to each other.
// Every change reaches the projector at once (projectorStore → projectorBridge).

const SNAP_PX = 7;
const NUDGE = 1;
const NUDGE_FAST = 10;
const MIN = 0.03;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clampCorner = (n) => clamp(n, -0.25, 1.25);

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Word = ({ onClick, children, lit, disabled, tip, onPointerDown }) => <button type="button" data-tip={tip} onClick={onClick} onPointerDown={onPointerDown} disabled={disabled} aria-pressed={lit || undefined} className="ui-word">{children}</button>;

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Snapping one axis: the moving edges against the candidate lines, the nearest within reach wins
function snapAxis(edges, lines, reach) {
  let best = null;
  for (const e of edges) for (const l of lines) {
    const d = l - e.at;
    if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l };
  }
  return best;
}

export default function ProjectorStudio({ inWindow = false }) {
  const layouts = useProjectorStore((s) => s.layouts);
  const setLayouts = useProjectorStore((s) => s.setLayouts);
  const setGuides = useProjectorStore((s) => s.setGuides);
  const setStudioOpen = useProjectorStore((s) => s.setStudioOpen);
  const frame = useProjectorStore((s) => s.frame);
  const track = usePlayerStore((s) => s.playbackState?.track_window?.current_track || null);
  const layout = activeLayout(layouts);

  const [mode, setMode] = useState(() => (layout.walls.length ? 'assets' : 'walls'));
  const [wallId, setWallId] = useState(() => layout.walls[0]?.id || null);
  const [corner, setCorner] = useState(null);
  const [itemId, setItemId] = useState(null);
  const [outlines, setOutlines] = useState(true);
  const [grid, setGrid] = useState(false);
  const [renaming, setRenaming] = useState(null); // 'layout' | wall id
  const [carry, setCarry] = useState(null);
  const [snapLines, setSnapLines] = useState({ x: [], y: [] });
  const drag = useRef(null);
  const carryRef = useRef(null);
  const fileInput = useRef(null);
  const history = useRef([]);
  const [undoable, setUndoable] = useState(0);
  const stageRef = useRef(null);
  const stage = useSize(stageRef);

  const wall = layout.walls.find((w) => w.id === wallId) || layout.walls[0] || null;
  const item = layout.items.find((i) => i.id === itemId) || null;

  // what the wall shows while this is open
  useEffect(() => { setGuides({ on: outlines, wallId: wall?.id || null, corner: mode === 'walls' ? corner : null, itemId: mode === 'assets' ? itemId : null, grid }); }, [outlines, wall?.id, corner, itemId, grid, mode, setGuides]);
  useEffect(() => () => setGuides({ on: false }), [setGuides]);

  // --- changes, with an undo
  const remember = () => { history.current = [...history.current.slice(-49), layouts]; setUndoable(history.current.length); };
  const update = (fn) => setLayouts((prev) => ({ ...prev, layouts: prev.layouts.map((l) => (l.id === prev.activeId ? fn(l) : l)) }));
  const updateWall = (id, fn) => update((l) => ({ ...l, walls: l.walls.map((w) => (w.id === id ? fn(w) : w)) }));
  const updateItem = (id, fn) => update((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? fn(i) : i)) }));
  const undo = () => { const prev = history.current.pop(); setUndoable(history.current.length); if (prev) setLayouts(prev); };

  // --- stage geometry
  // Walls: the projector's picture fitted into the stage
  const scale = stage.w && stage.h ? Math.min((stage.w - 48) / frame.w, (stage.h - 48) / frame.h) : 0;
  const fw = frame.w * scale, fh = frame.h * scale;
  const fx = (stage.w - fw) / 2, fy = (stage.h - fh) / 2;
  // Assets: the selected wall, flat, fitted into the stage
  const flat = wall ? wallRect(wall, frame.w, frame.h) : null;
  const flatScale = flat && stage.w ? Math.min((stage.w - 64) / flat.bw, (stage.h - 64) / flat.bh) : 0;
  const ww = flat ? flat.bw * flatScale : 0, wh = flat ? flat.bh * flatScale : 0;
  const wx = (stage.w - ww) / 2, wy = (stage.h - wh) / 2;

  const stagePoint = (e) => { const r = stageRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  const capture = (e) => { try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ } };

  // --- walls
  const startCorner = (e, w, k) => { e.stopPropagation(); e.preventDefault(); capture(e); remember(); setWallId(w.id); setCorner(k); drag.current = { kind: 'corner', id: w.id, k, start: stagePoint(e), corners: w.corners.map((p) => [...p]) }; };
  const startWall = (e, w) => { e.stopPropagation(); e.preventDefault(); capture(e); remember(); setWallId(w.id); setCorner(null); drag.current = { kind: 'wall', id: w.id, start: stagePoint(e), corners: w.corners.map((p) => [...p]) }; };

  // --- assets
  const startItem = (e, it) => { e.stopPropagation(); e.preventDefault(); capture(e); remember(); setItemId(it.id); drag.current = { kind: 'move', id: it.id, start: stagePoint(e), rect: { ...it.rect } }; };
  const startResize = (e, it, dir) => { e.stopPropagation(); e.preventDefault(); capture(e); remember(); drag.current = { kind: 'resize', id: it.id, dir, start: stagePoint(e), rect: { ...it.rect } }; };

  // Lines an asset can snap to: the wall's edges and middle, and the other assets' edges and middles
  const snapTargets = (skipId) => {
    const xs = [0, 0.5, 1], ys = [0, 0.5, 1];
    layout.items.filter((i) => i.wallId === wall?.id && i.id !== skipId).forEach((i) => {
      xs.push(i.rect.x, i.rect.x + i.rect.w / 2, i.rect.x + i.rect.w);
      ys.push(i.rect.y, i.rect.y + i.rect.h / 2, i.rect.y + i.rect.h);
    });
    return { xs, ys };
  };

  const onMove = (e) => {
    if (carryRef.current) { const p = stagePoint(e); carryRef.current = { ...carryRef.current, x: p[0], y: p[1] }; setCarry(carryRef.current); return; }
    const d = drag.current;
    if (!d) return;
    const [x, y] = stagePoint(e);
    if (d.kind === 'corner' || d.kind === 'wall') {
      const dx = (x - d.start[0]) / fw, dy = (y - d.start[1]) / fh;
      updateWall(d.id, (w) => ({ ...w, corners: d.corners.map(([cx, cy], k) => (d.kind === 'wall' || k === d.k ? [clampCorner(cx + dx), clampCorner(cy + dy)] : [cx, cy])) }));
      return;
    }
    const dx = (x - d.start[0]) / ww, dy = (y - d.start[1]) / wh;
    const snapOn = !e.altKey;
    const { xs, ys } = snapTargets(d.id);
    const rx = SNAP_PX / ww, ry = SNAP_PX / wh;
    if (d.kind === 'move') {
      let nx = d.rect.x + dx, ny = d.rect.y + dy;
      const lines = { x: [], y: [] };
      if (snapOn) {
        const sx = snapAxis([{ at: nx }, { at: nx + d.rect.w / 2 }, { at: nx + d.rect.w }], xs, rx);
        const sy = snapAxis([{ at: ny }, { at: ny + d.rect.h / 2 }, { at: ny + d.rect.h }], ys, ry);
        if (sx) { nx += sx.d; lines.x.push(sx.line); }
        if (sy) { ny += sy.d; lines.y.push(sy.line); }
      }
      setSnapLines(lines);
      updateItem(d.id, (i) => ({ ...i, rect: { ...i.rect, x: clamp(nx, -i.rect.w * 0.5, 1 - i.rect.w * 0.5), y: clamp(ny, -i.rect.h * 0.5, 1 - i.rect.h * 0.5) } }));
      return;
    }
    // resize: each handle moves its own edges; Shift keeps the box's shape
    let { x: l, y: t } = d.rect;
    let r = d.rect.x + d.rect.w, b = d.rect.y + d.rect.h;
    const dir = d.dir;
    if (dir.includes('w')) l += dx;
    if (dir.includes('e')) r += dx;
    if (dir.includes('n')) t += dy;
    if (dir.includes('s')) b += dy;
    const lines = { x: [], y: [] };
    if (snapOn) {
      if (dir.includes('w')) { const s = snapAxis([{ at: l }], xs, rx); if (s) { l += s.d; lines.x.push(s.line); } }
      if (dir.includes('e')) { const s = snapAxis([{ at: r }], xs, rx); if (s) { r += s.d; lines.x.push(s.line); } }
      if (dir.includes('n')) { const s = snapAxis([{ at: t }], ys, ry); if (s) { t += s.d; lines.y.push(s.line); } }
      if (dir.includes('s')) { const s = snapAxis([{ at: b }], ys, ry); if (s) { b += s.d; lines.y.push(s.line); } }
    }
    if (r - l < MIN) { if (dir.includes('w')) l = r - MIN; else r = l + MIN; }
    if (b - t < MIN) { if (dir.includes('n')) t = b - MIN; else b = t + MIN; }
    if (e.shiftKey && dir.length === 2) {
      // the shape in real proportions (the wall is not square), held by the corner being pulled
      const shape = (d.rect.w * ww) / (d.rect.h * wh);
      const wpx = (r - l) * ww, hpx = (b - t) * wh;
      if (wpx / hpx > shape) { const nh = wpx / shape / wh; if (dir.includes('n')) t = b - nh; else b = t + nh; } else { const nw = hpx * shape / ww; if (dir.includes('w')) l = r - nw; else r = l + nw; }
      lines.x = []; lines.y = [];
    }
    setSnapLines(lines);
    updateItem(d.id, (i) => ({ ...i, rect: { x: l, y: t, w: r - l, h: b - t } }));
  };

  const dropCarried = () => {
    const c = carryRef.current;
    carryRef.current = null;
    setCarry(null);
    if (!c || !wall) return;
    const moved = Math.hypot(c.x - c.sx, c.y - c.sy) > 6;
    const inside = c.x >= wx && c.x <= wx + ww && c.y >= wy && c.y <= wy + wh && mode === 'assets';
    if (moved && !inside) return;
    const at = moved ? [(c.x - wx) / ww, (c.y - wy) / wh] : [0.5, 0.5];
    remember();
    const it = newItem(wall.id, c.widget, dropRect(c.widget, at[0], at[1], flat?.aspect || 1.6));
    update((l) => ({ ...l, items: [...l.items, it] }));
    setItemId(it.id);
    setMode('assets');
  };
  const onUp = () => {
    if (carryRef.current) dropCarried();
    drag.current = null;
    setSnapLines({ x: [], y: [] });
  };
  const startCarry = (e, widget) => {
    e.preventDefault();
    const p = stageRef.current ? stagePoint(e) : [0, 0];
    carryRef.current = { widget, x: p[0], y: p[1], sx: p[0], sy: p[1] };
    setCarry(carryRef.current);
  };
  useEffect(() => {
    // a palette press can end anywhere on the page
    const up = () => { if (carryRef.current) dropCarried(); };
    const move = (e) => { if (carryRef.current && stageRef.current) onMove(e); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move); };
  });

  // --- walls and layouts
  const addWall = () => {
    remember();
    const w = newWall([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], `Wall ${layout.walls.length + 1}`);
    update((l) => ({ ...l, walls: [...l.walls, w] }));
    setWallId(w.id); setCorner(null); setMode('walls');
  };
  const removeWall = (id) => { remember(); update((l) => ({ ...l, walls: l.walls.filter((w) => w.id !== id), items: l.items.filter((i) => i.wallId !== id) })); setWallId(null); setCorner(null); };
  const removeItem = (id) => { remember(); update((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) })); setItemId(null); };
  const nudgeShape = (w, f) => { remember(); updateWall(w.id, (x) => ({ ...x, aspect: clamp((x.aspect || wallRect(x, frame.w, frame.h).aspect) * f, 0.2, 5) })); };
  const setOption = (key, value) => { remember(); updateItem(item.id, (i) => ({ ...i, options: { ...i.options, [key]: value } })); };
  const addLayout = (make) => { remember(); setLayouts((prev) => { const l = make(); return { ...prev, activeId: l.id, layouts: [...prev.layouts, l] }; }); setWallId(null); setItemId(null); };
  const removeLayout = () => { if (layouts.layouts.length <= 1) return; remember(); setLayouts((prev) => { const rest = prev.layouts.filter((l) => l.id !== prev.activeId); return { ...prev, activeId: rest[0].id, layouts: rest }; }); setWallId(null); setItemId(null); };
  const rename = (target, name) => {
    const v = name.trim();
    setRenaming(null);
    if (!v) return;
    remember();
    if (target === 'layout') update((l) => ({ ...l, name: v })); else updateWall(target, (w) => ({ ...w, name: v }));
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportLayout(layout)], { type: 'application/json' }));
    a.download = `jomify-projector-${layout.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = parseLayoutFile(await file.text());
      remember();
      setLayouts((prev) => ({ ...prev, activeId: imported.id, layouts: [...prev.layouts, imported] }));
    } catch (err) { toast(err.message || "Couldn't read that file", { tone: 'error' }); }
  };
  const close = () => setStudioOpen(false);

  // --- keys: arrows nudge (Shift: further), Delete removes, Cmd/Ctrl+Z undoes, W/A switch step,
  // Escape lets go of what is selected, then closes
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (itemId) setItemId(null); else if (corner !== null) setCorner(null); else close(); return; }
      const key = e.key.toLowerCase();
      if (key === 'w' && !e.metaKey && !e.ctrlKey) { setMode('walls'); return; }
      if (key === 'a' && !e.metaKey && !e.ctrlKey) { setMode('assets'); return; }
      if (key === 'g' && !e.metaKey && !e.ctrlKey) { setGrid((v) => !v); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (mode === 'assets' && itemId) removeItem(itemId); else if (mode === 'walls' && wall) removeWall(wall.id);
        return;
      }
      const step = e.shiftKey ? NUDGE_FAST : NUDGE;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!mv) return;
      e.preventDefault();
      remember();
      if (mode === 'walls' && wall) {
        // a projector pixel at a time: the selected corner, or the whole wall
        const [dx, dy] = [mv[0] / frame.w, mv[1] / frame.h];
        updateWall(wall.id, (w) => ({ ...w, corners: w.corners.map(([x, y], k) => (corner === null || k === corner ? [clampCorner(x + dx), clampCorner(y + dy)] : [x, y])) }));
      } else if (mode === 'assets' && item && flat) {
        updateItem(item.id, (i) => ({ ...i, rect: { ...i.rect, x: i.rect.x + mv[0] / flat.bw, y: i.rect.y + mv[1] / flat.bh } }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const wallItems = wall ? layout.items.filter((i) => i.wallId === wall.id) : [];
  const shapeOf = (w) => wallRect(w, frame.w, frame.h);

  return (
    <div className="fixed inset-0 z-[9700] flex text-[var(--room-paper)]" style={{ background: 'var(--room-ink)', fontFamily: 'var(--font-room)' }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* the column: layouts, the step, walls or assets, and what is selected */}
      <aside className="flex w-[300px] shrink-0 flex-col gap-7 overflow-y-auto border-r border-[var(--room-hair)] px-6 py-6" style={{ background: 'var(--room-solid)' }}>
        <div>
          <Mono className="text-[var(--room-faint)]">Projector{frame.reported ? ` · ${frame.w} × ${frame.h}` : ''}</Mono>
          {renaming === 'layout' ? (
            <input autoFocus defaultValue={layout.name} onBlur={(e) => rename('layout', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} className="ui-field mt-2 text-[22px] font-semibold" />
          ) : (
            <h1 className="mt-2 truncate text-[24px] font-semibold tracking-[-0.025em]" onDoubleClick={() => setRenaming('layout')}>{layout.name}</h1>
          )}
          <select value={layouts.activeId} onChange={(e) => { setLayouts((prev) => ({ ...prev, activeId: e.target.value })); setWallId(null); setItemId(null); }} aria-label="Layout" className="ui-field mt-3 text-[13px] [&>option]:bg-[var(--room-solid)]">
            {layouts.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <Word onClick={() => setRenaming('layout')}>Rename</Word>
            <Word onClick={() => addLayout(() => cornerLayout('New corner'))} tip="Two walls meeting in a corner">New corner</Word>
            <Word onClick={() => addLayout(() => flatWallLayout('New wall'))} tip="One wall">New wall</Word>
            <Word onClick={() => addLayout(() => ({ id: newLayoutId(), name: 'Empty room', walls: [], items: [] }))}>Empty</Word>
            <Word onClick={() => addLayout(() => cloneLayout(layout, `${layout.name} copy`))}>Duplicate</Word>
            <Word onClick={download}>Export</Word>
            <Word onClick={() => fileInput.current?.click()}>Import</Word>
            <Word onClick={removeLayout} disabled={layouts.layouts.length <= 1}>Delete</Word>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={importFile} className="hidden" />
        </div>

        <div className="flex gap-5 border-b border-[var(--room-hair)] pb-3" role="tablist" aria-label="Step">
          <Word lit={mode === 'walls'} onClick={() => setMode('walls')} tip="Line the walls up with the real ones (W)">1 · Walls</Word>
          <Word lit={mode === 'assets'} onClick={() => setMode('assets')} tip="Put things on the walls (A)">2 · Assets</Word>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Mono className="text-[var(--room-faint)]">Walls · {layout.walls.length}</Mono>
            <Word onClick={addWall}>Add a wall</Word>
          </div>
          {layout.walls.length === 0 && <p className="mt-3 text-[13px] text-[var(--room-dim)]">Add a wall, then pull its corners onto a real one.</p>}
          <div className="mt-2">
            {layout.walls.map((w) => {
              const here = w.id === wall?.id;
              return (
                <div key={w.id} className="border-t border-[var(--room-hair)] py-2">
                  {renaming === w.id ? (
                    <input autoFocus defaultValue={w.name} onBlur={(e) => rename(w.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} className="ui-field text-[14px]" />
                  ) : (
                    <button type="button" onClick={() => { setWallId(w.id); setCorner(null); setItemId(null); }} onDoubleClick={() => setRenaming(w.id)} className={`flex w-full items-baseline justify-between gap-3 text-left text-[14px] ${here ? 'font-semibold text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}>
                      <span className="truncate">{w.name}</span>
                      <span className="room-mono shrink-0 text-[var(--room-faint)]">{isConvexQuad(w.corners) ? `${layout.items.filter((i) => i.wallId === w.id).length} on it` : 'folded'}</span>
                    </button>
                  )}
                  {here && mode === 'walls' && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <Mono className="text-[var(--room-faint)]">Shape {shapeOf(w).aspect.toFixed(2)} : 1{w.aspect ? '' : ' · guessed'}</Mono>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <Word onClick={() => nudgeShape(w, 1.06)} tip="The content looks squashed">Wider</Word>
                        <Word onClick={() => nudgeShape(w, 1 / 1.06)} tip="The content looks stretched">Taller</Word>
                        {w.aspect && <Word onClick={() => { remember(); updateWall(w.id, (x) => ({ ...x, aspect: null })); }}>Guess again</Word>}
                        <Word onClick={() => setRenaming(w.id)}>Rename</Word>
                        <Word onClick={() => removeWall(w.id)}>Remove</Word>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {mode === 'walls' && (
            <p className="mt-4 text-[12.5px] leading-[1.5] text-[var(--room-faint)]">
              Pull a corner on the picture until its dot on the real wall sits in the real corner. Click a corner, then the arrow keys move it one projector pixel (Shift: ten). With no corner picked they move the whole wall.
            </p>
          )}
        </div>

        {mode === 'assets' && wall && (
          <div>
            <Mono className="text-[var(--room-faint)]">Add to {wall.name}</Mono>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2.5">
              {Object.entries(WIDGETS).map(([id, w]) => (
                <button key={id} type="button" onPointerDown={(e) => startCarry(e, id)} className="ui-word cursor-grab touch-none" data-tip="Drag onto the wall, or click to put it in the middle">{w.label}</button>
              ))}
            </div>
            {item && (
              <div className="mt-6 border-t border-[var(--room-hair)] pt-4">
                <Mono className="text-[var(--room-faint)]">Selected</Mono>
                <p className="mt-1 text-[15px] font-semibold">{WIDGETS[item.widget]?.label}</p>
                <div className="mt-3 space-y-3">
                  {item.widget === 'title' && (
                    <div className="flex gap-4">{['left', 'center', 'right'].map((a) => <Word key={a} lit={(item.options?.align || 'left') === a} onClick={() => setOption('align', a)}>{a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}</Word>)}</div>
                  )}
                  {item.widget === 'progress' && (
                    <div className="flex gap-4"><Word lit={item.options?.numbers !== false} onClick={() => setOption('numbers', true)}>Times shown</Word><Word lit={item.options?.numbers === false} onClick={() => setOption('numbers', false)}>Bar only</Word></div>
                  )}
                  {item.widget === 'partyqr' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2">{[['both', 'QR and code'], ['qr', 'QR only'], ['code', 'Code only']].map(([v, l]) => <Word key={v} lit={(item.options?.show || 'both') === v} onClick={() => setOption('show', v)}>{l}</Word>)}</div>
                  )}
                  <Mono className="text-[var(--room-faint)]">{Math.round(item.rect.w * 100)}% × {Math.round(item.rect.h * 100)}% of the wall</Mono>
                  <div className="flex gap-4">
                    <Word onClick={() => { remember(); updateItem(item.id, (i) => ({ ...i, rect: { ...i.rect, x: (1 - i.rect.w) / 2 } })); }}>Centre across</Word>
                    <Word onClick={() => removeItem(item.id)}>Remove</Word>
                  </div>
                </div>
              </div>
            )}
            <p className="mt-6 text-[12.5px] leading-[1.5] text-[var(--room-faint)]">Drag to move; pull any edge or corner to size. Things snap to the wall's edges and middle and to each other; hold Alt to place freely, Shift on a corner to keep the shape. Arrows nudge.</p>
          </div>
        )}

        <div className="mt-auto space-y-3 border-t border-[var(--room-hair)] pt-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Word lit={outlines} onClick={() => setOutlines((v) => !v)} tip="Outlines and corners on the wall while you edit">Outlines on the wall</Word>
            <Word lit={grid} onClick={() => setGrid((v) => !v)} tip="A grid across the selected wall (G)">Grid</Word>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {!inWindow && <Word onClick={() => { if (!openProjectorWindow()) toast('The browser blocked the window. Allow pop-ups for Jomify and try again.', { tone: 'error' }); }} tip="Drag it onto the projector's screen, then press F there for full screen">{frame.reported ? 'Projector window' : 'Open the projector window'}</Word>}
            <Word onClick={undo} disabled={!undoable} tip="Cmd/Ctrl Z">Undo</Word>
            <button type="button" onClick={close} className="ui-pill">Done</button>
          </div>
        </div>
      </aside>

      {/* the stage */}
      <div ref={stageRef} className="relative min-w-0 flex-1 overflow-hidden" onPointerDown={() => { if (mode === 'assets') setItemId(null); else setCorner(null); }}>
        {mode === 'walls' && scale > 0 && (
          <>
            <div className="absolute" style={{ left: fx, top: fy, width: fw, height: fh, boxShadow: '0 0 0 1px var(--room-hair)' }}>
              <div style={{ width: frame.w, height: frame.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                <ProjectionCanvas layout={layout} track={track} w={frame.w} h={frame.h} editing />
              </div>
            </div>
            <svg className="absolute left-0 top-0" width={stage.w} height={stage.h}>
              {layout.walls.map((w) => {
                const pts = w.corners.map(([x, y]) => [fx + x * fw, fy + y * fh]);
                const here = w.id === wall?.id;
                const ok = isConvexQuad(pts);
                return (
                  <g key={w.id}>
                    <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="rgba(0,0,0,0.001)" stroke={ok ? (here ? 'var(--room-paper)' : 'rgba(241,239,233,0.45)') : 'rgb(248,113,113)'} strokeWidth={here ? 2 : 1} strokeDasharray={ok ? undefined : '6 4'} style={{ cursor: 'move' }} onPointerDown={(e) => startWall(e, w)} />
                    <text x={pts[0][0]} y={pts[0][1] - 14} fill={here ? 'var(--room-paper)' : 'rgba(241,239,233,0.6)'} fontSize="11" style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{w.name}</text>
                    {pts.map(([x, y], k) => (
                      <circle key={k} cx={x} cy={y} r={here && corner === k ? 8 : 6} fill={here && corner === k ? 'var(--room-paper)' : 'var(--room-ink)'} stroke="var(--room-paper)" strokeWidth={here ? 2 : 1.25} style={{ cursor: 'grab' }} onPointerDown={(e) => startCorner(e, w, k)}>
                        <title>{`Corner ${k + 1} of ${w.name}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </svg>
          </>
        )}

        {mode === 'assets' && wall && flat && flatScale > 0 && (
          <div className="absolute bg-black" style={{ left: wx, top: wy, width: ww, height: wh, boxShadow: carry && Math.hypot(carry.x - carry.sx, carry.y - carry.sy) > 6 ? '0 0 0 2px var(--room-paper)' : '0 0 0 1px var(--room-hair)' }}>
            <div className="absolute inset-0 overflow-hidden"><WallContent items={wallItems} track={track} bw={ww} bh={wh} editing /></div>
            {grid && <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)', backgroundSize: `${ww / 8}px ${wh / 8}px` }} />}
            {snapLines.x.map((x, k) => <div key={`x${k}`} className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: x * ww, background: 'rgba(241,239,233,0.6)' }} />)}
            {snapLines.y.map((y, k) => <div key={`y${k}`} className="pointer-events-none absolute left-0 right-0 h-px" style={{ top: y * wh, background: 'rgba(241,239,233,0.6)' }} />)}
            {wallItems.map((it) => {
              const r = itemPx(it, ww, wh);
              const sel = it.id === itemId;
              return (
                <div key={it.id} role="button" tabIndex={-1} aria-label={WIDGETS[it.widget]?.label} onPointerDown={(e) => startItem(e, it)}
                  className="absolute touch-none" style={{ ...r, cursor: 'move', outline: sel ? '1.5px solid var(--room-paper)' : '1px dashed rgba(241,239,233,0.35)' }}>
                  <span className="room-mono pointer-events-none absolute -top-5 left-0 whitespace-nowrap text-[var(--room-dim)]">{WIDGETS[it.widget]?.label}</span>
                  {sel && HANDLES.map((h) => {
                    const left = h.includes('w') ? 0 : h.includes('e') ? '100%' : '50%';
                    const top = h.includes('n') ? 0 : h.includes('s') ? '100%' : '50%';
                    return <span key={h} onPointerDown={(e) => startResize(e, it, h)} aria-hidden="true" className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 touch-none bg-[var(--room-paper)]" style={{ left, top, cursor: CURSOR[h], boxShadow: '0 0 0 1px var(--room-ink)' }} />;
                  })}
                </div>
              );
            })}
            <Mono className="pointer-events-none absolute -top-7 left-0 text-[var(--room-faint)]">{wall.name} · flat · {flat.aspect.toFixed(2)} : 1</Mono>
          </div>
        )}
        {mode === 'assets' && !wall && <p className="absolute inset-0 flex items-center justify-center text-[14px] text-[var(--room-dim)]">Set up a wall first, in step 1.</p>}

        {carry && Math.hypot(carry.x - carry.sx, carry.y - carry.sy) > 6 && (
          <span className="room-mono pointer-events-none absolute rounded-[3px] px-2 py-1 text-[var(--room-ink)]" style={{ left: carry.x + 12, top: carry.y + 12, background: 'var(--room-paper)' }}>{WIDGETS[carry.widget]?.label}</span>
        )}
      </div>
    </div>
  );
}
