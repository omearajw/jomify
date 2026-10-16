import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useProjectorStore, activeLayout } from './projectorStore';
import { ProjectionCanvas } from './projectorCanvas';

// What the projector shows: the picture alone, full screen, nothing on it to grab. Walls and
// assets are edited in the projector editor on the laptop (ProjectorStudio.jsx) while this shows
// the result live, with outlines and corners drawn on the wall while that editor wants them.
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
      if (e.key === 'Escape') { onClose(); return; }
      if (!detached && e.key.toLowerCase() === 'e') setStudioOpen(true);
      if (detached && e.key.toLowerCase() === 'f') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen().catch(() => {}); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detached, onClose, setStudioOpen]);

  const hint = detached
    ? 'Edit the walls from Jomify on your laptop · F full screen · Escape closes this window'
    : 'E to edit · Escape or P to leave the projector';

  return (
    <div className={`fixed inset-0 z-[9500] select-none overflow-hidden bg-black ${stirred ? '' : 'cursor-none'}`} onPointerMove={stir} onDoubleClick={() => { if (detached && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); }}>
      <ProjectionCanvas layout={layout} track={track} w={w} h={h} guides={guides} editing={guides?.on || studioOpen} />
      {stirred && !studioOpen && (
        <p className="pointer-events-none fixed bottom-6 left-1/2 z-[9600] -translate-x-1/2 rounded-[4px] px-3 py-2 text-[12.5px] text-[var(--room-paper)]" style={{ background: 'var(--room-solid)', boxShadow: '0 0 0 1px var(--room-hair)', fontFamily: 'var(--font-room)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
