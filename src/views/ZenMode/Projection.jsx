import { useEffect, useRef, useState } from 'react';
import { Projector, Plus, Trash2, Download, Upload, Grid3x3, Check, X, Copy, Pencil } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { useProgress } from '../../hooks/useProgress';
import { fetchQueue } from '../../services/spotify/api';
import { findLyrics, LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';
import { formatTime } from '../../utils/formatTime';
import { cssWarp, quadBounds, isConvexQuad } from '../../utils/homography';
import { fitFontSize } from '../../utils/fitText';
import AudioWaveform from '../../components/AudioWaveform';
import {
  WIDGETS, loadProjectorState, saveProjectorState, newSurface, cornerLayout, flatWallLayout,
  exportLayout, parseLayoutFile
} from './projectorLayouts';

// Projection mapping inside Zen mode. The screen goes black and each "surface" (a four-cornered
// patch the user drags onto a wall) is an ordinary element warped with a CSS homography, so the
// projector paints album art on one wall and the words on the other. The editor (E) shows the
// corner handles; off, there is nothing on screen but the content.

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

// ---------------------------------------------------------------- a surface

function Surface({ surface, track, vw, vh, editing, selected, showGrid, onSelect, onDragCorner, onDragSurface }) {
  const corners = surface.corners.map(([x, y]) => [x * vw, y * vh]);
  const convex = isConvexQuad(corners);
  const bounds = quadBounds(corners);
  const bw = Math.max(1, Math.round(bounds.width));
  const bh = Math.max(1, Math.round(bounds.height));
  // Eight numbers and a small solve: cheap enough to do on every render, which only happens
  // when a corner moves or the track changes
  const warp = cssWarp(bw, bh, corners);
  const View = WIDGET_VIEW[surface.widget] || Placeholder;
  const box = contentBox(bw, bh, WIDGETS[surface.widget]?.aspect, surface.options?.align);

  return (
    <>
      {convex && (
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{ width: bw, height: bh, transform: warp, transformOrigin: '0 0', backfaceVisibility: 'hidden' }}
        >
          <View track={track} box={box} options={surface.options} label={WIDGETS[surface.widget]?.label} />
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
            fill={selected ? 'rgba(249,19,98,0.12)' : 'rgba(255,255,255,0.04)'}
            stroke={convex ? (selected ? 'var(--brand-mid)' : 'rgba(255,255,255,0.5)') : 'rgba(248,113,113,0.9)'}
            strokeWidth={selected ? 2 : 1}
            strokeDasharray={convex ? undefined : '6 4'}
            style={{ pointerEvents: 'all', cursor: 'move' }}
            onPointerDown={(e) => { onSelect(surface.id); onDragSurface(e, surface); }}
          />
          <text
            x={corners.reduce((s, p) => s + p[0], 0) / 4}
            y={corners.reduce((s, p) => s + p[1], 0) / 4}
            fill="rgba(255,255,255,0.7)"
            fontSize="12"
            fontWeight="700"
            textAnchor="middle"
            style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.2em' }}
          >
            {WIDGETS[surface.widget]?.label}
          </text>
        </svg>
      )}
      {editing && corners.map(([x, y], k) => (
        <button
          key={k}
          type="button"
          aria-label={`Corner ${k + 1} of ${WIDGETS[surface.widget]?.label}`}
          onPointerDown={(e) => { onSelect(surface.id, k); onDragCorner(e, surface, k); }}
          className={`absolute rounded-full border-2 touch-none ${selected ? 'border-[var(--brand-mid)] bg-neutral-950' : 'border-white/70 bg-neutral-950/80'}`}
          style={{ left: x - HANDLE_PX / 2, top: y - HANDLE_PX / 2, width: HANDLE_PX, height: HANDLE_PX, cursor: 'grab' }}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- the view

export default function Projection({ onClose }) {
  const track = usePlayerStore((s) => s.playbackState?.track_window?.current_track || null);
  const { w: vw, h: vh } = useViewport();
  const [state, setState] = useState(loadProjectorState);
  const layout = state.layouts.find((l) => l.id === state.activeId) || state.layouts[0];
  const [editing, setEditing] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedCorner, setSelectedCorner] = useState(null);
  const [showGrid, setShowGrid] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const fileInput = useRef(null);
  const drag = useRef(null);
  // The panel can be dragged by its header out of the way of a surface
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const panelDrag = useRef(null);

  // In fullscreen the browser's own Escape would leave fullscreen (and so Zen) before this view
  // saw the key. Chrome lets a fullscreen page keep it; where that isn't supported, Escape
  // still works as the browser intends.
  useEffect(() => {
    const kb = navigator.keyboard;
    if (!kb?.lock) return undefined;
    kb.lock(['Escape']).catch(() => {});
    return () => { kb.unlock?.(); };
  }, []);

  useEffect(() => { saveProjectorState(state); }, [state]);

  const updateLayout = (fn) => setState((prev) => ({
    ...prev,
    layouts: prev.layouts.map((l) => (l.id === prev.activeId ? fn(l) : l))
  }));
  const updateSurface = (id, fn) => updateLayout((l) => ({ ...l, surfaces: l.surfaces.map((s) => (s.id === id ? fn(s) : s)) }));
  const clamp01 = (n) => Math.max(-0.25, Math.min(1.25, n));

  // Drags: the pointer is captured by the handle, so the move keeps coming even off the element
  const onDragCorner = (e, surface, k) => {
    e.preventDefault();
    capture(e);
    drag.current = { kind: 'corner', id: surface.id, k, startX: e.clientX, startY: e.clientY, corners: surface.corners.map((p) => [...p]) };
  };
  const onDragSurface = (e, surface) => {
    e.preventDefault();
    capture(e);
    drag.current = { kind: 'surface', id: surface.id, startX: e.clientX, startY: e.clientY, corners: surface.corners.map((p) => [...p]) };
  };
  const onPointerMove = (e) => {
    if (panelDrag.current) {
      const pd = panelDrag.current;
      setPanelPos({ x: Math.max(0, pd.x + e.clientX - pd.startX), y: Math.max(0, pd.y + e.clientY - pd.startY) });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / vw;
    const dy = (e.clientY - d.startY) / vh;
    updateSurface(d.id, (s) => ({
      ...s,
      corners: d.corners.map(([x, y], k) => (d.kind === 'surface' || k === d.k ? [clamp01(x + dx), clamp01(y + dy)] : [x, y]))
    }));
  };
  const onPointerUp = () => { drag.current = null; panelDrag.current = null; };

  const select = (id, corner = null) => { setSelectedId(id); setSelectedCorner(corner); };
  const selected = layout.surfaces.find((s) => s.id === selectedId) || null;

  const addSurface = (widget) => {
    const s = newSurface(widget, [[0.35, 0.4], [0.65, 0.4], [0.65, 0.6], [0.35, 0.6]]);
    updateLayout((l) => ({ ...l, surfaces: [...l.surfaces, s] }));
    select(s.id);
  };
  const removeSurface = (id) => {
    updateLayout((l) => ({ ...l, surfaces: l.surfaces.filter((s) => s.id !== id) }));
    if (selectedId === id) select(null);
  };
  const addLayout = (make) => setState((prev) => {
    const l = make();
    return { ...prev, activeId: l.id, layouts: [...prev.layouts, l] };
  });
  const duplicateLayout = () => setState((prev) => {
    const copy = { ...layout, id: Math.random().toString(36).slice(2, 9), name: `${layout.name} copy`, surfaces: layout.surfaces.map((s) => ({ ...s, id: Math.random().toString(36).slice(2, 9) })) };
    return { ...prev, activeId: copy.id, layouts: [...prev.layouts, copy] };
  });
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

  // Keys: E editor, G grid, Delete removes the selected surface, arrows nudge it (Alt: one
  // corner), Escape closes the editor or leaves the projector
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      if (key === 'e') { setEditing((v) => !v); return; }
      if (key === 'g') { setShowGrid((v) => !v); return; }
      if (e.key === 'Escape') { if (editing) setEditing(false); else onClose(); return; }
      if (!editing || !selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { removeSurface(selectedId); return; }
      const step = (e.shiftKey ? NUDGE_FAST_PX : NUDGE_PX);
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!move) return;
      e.preventDefault();
      const [dx, dy] = [move[0] / vw, move[1] / vh];
      updateSurface(selectedId, (s) => ({
        ...s,
        corners: s.corners.map(([x, y], k) => (e.altKey && selectedCorner !== null ? k === selectedCorner : true) ? [clamp01(x + dx), clamp01(y + dy)] : [x, y])
      }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedId, selectedCorner, vw, vh, onClose]);

  return (
    <div
      className={`fixed inset-0 z-[9500] bg-black select-none overflow-hidden ${editing ? '' : 'cursor-none'}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => { if (e.target === e.currentTarget) select(null); }}
    >
      {layout.surfaces.map((s) => (
        <Surface
          key={s.id}
          surface={s}
          track={track}
          vw={vw}
          vh={vh}
          editing={editing}
          selected={s.id === selectedId}
          showGrid={showGrid}
          onSelect={select}
          onDragCorner={onDragCorner}
          onDragSurface={onDragSurface}
        />
      ))}

      {editing && (
        <div
          className="absolute z-10 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-neutral-950/90 border border-white/10 shadow-2xl backdrop-blur-xl text-sm text-white p-4 space-y-4 cursor-default"
          style={{ left: panelPos.x, top: panelPos.y }}
          onPointerDown={(e) => e.stopPropagation()}
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
                <select value={state.activeId} onChange={(e) => { setState((prev) => ({ ...prev, activeId: e.target.value })); select(null); }} className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none">
                  {state.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button type="button" onClick={() => setRenaming(true)} title="Rename" className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10"><Pencil className="w-4 h-4" /></button>
              </div>
            )}
            <div className="flex flex-wrap gap-1 text-xs">
              <button type="button" onClick={() => addLayout(() => cornerLayout('New corner'))} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Corner</button>
              <button type="button" onClick={() => addLayout(() => flatWallLayout('New wall'))} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Flat wall</button>
              <button type="button" onClick={duplicateLayout} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Copy className="w-3 h-3" /> Duplicate</button>
              <button type="button" onClick={download} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Download className="w-3 h-3" /> Export</button>
              <button type="button" onClick={() => fileInput.current?.click()} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1"><Upload className="w-3 h-3" /> Import</button>
              <button type="button" onClick={removeLayout} disabled={state.layouts.length <= 1} className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-1 disabled:opacity-40"><Trash2 className="w-3 h-3" /> Delete</button>
            </div>
            <input ref={fileInput} type="file" accept="application/json,.json" onChange={importFile} className="hidden" />
          </div>

          {/* Surfaces */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Surfaces</p>
              <select value="" onChange={(e) => { if (e.target.value) addSurface(e.target.value); }} aria-label="Add a surface" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none">
                <option value="">Add…</option>
                {Object.entries(WIDGETS).map(([id, w]) => <option key={id} value={id}>{w.label}</option>)}
              </select>
            </div>
            {layout.surfaces.length === 0 && <p className="text-xs text-neutral-500">Nothing yet. Add a surface, then drag its corners onto the wall.</p>}
            <ul className="space-y-1">
              {layout.surfaces.map((s) => (
                <li key={s.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${s.id === selectedId ? 'bg-[var(--brand-mid)]/15 ring-1 ring-[var(--brand-mid)]/50' : 'bg-white/5'}`}>
                  <button type="button" onClick={() => select(s.id)} className="flex-1 min-w-0 text-left truncate font-semibold">{WIDGETS[s.widget]?.label}</button>
                  <select value={s.widget} onChange={(e) => updateSurface(s.id, (x) => ({ ...x, widget: e.target.value }))} aria-label="What this surface shows" className="bg-transparent text-xs text-neutral-300 focus:outline-none max-w-[7rem]">
                    {Object.entries(WIDGETS).map(([id, w]) => <option key={id} value={id} className="bg-neutral-900">{w.label}</option>)}
                  </select>
                  {s.widget === 'title' && (
                    <select value={s.options?.align || 'left'} onChange={(e) => updateSurface(s.id, (x) => ({ ...x, options: { ...x.options, align: e.target.value } }))} aria-label="Text alignment" className="bg-transparent text-xs text-neutral-300 focus:outline-none">
                      <option value="left" className="bg-neutral-900">Left</option>
                      <option value="center" className="bg-neutral-900">Centre</option>
                      <option value="right" className="bg-neutral-900">Right</option>
                    </select>
                  )}
                  <button type="button" onClick={() => removeSurface(s.id)} aria-label="Remove surface" className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
            {selected && !isConvexQuad(selected.corners) && <p className="text-xs text-red-300">This surface is folded over itself; move a corner so the shape doesn't cross.</p>}
          </div>

          <p className="text-[11px] leading-relaxed text-neutral-500">
            Drag corners onto the wall, or drag a surface to move it. Arrow keys nudge the selected surface (Shift: faster, Alt: one corner). <kbd className="text-neutral-300">E</kbd> hides this panel, <kbd className="text-neutral-300">G</kbd> shows an alignment grid, <kbd className="text-neutral-300">P</kbd> leaves the projector.
          </p>
        </div>
      )}
    </div>
  );
}
