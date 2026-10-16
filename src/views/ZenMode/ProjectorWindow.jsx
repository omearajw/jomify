import { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { startProjectorDisplay } from './projectorBridge';
import Projection from './Projection';

// The projector's own window (/projector). Drag it onto the projector's screen and press F (or
// double-click) for full screen. It only shows: walls and assets are edited in the projector
// editor in the main window, and every change arrives here live. With no main window open it
// says so instead of a black screen.

export default function ProjectorWindow() {
  const connected = usePlayerStore((s) => Boolean(s.playbackState));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    startProjectorDisplay();
    document.title = 'Jomify projector';
    const t = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(t);
  }, []);
  // closing leaves the window; full screen is left with Escape, as anywhere
  const close = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); window.close(); };
  return (
    <>
      <Projection onClose={close} detached />
      {!connected && waited && (
        <p className="fixed bottom-6 left-1/2 z-[9600] -translate-x-1/2 rounded-[4px] px-3 py-2 text-[12.5px] text-[var(--room-paper)]" style={{ background: 'var(--room-solid)', boxShadow: '0 0 0 1px var(--room-hair)', fontFamily: 'var(--font-room)' }}>
          Waiting for Jomify: keep it open in another window to see what is playing.
        </p>
      )}
    </>
  );
}
