import { useEffect, useRef, useState } from 'react';
import { Projector, Plus, Trash2, Download, Upload, Grid3x3, Check, X, Copy, Pencil, Image as ImageIcon, Type, Minus, Mic2, Clock, Activity, ListMusic, Paintbrush, ChevronsLeftRight, ChevronsUpDown } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { useProgress } from '../../hooks/useProgress';
import { fetchQueue } from '../../services/spotify/api';
import { findLyrics, LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';
import { formatTime } from '../../utils/formatTime';
import { solveHomography, homographyToMatrix3d, invertHomography, applyHomography, quadBounds, isConvexQuad, pointInQuad } from '../../utils/homography';
import { fitFontSize } from '../../utils/fitText';
import AudioWaveform from '../../components/AudioWaveform';
import {
  WIDGETS, loadProjectorState, saveProjectorState, newWall, newItem, dropRect, estimateAspect, cornerLayout, flatWallLayout,
  cloneLayout, exportLayout, parseLayoutFile
} from './projectorLayouts';

// Projection mapping inside Zen mode. The screen goes black; each wall is a four-cornered patch
// the user drags onto the real surface, and an ordinary element warped with a CSS homography.
// Assets are laid out on the wall's flat rectangle and the warp carries them onto the room. The
// editor (E) has two steps: place the walls, then drop assets onto them; off, there is nothing
// on screen but the content.

const HANDLE_PX = 14;

// Keeps the move events coming to the element even once the pointer has left it
const capture = (e) => { try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no active pointer: a synthetic event */ } };
const NUDGE_PX = 1;
const NUDGE_FAST_PX = 10;

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// Where the content sits inside the surface's box: its own shape, letterboxed, not stretched
function contentBox(bw, bh, aspect, align = 'center') {
  if (!aspect) return { left: 0, top: 0, width: bw, height: bh };
  let width = bw;
  let height = bw / aspect;
  if (height > bh) { height = bh; width = bh * aspect; }
  const left = align === 'left' ? 0 : align === 'right' ? bw - width : (bw - width) / 2;
  return { left, top: (bh - height) / 2, width, height };
}

// ---------------------------------------------------------------- widgets

function ArtWidget({ track, box }) {
  const url = track?.album?.images?.[0]?.url;
  if (!url) return <Placeholder box={box} label="Album art" />;
  return <img src={url} alt="" draggable="false" className="absolute object-cover" style={{ ...px(box), borderRadius: box.width * 0.03 }} />;
}

