import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';

// The phone's layer (DESIGN.md §5): a sheet from the bottom whose head is always showing, the
// handle and the launcher (Library · Search · Sevens · Unadded · Party). Three stops, as on the
// Mac: closed (the head alone), half (the list), full (the open thing). The gesture rule: a drag
// that starts on the head moves the sheet, following the finger and settling on the nearest stop
// or, flicked, the next one in that direction; a drag inside the sheet only scrolls it; nothing
// lives at the top edge, which is the notification shade's.

const LAUNCHER = [
  { id: 'library', label: 'Library' },
  { id: 'browse', label: 'Search' },
  { id: 'sevens', label: 'Sevens' },
  { id: 'unadded', label: 'Unadded' },
  { id: 'party', label: 'Party' }
];
const DRAG_START_PX = 8;
const FLICK = 0.45; // px per ms

function useViewportHeight() {
  const read = () => (typeof window === 'undefined' ? 800 : Math.round(window.visualViewport?.height || window.innerHeight));
  const [h, setH] = useState(read);
  useEffect(() => {
    const on = () => setH(read());
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); };
  }, []);
  return h;
}

// env(safe-area-inset-*) as pixels, for the arithmetic of the stops
function readSafeInsets() {
  if (typeof document === 'undefined') return { top: 0, bottom: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return out;
}
// env(safe-area-inset-*) as pixels, for the arithmetic of the stops; read again on a rotation
function useSafeInsets() {
  const [insets, setInsets] = useState(readSafeInsets);
  useEffect(() => {
    const on = () => setInsets(readSafeInsets());
    window.addEventListener('orientationchange', on);
    return () => window.removeEventListener('orientationchange', on);
  }, []);
  return insets;
}

export default function PhoneSheet({ state, onState, lit, onPick, onSettings, head, children, onHeadHeight }) {
  const vh = useViewportHeight();
  const safe = useSafeInsets();
  const headRef = useRef(null);
  const [headH, setHeadH] = useState(72);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return undefined;
    const measure = () => setHeadH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const closedH = headH + safe.bottom;
  useEffect(() => { onHeadHeight?.(closedH); }, [closedH, onHeadHeight]);

  const fullH = vh - safe.top - 10;
  const stops = { closed: closedH, half: Math.round(vh * 0.58), full: fullH };
  const order = ['closed', 'half', 'full'];

  // a drag in progress: the visible height follows the finger
  const [dragH, setDragH] = useState(null);
  const drag = useRef(null);
  const swallowClick = useRef(false);
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { y0: e.clientY, h0: stops[state], moved: false, id: e.pointerId, t: performance.now(), y: e.clientY, v: 0 };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y0 - e.clientY;
    if (!d.moved && Math.abs(dy) < DRAG_START_PX) return;
    if (!d.moved) { d.moved = true; try { e.currentTarget.setPointerCapture(d.id); } catch { /* fine */ } }
    const now = performance.now();
    d.v = (d.y - e.clientY) / Math.max(1, now - d.t); // up is positive
    d.t = now; d.y = e.clientY;
    setDragH(Math.max(stops.closed, Math.min(stops.full, d.h0 + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 0);
    const h = dragH ?? stops[state];
    setDragH(null);
    const at = order.indexOf(state);
    let to;
    if (d.v > FLICK) to = order[Math.min(order.length - 1, order.findIndex((k) => stops[k] > h + 1) === -1 ? at : order.findIndex((k) => stops[k] > h + 1))];
    else if (d.v < -FLICK) { const below = order.filter((k) => stops[k] < h - 1); to = below.length ? below[below.length - 1] : 'closed'; }
    else to = order.reduce((best, k) => (Math.abs(stops[k] - h) < Math.abs(stops[best] - h) ? k : best), state);
    onState(to);
  };

  const visible = dragH ?? stops[state];
  const translate = fullH - visible;
  const contentH = Math.max(0, visible - headH - safe.bottom);

  return (
    <section
      aria-label="Library"
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col"
      style={{
        height: fullH,
        transform: `translateY(${translate}px)`,
        transition: dragH === null ? 'transform 420ms cubic-bezier(0.2, 0.75, 0.2, 1)' : 'none',
        background: 'var(--room-solid)',
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        boxShadow: '0 -1px 0 var(--room-hair), 0 -18px 40px rgba(0,0,0,0.35)',
        fontFamily: 'var(--font-room)', color: 'var(--room-paper)'
      }}
    >
      <div
        ref={headRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => { if (swallowClick.current) { e.stopPropagation(); e.preventDefault(); } }}
        className="shrink-0 touch-none select-none px-4 pb-1 pt-2"
      >
        <button type="button" onClick={() => onState(state === 'closed' ? 'half' : state === 'half' ? 'full' : 'half')} aria-label={state === 'full' ? 'Lower the sheet' : 'Raise the sheet'} className="mx-auto flex h-5 w-full items-center justify-center">
          <span className="h-[5px] w-10 rounded-full bg-white/25" />
        </button>
        <nav aria-label="Jomify" className="flex items-center justify-between">
          {LAUNCHER.map((it) => (
            <button key={it.id} type="button" onClick={() => onPick(it.id)} aria-current={lit === it.id && state !== 'closed' ? 'page' : undefined}
              className={`room-mono min-h-[44px] px-1 transition-colors ${lit === it.id && state !== 'closed' ? 'text-[var(--room-paper)]' : 'text-[var(--room-dim)]'}`}>
              {it.label}
            </button>
          ))}
          <button type="button" onClick={onSettings} aria-label="Settings" className="grid h-11 w-9 place-items-center text-[var(--room-dim)]"><Settings className="h-4 w-4" /></button>
        </nav>
      </div>
      {head}
      <div className="@container min-h-0 overflow-y-auto overscroll-y-contain px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2" style={{ height: contentH }}>
        {state !== 'closed' || dragH !== null ? children : null}
      </div>
    </section>
  );
}
