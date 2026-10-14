import { useEffect, useRef, useState } from 'react';

// The launcher: Library · Search · Sevens · Unadded · Party, living at the left edge and shown
// only when reached for (DESIGN.md §5). The reveal must not be finicky: it opens on a deliberate
// reach (the pointer held near the edge, or a drag of real distance from it), never on a pointer
// passing through; it closes on a click elsewhere or on the pointer leaving the rail for a
// while, never because it drifted off a pixel. The rail never moves the room.

const EDGE_PX = 48;        // how close to the edge counts as reaching; nothing lives there to open by accident
const HOLD_MS = 220;       // how long the pointer must stay there
const LEAVE_MS = 900;      // how long after the pointer leaves the rail before it goes
const DRAG_PX = 36;        // a touch drag from the edge this far opens it

const RAIL_ITEMS = [
  { id: 'library', label: 'Library' },
  { id: 'browse', label: 'Search' },
  { id: 'sevens', label: 'Sevens' },
  { id: 'unadded', label: 'Unadded' },
  { id: 'party', label: 'Party' },
  { id: 'account', label: 'Settings' }
];

export default function Rail({ open, held = false, active, onPick, onOpen }) {
  const [reached, setReached] = useState(false);
  const holdTimer = useRef(null);
  const leaveTimer = useRef(null);
  const railRef = useRef(null);
  const shown = open || held || reached;

  useEffect(() => {
    const clearHold = () => { clearTimeout(holdTimer.current); holdTimer.current = null; };
    const clearLeave = () => { clearTimeout(leaveTimer.current); leaveTimer.current = null; };
    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      const nearEdge = e.clientX <= EDGE_PX;
      const overRail = Boolean(e.target instanceof Node && railRef.current?.contains(e.target));
      if (nearEdge && !reached && !holdTimer.current) holdTimer.current = setTimeout(() => { holdTimer.current = null; setReached(true); }, HOLD_MS);
      if (!nearEdge) clearHold();
      if (reached && !overRail && !nearEdge && !leaveTimer.current) leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setReached(false); }, LEAVE_MS);
      if (reached && (overRail || nearEdge)) clearLeave();
    };
    // a touch drag from the edge: the rail opens once the finger has travelled far enough
    let touchStart = null;
    const onDown = (e) => { if (e.pointerType === 'touch' && e.clientX <= EDGE_PX + 6) touchStart = e.clientX; };
    const onUp = (e) => {
      if (touchStart !== null && e.clientX - touchStart >= DRAG_PX) setReached(true);
      touchStart = null;
      // a click or tap anywhere off the rail puts it away
      if (reached && railRef.current && !(e.target instanceof Node && railRef.current.contains(e.target)) && e.pointerType !== 'touch') setReached(false);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      clearHold(); clearLeave();
    };
  }, [reached]);

  return (
    <>
      {/* the edge: a hair of light down the left, faint at rest, brighter under the pointer. One
          click opens the layer where it last was; no hold, no timer. The hover-hold reveal of the
          rail is for picking a mode without opening the layer, and nothing depends on it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open the library"
        className="group absolute left-0 top-0 bottom-0 z-20 w-[48px] cursor-pointer transition-opacity"
        style={{ opacity: shown ? 0 : 1, pointerEvents: shown ? 'none' : 'auto', transitionDuration: 'var(--room-mid)' }}
      >
        <span aria-hidden="true" className="absolute left-0 top-[40%] h-[20%] w-[2px] rounded-r-[2px] bg-white/18 transition-all group-hover:top-[30%] group-hover:h-[40%] group-hover:bg-white/45" style={{ transitionDuration: 'var(--room-mid)' }} />
      </button>
      <nav
        ref={railRef}
        aria-label="Jomify"
        className="absolute left-0 top-0 bottom-0 z-30 flex w-[58px] flex-col items-center justify-center gap-7"
        style={{ transform: shown ? 'none' : 'translateX(-100%)', transition: `transform var(--room-mid) var(--room-ease)`, fontFamily: 'var(--font-mono)' }}
      >
        {RAIL_ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => { if (it.soon) return; onPick(it.id); setReached(false); }}
            aria-current={active === it.id ? 'page' : undefined}
            aria-disabled={it.soon || undefined}
            title={it.soon ? 'Not built yet' : undefined}
            className={`room-mono py-1 transition-colors ${active === it.id ? 'text-[var(--room-paper)]' : it.soon ? 'text-[var(--room-faint)] cursor-default' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', transitionDuration: 'var(--room-mid)' }}
          >
            {it.label}
          </button>
        ))}
      </nav>
    </>
  );
}