function TitleWidget({ track, box, options }) {
  const align = options?.align || 'left';
  const name = track?.name || 'Song title';
  const artists = track ? (track.artists || []).map((a) => a.name).join(', ') : 'Artist';
  const album = track?.album?.name || '';
  // The title gets up to 60% of the height, the artist 20%, the album 10%; each sized to fit
  const titleSize = fitFontSize(name, box.width, box.height * 0.6, 3);
  const artistSize = Math.min(fitFontSize(artists, box.width, box.height * 0.2, 2), titleSize * 0.6);
  const albumSize = Math.min(fitFontSize(album, box.width, box.height * 0.1, 1), artistSize * 0.75);
  return (
    <div className="absolute flex flex-col justify-center text-white" style={{ ...px(box), textAlign: align, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
      <p className="font-black tracking-tight leading-[1.05] [text-wrap:balance] break-words w-full" style={{ fontSize: titleSize }}>{name}</p>
      <p className="font-semibold text-white/70 leading-tight break-words w-full" style={{ fontSize: artistSize, marginTop: box.height * 0.04 }}>{artists}</p>
      {album && <p className="text-white/40 truncate w-full" style={{ fontSize: albumSize, marginTop: box.height * 0.03 }}>{album}</p>}
    </div>
  );
}

function ProgressWidget({ box }) {
  const { position, duration } = useProgress();
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const font = Math.max(10, box.height * 0.32);
  return (
    <div className="absolute flex flex-col justify-center text-white/80" style={px(box)}>
      <div className="w-full rounded-full bg-white/15 overflow-hidden" style={{ height: Math.max(3, box.height * 0.14) }}>
        <div className="h-full bg-white rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between font-semibold tabular-nums" style={{ fontSize: font, marginTop: box.height * 0.12 }}>
        <span>{formatTime(position)}</span>
        <span>{duration ? `-${formatTime(Math.max(0, duration - position))}` : '0:00'}</span>
      </div>
    </div>
  );
}

const lyricCache = new Map(); // track id -> { synced, plain } | 'none'

function LyricsWidget({ track, box }) {
  const { position, duration } = useProgress();
  const trackId = track?.id;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!trackId || lyricCache.has(trackId)) return undefined;
    let cancelled = false;
    findLyrics(track, duration ? duration / 1000 : null)
      .then((found) => { lyricCache.set(trackId, found); })
      .catch(() => { lyricCache.set(trackId, 'none'); })
      .finally(() => { if (!cancelled) setLoaded((n) => n + 1); });
    return () => { cancelled = true; };
    // Keyed on the track, not its duration ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  const found = trackId ? lyricCache.get(trackId) : null;
  const synced = found && found !== 'none' ? found.synced : null;
  const font = box.height * 0.2;
  if (!track) return <Placeholder box={box} label="Lyrics" />;
  if (!synced) {
    return (
      <div className="absolute flex items-center justify-center text-white/30 font-semibold" style={{ ...px(box), fontSize: font * 0.5 }}>
        {found === undefined ? '…' : found === 'none' || !found?.plain?.length ? '' : 'Lyrics for this song aren\'t timed'}
      </div>
    );
  }
  const idx = synced.findLastIndex((l) => l.timeMs <= position + LYRIC_LEAD_IN_MS);
  const line = (k) => synced[k]?.text?.trim() || (k >= 0 && k < synced.length ? '♪' : '');
  const current = idx >= 0 ? line(idx) : '';
  const mainSize = Math.min(font, fitFontSize(current || 'x', box.width, box.height * 0.55, 3));
  const sideSize = Math.min(mainSize * 0.5, fitFontSize(line(idx - 1) + line(idx + 1), box.width, box.height * 0.18, 1));
  return (
    <div className="absolute flex flex-col justify-center text-center text-white" style={px(box)}>
      <p className="text-white/35 font-semibold truncate" style={{ fontSize: sideSize }}>{line(idx - 1)}</p>
      <p className="font-black leading-tight [text-wrap:balance]" style={{ fontSize: mainSize, marginBlock: mainSize * 0.25 }}>{current}</p>
      <p className="text-white/35 font-semibold truncate" style={{ fontSize: sideSize }}>{line(idx + 1)}</p>
    </div>
  );
}

function ClockWidget({ box }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="absolute flex items-center justify-center font-black tabular-nums text-white" style={{ ...px(box), fontSize: box.height * 0.75 }}>
      {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </div>
  );
}

function WaveformWidget({ box }) {
  const paused = usePlayerStore((s) => s.playbackState?.paused ?? true);
  const scale = box.height / 96; // the lg preset is 64px of bars plus margins
  return (
    <div className="absolute flex items-center justify-center" style={px(box)}>
      <div style={{ transform: `scale(${scale})` }}><AudioWaveform size="lg" isActive={!paused} /></div>
    </div>
  );
}

function NextWidget({ track, box }) {
  const token = useUserStore((s) => s.token);
  const [upNext, setUpNext] = useState([]);
  const trackId = track?.id;
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const load = () => fetchQueue(token)
      .then((data) => { if (!cancelled) setUpNext((data?.queue || []).filter((t) => t && t.type !== 'episode').slice(0, 3)); })
      .catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, trackId]);
  const font = box.height * 0.22;
  return (
    <div className="absolute flex flex-col justify-center text-white" style={px(box)}>
      <p className="uppercase tracking-[0.3em] text-white/40 font-bold" style={{ fontSize: font * 0.45 }}>Up next</p>
      {upNext.length === 0 ? (
        <p className="text-white/30 font-semibold" style={{ fontSize: font * 0.7 }}>{track ? 'Nothing queued' : 'Up next'}</p>
      ) : upNext.map((t, i) => (
        <p key={`${t.id}-${i}`} className="truncate font-semibold" style={{ fontSize: Math.min(i === 0 ? font * 0.8 : font * 0.55, fitFontSize(`${t.name} · ${(t.artists || []).map((a) => a.name).join(', ')}`, box.width, font, 1)), opacity: i === 0 ? 1 : 0.5 }}>
          {t.name} <span className="text-white/50 font-medium">· {(t.artists || []).map((a) => a.name).join(', ')}</span>
        </p>
      ))}
    </div>
  );
}

function WashWidget({ track, box }) {
  const art = track?.album?.images?.[0]?.url || '';
  const [wash, setWash] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (art) getBlurredBackdrop(art).then((url) => { if (!cancelled) setWash({ art, url }); });
    return () => { cancelled = true; };
  }, [art]);
  const url = wash?.art === art ? wash.url : art;
  if (!url) return <Placeholder box={box} label="Colour wash" />;
  return <div className="absolute bg-cover bg-center opacity-70" style={{ ...px(box), backgroundImage: `url(${url})`, filter: wash?.art === art ? 'none' : 'blur(30px) saturate(2)' }} />;
}

