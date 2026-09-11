// Turns a long-press into a synthetic `contextmenu` event on touch screens, so the seventeen
// existing right-click handlers work on a phone without being touched. Android Chrome already
// does this natively; iOS Safari does not, and the native one is cancelled here so a page never
// gets two menus. Coordinates are client-relative, which is what pageX/pageY derive from.

const HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export function installLongPressContextMenu() {
  if (typeof document === 'undefined') return () => {};

  let timer = null;
  let start = null;
  let fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    start = null;
  };

  const swallowNextClick = () => {
    const onClick = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', onClick, { capture: true, once: true });
    // If no click follows (the finger moved off the element), don't trap the next real one
    setTimeout(() => document.removeEventListener('click', onClick, { capture: true }), 400);
  };

  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY, target: e.target };
    timer = setTimeout(() => {
      timer = null;
      const { x, y, target } = start || {};
      start = null;
      if (!target?.isConnected) return;
      fired = true;
      if (navigator.vibrate) navigator.vibrate(10);
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
      swallowNextClick();
    }, HOLD_MS);
  };

  const onPointerMove = (e) => {
    if (!start) return;
    if (Math.abs(e.clientX - start.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
  };

  // A native long-press menu (Android) arrives as its own contextmenu event: let it through
  // and drop ours so nothing fires twice
  const onNativeContextMenu = (e) => {
    if (fired) { fired = false; return; }
    if (timer) cancel();
    if (e.pointerType === 'touch' || (start === null && e.button === 0)) return;
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('contextmenu', onNativeContextMenu, true);

  return () => {
    cancel();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', cancel, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('contextmenu', onNativeContextMenu, true);
  };
}
