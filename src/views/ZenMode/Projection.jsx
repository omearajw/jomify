import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useProjectorStore, activeLayout } from './projectorStore';
import { ProjectionCanvas } from './projectorCanvas';
import ProjectionEditLayer from './ProjectionEditLayer';
import { sendEdit, sendPick } from './projectorBridge';

// What the projector shows: the picture, full screen. Walls and assets are edited in the projector
// editor on the laptop (ProjectorStudio.jsx) while this shows the result live, with outlines and
// corners drawn on the wall; and, in the projector's own window, on the picture itself too: while
// that editor is open a drag here follows its step and selection, and with it closed E edits here
// alone (W walls, A assets). Edits made here go to the main window, which keeps the layouts.
// Shown either in the projector's own window, or in place of Zen on a one-screen setup, where
// E brings the editor up over it.

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export default function Projection({ onClose, detached = false }) {
  const track = usePlayerStore((s) => s.playbackState?.track_window?.current_track || null);
  const layouts = useProjectorStore((s) => s.layouts);
  const guides = useProjectorStore((s) => s.guides);
  const studioOpen = useProjectorStore((s) => s.studioOpen);
  const setStudioOpen = useProjectorStore((s) => s.setStudioOpen);
  const setLayouts = useProjectorStore((s) => s.setLayouts);
  const setGuides = useProjectorStore((s) => s.setGuides);
  // editing on this window with no editor open on the laptop
  const [localEdit, setLocalEdit] = useState(false);
  const [localSel, setLocalSel] = useState({ mode: 'walls', wallId: null, corner: null, itemId: null });
  const { w, h } = useViewport();
  const layout = activeLayout(layouts);

  // The cursor hides; a movement brings it back with a line on how to leave, for a moment, so a
  // black screen is never a trap
  const [stirred, setStirred] = useState(false);
  const stirTimer = useRef(null);
  const stir = () => { setStirred(true); clearTimeout(stirTimer.current); stirTimer.current = setTimeout(() => setStirred(false), 2500); };
  useEffect(() => () => clearTimeout(stirTimer.current), []);

  // In full screen the browser's own Escape would leave full screen before this saw the key.
  // Chrome lets a full-screen page keep it; elsewhere Escape works as the browser intends.
  useEffect(() => {
    const kb = navigator.keyboard;
    if (!kb?.lock) return undefined;
    kb.lock(['Escape']).catch(() => {});
    return () => { kb.unlock?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (useProjectorStore.getState().studioOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { if (localEdit) setLocalEdit(false); else onClose(); return; }
      if (detached && localEdit && (e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 'a')) { setLocalSel((x) => ({ ...x, mode: e.key.toLowerCase() === 'w' ? 'walls' : 'assets', corner: null, itemId: null })); return; }
      if (detached && e.key.toLowerCase() === 'e') { setLocalEdit((v) => !v); return; }
      if (!detached && e.key.toLowerCase() === 'e') setStudioOpen(true);
      if (detached && e.key.toLowerCase() === 'f') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen().catch(() => {}); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detached, onClose, setStudioOpen, localEdit]);

  // with the laptop's editor open its step and selection lead; without it, this window's own
  const remote = Boolean(guides?.on);
  const editing = detached && (remote || localEdit);
  const sel = remote ? { mode: guides.mode || 'walls', wallId: guides.wallId, corner: guides.corner, itemId: guides.itemId } : localSel;
  const shownGuides = remote ? guides : localEdit ? { on: true, grid: false, ...localSel } : guides;
  const change = (next) => {
    const all = { ...layouts, layouts: layouts.layouts.map((l) => (l.id === layout.id ? next : l)) };
    setLayouts(all);
    sendEdit(all);
  };
  const pick = (p) => {
    if (remote) { setGuides(p); sendPick(p); } else setLocalSel(p);
  };

  const hint = detached
    ? (editing ? 'Drag corners and assets here or on the laptop · W walls, A assets · E or Escape stops editing' : 'E to edit here, or edit from Jomify on your laptop · F full screen · Escape closes this window')
    : 'E to edit · Escape or P to leave the projector';

  return (
    <div className={`fixed inset-0 z-[9500] select-none overflow-hidden bg-black ${stirred || editing ? '' : 'cursor-none'}`} onPointerMove={stir} onDoubleClick={() => { if (detached && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); }}>
      <ProjectionCanvas layout={layout} track={track} w={w} h={h} guides={shownGuides} editing={editing || guides?.on || studioOpen} />
      {editing && <ProjectionEditLayer layout={layout} w={w} h={h} mode={sel.mode} selection={sel} onChange={change} onPick={pick} />}
      {stirred && !studioOpen && (
        <p className="pointer-events-none fixed bottom-6 left-1/2 z-[9600] -translate-x-1/2 rounded-[4px] px-3 py-2 text-[12.5px] text-[var(--room-paper)]" style={{ background: 'var(--room-solid)', boxShadow: '0 0 0 1px var(--room-hair)', fontFamily: 'var(--font-room)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
