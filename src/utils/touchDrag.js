// Touch versions of every drag (the phone room, batch 4). Each drag in the room is the browser's
// own drag-and-drop (draggable, dataTransfer, dragover/drop), which a phone never starts from a
// finger. Rather than give every source and target a second, touch-only implementation, this
// turns a long-press-and-move on any [draggable="true"] element into the same sequence of drag
// events, so each drop target's own rules (where a slot lands, what a tile accepts) stay in one
// place and the Mac and the phone can't drift apart.
//
// The gesture, as on iOS: a finger that moves before the hold is a scroll and nothing happens.
// Held still for HOLD_MS, the row lifts (a copy follows the finger, the row dims, a buzz where
// the phone can). Moved after the lift, it drags; let go without moving, it opens the row's menu
// instead (the long-press menu that used to fire at the half-second, see longPressContextMenu).
// Near the top or bottom of the list being dragged over, the list scrolls, so a song can travel
// up from the pool into a batch that has scrolled away.

const SEEN = Symbol('touchDrag');
const HOLD_MS = 380;
const MOVE_TOLERANCE_PX = 10;
const EDGE_PX = 36;          // how close to a list's edge starts it scrolling
const EDGE_DWELL_MS = 400;   // and for how long first: a target near the edge must stay reachable
const MAX_SCROLL_PX = 12;    // per frame, at the very edge

// A stand-in for the browser's DataTransfer. A real one can't be relied on: WebKit refuses to
// put one in a constructed drag event on some versions, and its data is unreadable during
// dragover. The drop targets only use these members.
function makeTransfer() {
  const data = new Map();
  return {
    dropEffect: 'none',
    effectAllowed: 'all',
    files: [],
    items: [],
    get types() { return [...data.keys()]; },
    setData(type, value) { data.set(type, String(value)); },
    getData(type) { return data.get(type) ?? ''; },
    clearData(type) { if (type) data.delete(type); else data.clear(); },
    setDragImage() {}
  };
}

// A plain Event with the drag members put on it: React builds its drag events from these, and
// the targets read clientX/clientY to place a drop above or below a row
function fire(target, type, transfer, x, y) {
  const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperties(e, {
    dataTransfer: { value: transfer },
    clientX: { value: x }, clientY: { value: y },
    pageX: { value: x + window.scrollX }, pageY: { value: y + window.scrollY },
    screenX: { value: x }, screenY: { value: y },
    button: { value: 0 }, buttons: { value: 1 }
  });
  target.dispatchEvent(e);
  return e;
}

function scrollerAt(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;
    }
  }
  return null;
}

