import { useEffect, useLayoutEffect, useRef } from 'react';
import { useRoomStore } from './roomStore';

// The layer: a plane of slightly lighter dark that slides in over the room from the left, past
// the rail, and can be pulled across to take everything but the strip (DESIGN.md §5). Its
// handle drags it; a short drag settles to the nearer of closed, half and full. What is inside
// is whatever the app is showing: the library, a playlist, search, a mode.

export const RAIL_PX = 58;
export const TREE_PX = 300; // the left column; the layer at half is this and nothing else
export const FULL = 0.76;   // of the window; leaves the strip
const STEP_PX = 80;         // the dead zone, either way: a drag this far steps; less just tugs the plane
const STEP_AGAIN_PX = 240;  // a second step in the same pull needs a long drag

// Where each page was scrolled to, by its key, so coming back lands where you were
const scrollMemory = new Map();

export default function Layer({ state, onState, children, header, tree, head, pageKey = '' }) {
  const ref = useRef(null);
  const light = useRoomStore((s) => s.light);
  const columnRef = useRef(null);
  const onColumnScroll = () => { if (columnRef.current) scrollMemory.set(pageKey, columnRef.current.scrollTop); };
  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return undefined;
    // after the page has drawn, so there is something to scroll to
    const id = requestAnimationFrame(() => { el.scrollTop = scrollMemory.get(pageKey) || 0; });
    return () => cancelAnimationFrame(id);
  }, [pageKey]);
  const drag = useRef(null);

  // the handle: a flick steps the layer, right for more, left for less; it does not resize.
  // The step happens the moment the pointer has travelled far enough, not on release, so the
  // plane swings while the finger is still moving; the drag re-anchors after a step, so one
  // long pull can go away → half → full. A double click toggles half and full.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const handle = el.querySelector('[data-handle]');
    if (!handle) return undefined;
    const onDown = (e) => { drag.current = { x0: e.clientX, need: STEP_PX }; handle.setPointerCapture(e.pointerId); };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.x0;
      const s = stateRef.current;
      // inside the dead zone the plane tugs with the finger, so the drag reads without doing
      // anything. The tug is `translate`, which the plane's transition list does not cover, so
      // it follows at once and the transition itself is never touched (clearing it once left the
      // plane with no transition at all).
      el.style.translate = `${Math.max(-32, Math.min(32, dx * 0.35))}px 0`;
      if (dx > d.need && s !== 'full') { onState(s === 'closed' ? 'half' : 'full'); d.x0 = e.clientX; d.need = STEP_AGAIN_PX; el.style.translate = ''; }
      else if (dx < -d.need && s !== 'closed') { onState(s === 'full' ? 'half' : 'closed'); d.x0 = e.clientX; d.need = STEP_AGAIN_PX; el.style.translate = ''; }
    };
    const onUp = () => { drag.current = null; el.style.translate = ''; };
    const onDbl = () => onState(state === 'full' ? 'half' : 'full');
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    handle.addEventListener('dblclick', onDbl);
    return () => {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.removeEventListener('dblclick', onDbl);
    };
  }, [state, onState]);

  const full = state === 'full';
  const width = full ? `calc(${FULL * 100}% - ${RAIL_PX}px)` : `${TREE_PX}px`;
  return (
    <section
      ref={ref}
      aria-label="Library"
      aria-hidden={state === 'closed' || undefined}
      className="room-plane absolute top-0 bottom-0 z-20 flex flex-col"
      style={{
        left: RAIL_PX,
        width,
        transform: state === 'closed' ? `translateX(calc(-100% - ${RAIL_PX}px))` : 'none',
        transition: `transform var(--room-slow) var(--room-settle), width var(--room-slow) var(--room-ease)`,
        fontFamily: 'var(--font-room)'
      }}
    >
      {/* the cover's light behind the open thing, from the plane's top: the open surface hands
          it over (roomStore), since inside the column it would be clipped at the column's top */}
      {light && full && (
        <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-[520px] overflow-hidden" style={{ left: TREE_PX, maskImage: 'linear-gradient(180deg, black 35%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, black 35%, transparent)' }}>
          <div className="absolute -inset-x-[25%] -top-[80px] bottom-0 opacity-[0.3]" style={{ backgroundImage: `url(${light})`, backgroundSize: '100% auto', backgroundPosition: 'center top', backgroundRepeat: 'no-repeat' }} />
        </div>
      )}
      {header}
      <div className="relative flex min-h-0 flex-1">
        <div className="h-full shrink-0 px-6 pb-6 pt-7" style={{ width: TREE_PX }}>{tree}</div>
        {/* the right column: what is open. It exists only at full; at half the tree is the layer. */}
        <div
          ref={columnRef}
          onScroll={onColumnScroll}
          aria-hidden={!full || undefined}
          className="@container min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] px-8 pb-8 pt-6"
          style={{ opacity: full ? 1 : 0, transition: 'opacity var(--room-mid) var(--room-ease)', pointerEvents: full ? 'auto' : 'none', borderLeft: '1px solid var(--room-hair)' }}
        >
          {/* the open thing's head: Back, in the corner of the thing it changes, naming where it
              goes; the line is always there so nothing below it ever shifts */}
          {full && (
            <div className="mb-3 flex h-5 items-center">
              {head?.back
                ? <button type="button" onClick={head.back.go} className="ui-word flex items-center gap-2 text-[var(--room-dim)] hover:text-[var(--room-paper)]"><span aria-hidden="true">←</span> {head.back.name}</button>
                : <span className="room-mono text-[var(--room-faint)]">{head?.here || ''}</span>}
            </div>
          )}
          {full && children}
        </div>
      </div>
      {/* the grab area: a 40px band on the plane's edge, mostly over the room so it never covers
          the column's scrollbar */}
      <div data-handle role="separator" aria-orientation="vertical" aria-label="Open the library wider or narrower" title="Flick right for more, left for less; double-click for full width" className="absolute -right-8 top-0 bottom-0 z-10 w-10 cursor-col-resize" />
    </section>
  );
}