function Placeholder({ box, label }) {
  return (
    <div className="absolute flex items-center justify-center border border-dashed border-white/25 text-white/40 font-semibold" style={{ ...px(box), fontSize: Math.max(12, box.height * 0.12) }}>
      {label}
    </div>
  );
}

const px = (box) => ({ left: box.left, top: box.top, width: box.width, height: box.height });

const WIDGET_VIEW = { art: ArtWidget, title: TitleWidget, progress: ProgressWidget, lyrics: LyricsWidget, clock: ClockWidget, waveform: WaveformWidget, next: NextWidget, wash: WashWidget };

// ---------------------------------------------------------------- a wall

const WIDGET_ICON = { art: ImageIcon, title: Type, progress: Minus, lyrics: Mic2, clock: Clock, waveform: Activity, next: ListMusic, wash: Paintbrush };

// The wall's flat rectangle: as wide on screen as the quad, as tall as its shape says
function wallRect(wall, vw, vh) {
  const corners = wall.corners.map(([x, y]) => [x * vw, y * vh]);
  const bounds = quadBounds(corners);
  const aspect = wall.aspect || estimateAspect(corners);
  const bw = Math.max(1, Math.round(bounds.width));
  const bh = Math.max(1, Math.round(bw / aspect));
  return { corners, bw, bh, aspect, convex: isConvexQuad(corners) };
}