export function installTouchDrag() {
  if (typeof document === 'undefined' || !('ontouchstart' in window)) return () => {};
  let press = null;   // { source, x, y, timer, lifted, touchId }
  let drag = null;    // { source, transfer, ghost, dx, dy, over, accepted, x, y, scroller, raf }

  const swallowNextClick = () => {
    const onClick = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', onClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', onClick, { capture: true }), 400);
  };

  const lift = () => {
    const { source } = press;
    press.lifted = true;
    if (navigator.vibrate) navigator.vibrate(8);
    source.classList.add('is-lifting');
  };

  const startDrag = (x, y) => {
    const { source } = press;
    source.classList.remove('is-lifting');
    const transfer = makeTransfer();
    const started = fire(source, 'dragstart', transfer, x, y);
    if (started.defaultPrevented) { press = null; return; }
    const r = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('touch-drag-ghost');
    Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: '0px', top: '0px', transform: `translate3d(${r.left}px, ${r.top}px, 0)` });
    document.body.appendChild(ghost);
    source.classList.add('is-dragged');
    drag = { source, transfer, ghost, dx: x - r.left, dy: y - r.top, over: null, accepted: false, x, y, scroller: null, raf: 0, edgeSince: 0 };
    press = null;
    move(x, y);
    tick();
  };

  // what is under the finger, and whether it takes the drop
  const move = (x, y) => {
    drag.x = x; drag.y = y;
    drag.ghost.style.transform = `translate3d(${x - drag.dx}px, ${y - drag.dy}px, 0)`;
    const under = document.elementFromPoint(x, y);
    if (under !== drag.over) {
      if (drag.over) fire(drag.over, 'dragleave', drag.transfer, x, y);
      if (under) fire(under, 'dragenter', drag.transfer, x, y);
      drag.over = under;
    }
    drag.accepted = under ? fire(under, 'dragover', drag.transfer, x, y).defaultPrevented : false;
    drag.ghost.classList.toggle('is-refused', !drag.accepted);
    drag.scroller = under ? scrollerAt(under) : null;
  };

  // the list under the finger scrolls while the finger rests near its edge
  const tick = () => {
    if (!drag) return;
    const s = drag.scroller;
    if (s) {
      const r = s.getBoundingClientRect();
      const up = drag.y - r.top, down = r.bottom - drag.y;
      const by = up < EDGE_PX ? -Math.ceil(MAX_SCROLL_PX * (1 - up / EDGE_PX)) : down < EDGE_PX ? Math.ceil(MAX_SCROLL_PX * (1 - down / EDGE_PX)) : 0;
      const now = performance.now();
      if (!by) drag.edgeSince = 0;
      else if (!drag.edgeSince) drag.edgeSince = now;
      else if (now - drag.edgeSince > EDGE_DWELL_MS) { s.scrollTop += by; move(drag.x, drag.y); }
    }
    drag.raf = requestAnimationFrame(tick);
  };

  const finish = (dropIt) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    if (dropIt && d.accepted && d.over) fire(d.over, 'drop', d.transfer, d.x, d.y);
    else if (d.over) fire(d.over, 'dragleave', d.transfer, d.x, d.y);
    d.transfer.dropEffect = dropIt && d.accepted ? d.transfer.dropEffect : 'none';
    fire(d.source, 'dragend', d.transfer, d.x, d.y);
    d.source.classList.remove('is-dragged');
    d.ghost.remove();
    swallowNextClick();
  };

  const cancelPress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    press.source.classList.remove('is-lifting');
    press = null;
  };
  // Two sets of listeners. The document's touchmove is non-passive and always there: iOS only
  // lets a move stop the scroll if a non-passive listener covered that spot when the touch began
  // (one added during touchstart worked for some rows and not others, 15 Oct), and it only waits
  // for this handler on a touch's first move, which returns at once unless a row is held. The
  // pressed row also gets its own for the length of the touch: touch events keep targeting where
  // the touch began, so if React takes the row out of the page mid-drag, nothing reaches the
  // document any more and the drag would never finish. Each event is handled once.
  let held = null;
  const hold = (el) => {
    release();
    held = el;
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
  };
  const release = () => {
    held?.removeEventListener('touchmove', onTouchMove, { passive: false });
    held?.removeEventListener('touchend', onTouchEnd, { passive: false });
    held?.removeEventListener('touchcancel', onTouchEnd, { passive: false });
    held = null;
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { cancelPress(); finish(false); return; }
    const t = e.touches[0];
    const source = e.target instanceof Element ? e.target.closest('[draggable="true"]') : null;
    if (!source || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    press = { source, x: t.clientX, y: t.clientY, touchId: t.identifier, lifted: false, timer: setTimeout(() => { if (press) lift(); }, HOLD_MS) };
    hold(e.target);
  };

  function onTouchMove(e) {
    if (!press && !drag) return;
    if (e[SEEN]) return;
    e[SEEN] = true;
    const t = [...e.changedTouches].find((c) => c.identifier === (press?.touchId ?? c.identifier)) || e.changedTouches[0];
    if (drag) { e.preventDefault(); move(t.clientX, t.clientY); return; }
    const far = Math.abs(t.clientX - press.x) > MOVE_TOLERANCE_PX || Math.abs(t.clientY - press.y) > MOVE_TOLERANCE_PX;
    if (!press.lifted) { if (far) cancelPress(); return; }
    e.preventDefault();
    if (far) startDrag(t.clientX, t.clientY);
  }

  function onTouchEnd(e) {
    if (e[SEEN]) return;
    e[SEEN] = true;
    release();
    if (drag) { e.preventDefault(); finish(e.type === 'touchend'); return; }
    if (!press) return;
    const { lifted, source, x, y } = press;
    cancelPress();
    // held and let go without moving: the row's menu, as the long-press used to give
    if (lifted && e.type === 'touchend' && source.isConnected) {
      e.preventDefault();
      source.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
      swallowNextClick();
    }
  }

  // the browser's own long-press menu or drag must not start over a row being held
  const onNativeContextMenu = (e) => { if (e.isTrusted && (press || drag)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const onNativeDragStart = (e) => { if (e.isTrusted && (press || drag)) e.preventDefault(); };

  const opts = { capture: true, passive: false };
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, opts);
  document.addEventListener('touchend', onTouchEnd, opts);
  document.addEventListener('touchcancel', onTouchEnd, opts);
  document.addEventListener('contextmenu', onNativeContextMenu, true);
  document.addEventListener('dragstart', onNativeDragStart, true);
  return () => {
    cancelPress(); finish(false); release();
    document.removeEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.removeEventListener('touchmove', onTouchMove, opts);
    document.removeEventListener('touchend', onTouchEnd, opts);
    document.removeEventListener('touchcancel', onTouchEnd, opts);
    document.removeEventListener('contextmenu', onNativeContextMenu, true);
    document.removeEventListener('dragstart', onNativeDragStart, true);
  };
}