function Wall({ wall, items, track, vw, vh, editing, mode, selectedWallId, selectedItemId, selectedCorner, showGrid, dropTarget, onSelectWall, onSelectItem, onDragCorner, onDragWall, onDragItem, onResizeItem }) {
  const { corners, bw, bh, convex } = wallRect(wall, vw, vh);
  const H = convex ? solveHomography(bw, bh, corners) : null;
  const warp = homographyToMatrix3d(H);
  const wallSelected = wall.id === selectedWallId;
  const centre = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4];

  return (
    <>
      {convex && (
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{ width: bw, height: bh, transform: warp, transformOrigin: '0 0', backfaceVisibility: 'hidden' }}
        >
          {items.map((item) => {
            const r = { left: item.rect.x * bw, top: item.rect.y * bh, width: Math.max(1, item.rect.w * bw), height: Math.max(1, item.rect.h * bh) };
            const inner = contentBox(r.width, r.height, WIDGETS[item.widget]?.aspect, item.options?.align);
            const box = { left: r.left + inner.left, top: r.top + inner.top, width: inner.width, height: inner.height };
            const View = WIDGET_VIEW[item.widget] || Placeholder;
            const itemSelected = item.id === selectedItemId;
            return (
              <div key={item.id} className="contents">
                <View track={track} box={box} options={item.options} label={WIDGETS[item.widget]?.label} />
                {editing && mode === 'assets' && (
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label={`${WIDGETS[item.widget]?.label} on ${wall.name}`}
                    onPointerDown={(e) => { e.stopPropagation(); onSelectItem(item.id, wall.id); onDragItem(e, item, wall); }}
                    className={`absolute border-2 ${itemSelected ? 'border-[var(--brand-mid)]' : 'border-white/40 border-dashed hover:border-white/80'}`}
                    style={{ ...px(r), cursor: 'move', touchAction: 'none' }}
                  >
                    <span className="absolute left-1 top-1 text-[10px] font-bold uppercase tracking-widest text-white/70 pointer-events-none">{WIDGETS[item.widget]?.label}</span>
                    {itemSelected && (
                      <button
                        type="button"
                        aria-label={`Resize ${WIDGETS[item.widget]?.label}`}
                        onPointerDown={(e) => { e.stopPropagation(); onResizeItem(e, item, wall); }}
                        className="absolute -right-2 -bottom-2 w-4 h-4 rounded-sm bg-[var(--brand-mid)] border border-white"
                        style={{ cursor: 'nwse-resize', touchAction: 'none' }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {showGrid && (
            <div
              className="absolute inset-0 pointer-events-none border-2 border-white/80"
              style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: `${bw / 8}px ${bh / 8}px` }}
            />
          )}
        </div>
      )}
      {editing && (
        <svg className="absolute inset-0 w-full h-full overflow-visible" style={{ pointerEvents: 'none' }} aria-hidden="true">
          <polygon
            points={corners.map((p) => p.join(',')).join(' ')}
            // No fill, ever: a tinted wall is a lit panel on the projector. Outlines only, and the
            // polygon still catches the pointer through its transparent interior.
            fill="rgba(0,0,0,0.001)"
            stroke={convex ? (dropTarget ? 'var(--brand-mid)' : wallSelected ? 'var(--brand-mid)' : 'rgba(255,255,255,0.45)') : 'rgba(248,113,113,0.9)'}
            strokeWidth={dropTarget ? 3 : wallSelected ? 2 : 1}
            strokeDasharray={!convex ? '6 4' : dropTarget ? '10 6' : undefined}
            style={{ pointerEvents: mode === 'walls' ? 'all' : 'none', cursor: 'move' }}
            onPointerDown={(e) => { onSelectWall(wall.id); onDragWall(e, wall); }}
          />
          <text x={centre[0]} y={centre[1]} fill="rgba(255,255,255,0.7)" fontSize="12" fontWeight="700" textAnchor="middle" style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            {wall.name}
          </text>
        </svg>
      )}
      {editing && mode === 'walls' && corners.map(([x, y], k) => (
        <button
          key={k}
          type="button"
          aria-label={`Corner ${k + 1} of ${wall.name}`}
          onPointerDown={(e) => { onSelectWall(wall.id, k); onDragCorner(e, wall, k); }}
          className={`absolute rounded-full border-2 touch-none ${wallSelected && selectedCorner === k ? 'border-[var(--brand-mid)] bg-[var(--brand-mid)]' : wallSelected ? 'border-[var(--brand-mid)] bg-neutral-950' : 'border-white/70 bg-neutral-950/80'}`}
          style={{ left: x - HANDLE_PX / 2, top: y - HANDLE_PX / 2, width: HANDLE_PX, height: HANDLE_PX, cursor: 'grab' }}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- the view

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n) => clamp(n, -0.25, 1.25);

export default function Projection({ onClose }) {
  const track = usePlayerStore((s) => s.playbackState?.track_window?.current_track || null);
  const { w: vw, h: vh } = useViewport();
  const [state, setState] = useState(loadProjectorState);
  const layout = state.layouts.find((l) => l.id === state.activeId) || state.layouts[0];
  const [editing, setEditing] = useState(true);
  const [mode, setMode] = useState(() => (layout.walls.length ? 'assets' : 'walls'));
  const [selectedWallId, setSelectedWallId] = useState(null);
  const [selectedCorner, setSelectedCorner] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [showGrid, setShowGrid] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renamingWall, setRenamingWall] = useState(null);
  // A palette asset being dragged onto a wall: its widget and where the pointer is
  const [carry, setCarry] = useState(null);
  const carryRef = useRef(null); // the same, readable inside a handler before React has re-rendered
  const fileInput = useRef(null);
  const drag = useRef(null);
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const panelDrag = useRef(null);

  // In fullscreen the browser's own Escape would leave fullscreen (and so Zen) before this view
  // saw the key. Chrome lets a fullscreen page keep it; elsewhere Escape works as the browser intends.
  useEffect(() => {
    const kb = navigator.keyboard;
    if (!kb?.lock) return undefined;
    kb.lock(['Escape']).catch(() => {});
    return () => { kb.unlock?.(); };
  }, []);

  useEffect(() => { saveProjectorState(state); }, [state]);

  const updateLayout = (fn) => setState((prev) => ({ ...prev, layouts: prev.layouts.map((l) => (l.id === prev.activeId ? fn(l) : l)) }));
  const updateWall = (id, fn) => updateLayout((l) => ({ ...l, walls: l.walls.map((w) => (w.id === id ? fn(w) : w)) }));
  const updateItem = (id, fn) => updateLayout((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? fn(i) : i)) }));

  const selectWall = (id, corner = null) => { setSelectedWallId(id); setSelectedCorner(corner); setSelectedItemId(null); };
  const selectItem = (id, wallId) => { setSelectedItemId(id); setSelectedWallId(wallId); setSelectedCorner(null); };
  const selectedWall = layout.walls.find((w) => w.id === selectedWallId) || null;
  const selectedItem = layout.items.find((i) => i.id === selectedItemId) || null;

  // From a screen point to fractions of a wall's flat rectangle, through the inverse warp
  const toWallPoint = (wall, clientX, clientY) => {
    const { corners, bw, bh, convex } = wallRect(wall, vw, vh);
    if (!convex) return null;
    const inv = invertHomography(solveHomography(bw, bh, corners));
    if (!inv) return null;
    const [x, y] = applyHomography(inv, clientX, clientY);
    return [x / bw, y / bh];
  };
  const wallAt = (clientX, clientY) => layout.walls.find((w) => pointInQuad(w.corners.map(([x, y]) => [x * vw, y * vh]), clientX, clientY)) || null;

  // Drags: the pointer is captured by the handle, so the move keeps coming even off the element
  const onDragCorner = (e, wall, k) => {
    e.preventDefault(); capture(e);
    drag.current = { kind: 'corner', id: wall.id, k, startX: e.clientX, startY: e.clientY, corners: wall.corners.map((p) => [...p]) };
  };
  const onDragWall = (e, wall) => {
    e.preventDefault(); capture(e);
    drag.current = { kind: 'wall', id: wall.id, startX: e.clientX, startY: e.clientY, corners: wall.corners.map((p) => [...p]) };
  };
  const onDragItem = (e, item, wall) => {
    e.preventDefault(); capture(e);
    const start = toWallPoint(wall, e.clientX, e.clientY);
    if (!start) return;
    drag.current = { kind: 'item', id: item.id, wall, start, rect: { ...item.rect } };
  };
  const onResizeItem = (e, item, wall) => {
    e.preventDefault(); capture(e);
    const start = toWallPoint(wall, e.clientX, e.clientY);
    if (!start) return;
    drag.current = { kind: 'resize', id: item.id, wall, start, rect: { ...item.rect } };
  };
  const onPointerMove = (e) => {
    if (panelDrag.current) {
      const pd = panelDrag.current;
      setPanelPos({ x: Math.max(0, pd.x + e.clientX - pd.startX), y: Math.max(0, pd.y + e.clientY - pd.startY) });
      return;
    }
    if (carryRef.current) { setCarry((c) => (c ? { ...c, x: e.clientX, y: e.clientY } : c)); return; }
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'corner' || d.kind === 'wall') {
      const dx = (e.clientX - d.startX) / vw;
      const dy = (e.clientY - d.startY) / vh;
      updateWall(d.id, (w) => ({ ...w, corners: d.corners.map(([x, y], k) => (d.kind === 'wall' || k === d.k ? [clamp01(x + dx), clamp01(y + dy)] : [x, y])) }));
      return;
    }
    const now = toWallPoint(d.wall, e.clientX, e.clientY);
    if (!now) return;
    const dx = now[0] - d.start[0];
    const dy = now[1] - d.start[1];
    if (d.kind === 'item') {
      updateItem(d.id, (i) => ({ ...i, rect: { ...i.rect, x: clamp(d.rect.x + dx, -i.rect.w * 0.5, 1 - i.rect.w * 0.5), y: clamp(d.rect.y + dy, -i.rect.h * 0.5, 1 - i.rect.h * 0.5) } }));
    } else if (d.kind === 'resize') {
      updateItem(d.id, (i) => ({ ...i, rect: { ...i.rect, w: clamp(d.rect.w + dx, 0.04, 1.5), h: clamp(d.rect.h + dy, 0.03, 1.5) } }));
    }
  };
  const dropCarry = (clientX, clientY) => {
    const carried = carryRef.current;
    if (!carried) return;
    const hit = wallAt(clientX, clientY);
    const wall = hit || selectedWall || layout.walls[0] || null;
    carryRef.current = null;
    setCarry(null);
    if (!wall) return;
    const at = hit ? toWallPoint(wall, clientX, clientY) || [0.5, 0.5] : [0.5, 0.5];
    const item = newItem(wall.id, carried.widget, dropRect(carried.widget, at[0], at[1], wallRect(wall, vw, vh).aspect));
    updateLayout((l) => ({ ...l, items: [...l.items, item] }));
    selectItem(item.id, wall.id);
    setMode('assets');
  };
  const onPointerUp = (e) => {
    if (carryRef.current) dropCarry(e.clientX, e.clientY);
    drag.current = null; panelDrag.current = null;
  };

  // Palette: press and drag an asset onto a wall; a plain click puts it on the selected wall
  const startCarry = (e, widget) => {
    e.preventDefault();
    capture(e);
    const c = { widget, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    carryRef.current = c;
    setCarry(c);
  };
  const carryMoved = carry && (Math.abs(carry.x - carry.startX) > 6 || Math.abs(carry.y - carry.startY) > 6);
  const dropTargetId = carry && carryMoved ? wallAt(carry.x, carry.y)?.id || null : null;

  const addWall = () => {
    const n = layout.walls.length + 1;
    const w = newWall([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], `Wall ${n}`);
    updateLayout((l) => ({ ...l, walls: [...l.walls, w] }));
    selectWall(w.id);
    setMode('walls');
  };
  const removeWall = (id) => {
    updateLayout((l) => ({ ...l, walls: l.walls.filter((w) => w.id !== id), items: l.items.filter((i) => i.wallId !== id) }));
    if (selectedWallId === id) selectWall(null);
  };
  const removeItem = (id) => {
    updateLayout((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }));
    if (selectedItemId === id) setSelectedItemId(null);
  };
  const nudgeAspect = (wall, factor) => updateWall(wall.id, (w) => ({ ...w, aspect: clamp((w.aspect || wallRect(w, vw, vh).aspect) * factor, 0.2, 5) }));
  const addLayout = (make) => setState((prev) => { const l = make(); return { ...prev, activeId: l.id, layouts: [...prev.layouts, l] }; });
  const duplicateLayout = () => setState((prev) => { const copy = cloneLayout(layout, `${layout.name} copy`); return { ...prev, activeId: copy.id, layouts: [...prev.layouts, copy] }; });
  const removeLayout = () => setState((prev) => {
    if (prev.layouts.length <= 1) return prev;
    const rest = prev.layouts.filter((l) => l.id !== prev.activeId);
    return { ...prev, activeId: rest[0].id, layouts: rest };
  });
  const renameLayout = (name) => updateLayout((l) => ({ ...l, name: name.trim() || l.name }));
  const download = () => {
    const blob = new Blob([exportLayout(layout)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
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
      setState((prev) => ({ ...prev, activeId: imported.id, layouts: [...prev.layouts, imported] }));
    } catch (err) {
      alert(err.message || "Couldn't read that file");
    }
  };

  // Keys: E editor, G grid, W/A switch step, Delete removes what is selected, arrows nudge it
  // (Alt: one corner of a wall), Escape closes the editor or leaves the projector
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      if (key === 'e') { setEditing((v) => !v); return; }
      if (key === 'g') { setShowGrid((v) => !v); return; }
      if (key === 'w' && editing) { setMode('walls'); return; }
      if (key === 'a' && editing) { setMode('assets'); return; }
      if (e.key === 'Escape') { if (carryRef.current) { carryRef.current = null; setCarry(null); } else if (editing) setEditing(false); else onClose(); return; }
      if (!editing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (mode === 'assets' && selectedItemId) removeItem(selectedItemId);
        else if (mode === 'walls' && selectedWallId) removeWall(selectedWallId);
        return;
      }
      const step = (e.shiftKey ? NUDGE_FAST_PX : NUDGE_PX);
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!move) return;
      e.preventDefault();
      if (mode === 'walls' && selectedWallId) {
        const [dx, dy] = [move[0] / vw, move[1] / vh];
        updateWall(selectedWallId, (w) => ({ ...w, corners: w.corners.map(([x, y], k) => (e.altKey && selectedCorner !== null ? k === selectedCorner : true) ? [clamp01(x + dx), clamp01(y + dy)] : [x, y]) }));
      } else if (mode === 'assets' && selectedItem) {
        const wall = layout.walls.find((w) => w.id === selectedItem.wallId);
        if (!wall) return;
        const { bw, bh } = wallRect(wall, vw, vh);
        updateItem(selectedItem.id, (i) => ({ ...i, rect: { ...i.rect, x: i.rect.x + move[0] / bw, y: i.rect.y + move[1] / bh } }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode, selectedWallId, selectedCorner, selectedItemId, carry, vw, vh, onClose, layout]);

  const tab = (id, label) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold ${mode === id ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/10'}`}>{label}</button>
  );

  return (
    <div
      className={`fixed inset-0 z-[9500] bg-black select-none overflow-hidden ${editing ? '' : 'cursor-none'}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelectedItemId(null); if (mode === 'walls') selectWall(null); } }}
    >
      {layout.walls.map((w) => (
        <Wall
          key={w.id}
          wall={w}
          items={layout.items.filter((i) => i.wallId === w.id)}
          track={track}
          vw={vw}
          vh={vh}
          editing={editing}
          mode={mode}
          selectedWallId={selectedWallId}
          selectedItemId={selectedItemId}
          selectedCorner={selectedCorner}
          showGrid={showGrid}
          dropTarget={dropTargetId === w.id}
          onSelectWall={selectWall}
          onSelectItem={selectItem}
          onDragCorner={onDragCorner}
          onDragWall={onDragWall}
          onDragItem={onDragItem}
          onResizeItem={onResizeItem}
        />
      ))}

      {carry && carryMoved && (
        <div className="absolute pointer-events-none z-20 rounded-lg bg-[var(--brand-mid)] text-white text-xs font-bold px-2 py-1 shadow-xl" style={{ left: carry.x + 12, top: carry.y + 12 }}>
          {WIDGETS[carry.widget]?.label}{dropTargetId ? '' : ' — drop on a wall'}
        </div>
      )}

      {editing && (
        <div
          className="absolute z-10 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-neutral-950/90 border border-white/10 shadow-2xl backdrop-blur-xl text-sm text-white p-4 space-y-4 cursor-default"
          style={{ left: panelPos.x, top: panelPos.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => { if (carryRef.current) { e.stopPropagation(); dropCarry(e.clientX, e.clientY); } }}
        >
          <div
            className="flex items-center justify-between gap-2 cursor-move -m-4 mb-0 p-4 pb-0"
            onPointerDown={(e) => {
              if (e.target.closest('button')) return;
              capture(e);
              panelDrag.current = { x: panelPos.x, y: panelPos.y, startX: e.clientX, startY: e.clientY };
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <p className="flex items-center gap-2 font-bold"><Projector className="w-4 h-4 text-[var(--brand-mid)]" /> Projector</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowGrid((v) => !v)} aria-pressed={showGrid} title="Alignment grid (G)" className={`w-8 h-8 rounded-lg flex items-center justify-center ${showGrid ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}><Grid3x3 className="w-4 h-4" /></button>
              <button type="button" onClick={() => setEditing(false)} title="Done (E)" className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10"><Check className="w-4 h-4" /></button>
              <button type="button" onClick={onClose} title="Leave the projector (P)" className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Layouts */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Layout</p>
            {renaming ? (
              <input
                autoFocus
                defaultValue={layout.name}
                onBlur={(e) => { renameLayout(e.target.value); setRenaming(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { renameLayout(e.target.value); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#f91362]"
              />
            ) : (
              <div className="flex items-center gap-1">
                <select value={state.activeId} onChange={(e) => { setState((prev) => ({ ...prev, activeId: e.target.value })); selectWall(null); }} className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none">
                  {state.layouts.map((l) => <option key={l.id} value={l.id} className="bg-neutral-900">{l.name}</option>)}
                </select>
                <button type="button" onClick={() => setRenaming(true)} title="Rename" className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10"><Pencil className="w-4 h-4" /></button>
              </div>
            )}
            <div className="flex flex-wrap gap-1 text-xs">
              <button type="button" onClick={() => addLayout(() => cornerLayout('New corner'))} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Corner</button>
              <button type="button" onClick={() => addLayout(() => flatWallLayout('New wall'))} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Flat wall</button>
              <button type="button" onClick={() => addLayout(() => ({ id: Math.random().toString(36).slice(2, 9), name: 'Empty room', walls: [], items: [] }))} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Empty</button>
              <button type="button" onClick={duplicateLayout} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Copy className="w-3 h-3" /> Duplicate</button>
              <button type="button" onClick={download} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Download className="w-3 h-3" /> Export</button>
              <button type="button" onClick={() => fileInput.current?.click()} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Upload className="w-3 h-3" /> Import</button>
              <button type="button" onClick={removeLayout} disabled={state.layouts.length <= 1} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-1 disabled:opacity-40"><Trash2 className="w-3 h-3" /> Delete</button>
            </div>
            <input ref={fileInput} type="file" accept="application/json,.json" onChange={importFile} className="hidden" />
          </div>

          {/* Step */}
          <div className="flex gap-1 rounded-xl bg-white/5 p-1" role="tablist" aria-label="Editing step">
            {tab('walls', '1. Walls')}
            {tab('assets', '2. Assets')}
          </div>

          {mode === 'walls' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Walls</p>
                <button type="button" onClick={addWall} className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1 text-xs"><Plus className="w-3 h-3" /> Add wall</button>
              </div>
              {layout.walls.length === 0 && <p className="text-xs text-neutral-500">Add a wall, then drag its four corners onto the real one.</p>}
              <ul className="space-y-1">
                {layout.walls.map((w) => (
                  <li key={w.id} className={`rounded-lg px-2 py-1.5 ${w.id === selectedWallId ? 'bg-[var(--brand-mid)]/15 ring-1 ring-[var(--brand-mid)]/50' : 'bg-white/5'}`}>
                    <div className="flex items-center gap-2">
                      {renamingWall === w.id ? (
                        <input autoFocus defaultValue={w.name} onBlur={(e) => { updateWall(w.id, (x) => ({ ...x, name: e.target.value.trim() || x.name })); setRenamingWall(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingWall(null); }} className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-white focus:outline-none" />
                      ) : (
                        <button type="button" onClick={() => selectWall(w.id)} onDoubleClick={() => setRenamingWall(w.id)} className="flex-1 min-w-0 text-left truncate font-semibold">{w.name}</button>
                      )}
                      <span className="text-[10px] text-neutral-500 tabular-nums">{layout.items.filter((i) => i.wallId === w.id).length} on it</span>
                      <button type="button" onClick={() => setRenamingWall(w.id)} aria-label={`Rename ${w.name}`} className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/10"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => removeWall(w.id)} aria-label={`Remove ${w.name}`} className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    {w.id === selectedWallId && (
                      <div className="flex items-center gap-1 mt-1.5 text-[11px] text-neutral-400">
                        <span className="flex-1">Shape {wallRect(w, vw, vh).aspect.toFixed(2)}:1{w.aspect ? '' : ' (guessed)'}</span>
                        <button type="button" onClick={() => nudgeAspect(w, 1.1)} aria-label="Make the wall wider" title="Content looks squashed: wider" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/10 hover:text-white"><ChevronsLeftRight className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => nudgeAspect(w, 1 / 1.1)} aria-label="Make the wall taller" title="Content looks stretched: taller" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/10 hover:text-white"><ChevronsUpDown className="w-3.5 h-3.5" /></button>
                        {w.aspect && <button type="button" onClick={() => updateWall(w.id, (x) => ({ ...x, aspect: null }))} className="px-1.5 py-1 rounded hover:bg-white/10 hover:text-white">Auto</button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {selectedWall && !isConvexQuad(selectedWall.corners) && <p className="text-xs text-red-300">This wall is folded over itself; move a corner so the shape doesn't cross.</p>}
              <p className="text-[11px] leading-relaxed text-neutral-500">Drag a wall's corners onto the real wall, or drag the whole shape to move it. Arrows nudge the selected wall (Shift: faster, Alt: one corner). Then go to step 2.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Assets</p>
              {layout.walls.length === 0 ? (
                <p className="text-xs text-neutral-500">Set up a wall first.</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1" aria-label="Asset palette">
                    {Object.entries(WIDGETS).map(([id, w]) => {
                      const Icon = WIDGET_ICON[id] || Plus;
                      return (
                        <button key={id} type="button" aria-label={`Add ${w.label}`} title={`Drag onto a wall, or click to add to ${selectedWall?.name || 'the first wall'}`} onPointerDown={(e) => startCarry(e, id)} className="flex flex-col items-center gap-1 rounded-lg bg-white/5 hover:bg-white/10 px-1 py-2 text-[10px] font-semibold text-neutral-300 hover:text-white touch-none" style={{ cursor: 'grab' }}>
                          <Icon className="w-4 h-4" />
                          <span className="truncate w-full text-center">{w.label.split(' ')[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] leading-relaxed text-neutral-500">Drag an asset onto a wall. On the wall, drag it to move and pull its corner to resize; it is laid out flat and the wall's angle does the rest.</p>
                  {selectedItem && (
                    <div className="rounded-lg bg-[var(--brand-mid)]/15 ring-1 ring-[var(--brand-mid)]/50 px-2 py-1.5 flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate font-semibold">{WIDGETS[selectedItem.widget]?.label}</span>
                      <span className="text-[10px] text-neutral-400 truncate">{layout.walls.find((w) => w.id === selectedItem.wallId)?.name}</span>
                      <select value={selectedItem.widget} onChange={(e) => updateItem(selectedItem.id, (x) => ({ ...x, widget: e.target.value }))} aria-label="What this asset shows" className="bg-transparent text-xs text-neutral-300 focus:outline-none">
                        {Object.entries(WIDGETS).map(([id, w]) => <option key={id} value={id} className="bg-neutral-900">{w.label}</option>)}
                      </select>
                      {selectedItem.widget === 'title' && (
                        <select value={selectedItem.options?.align || 'left'} onChange={(e) => updateItem(selectedItem.id, (x) => ({ ...x, options: { ...x.options, align: e.target.value } }))} aria-label="Text alignment" className="bg-transparent text-xs text-neutral-300 focus:outline-none">
                          <option value="left" className="bg-neutral-900">Left</option>
                          <option value="center" className="bg-neutral-900">Centre</option>
                          <option value="right" className="bg-neutral-900">Right</option>
                        </select>
                      )}
                      <button type="button" onClick={() => removeItem(selectedItem.id)} aria-label="Remove asset" className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {layout.walls.map((w) => (
                      <li key={w.id} className="text-xs">
                        <p className="text-neutral-500 font-semibold">{w.name}</p>
                        {layout.items.filter((i) => i.wallId === w.id).length === 0 ? <p className="text-neutral-600 pl-2">nothing yet</p> : (
                          <ul className="pl-2">
                            {layout.items.filter((i) => i.wallId === w.id).map((i) => (
                              <li key={i.id}><button type="button" onClick={() => selectItem(i.id, w.id)} className={`w-full text-left rounded px-1.5 py-0.5 ${i.id === selectedItemId ? 'bg-[var(--brand-mid)]/20 text-white' : 'text-neutral-300 hover:bg-white/5'}`}>{WIDGETS[i.widget]?.label}</button></li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-neutral-500">
            <kbd className="text-neutral-300">E</kbd> hides this panel, <kbd className="text-neutral-300">G</kbd> shows a grid, <kbd className="text-neutral-300">W</kbd>/<kbd className="text-neutral-300">A</kbd> switch step, <kbd className="text-neutral-300">P</kbd> leaves the projector.
          </p>
        </div>
      )}
    </div>
  );
}
