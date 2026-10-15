// Scrollbars that show only while you scroll or while the mouse is over the scrolling area, as
// macOS overlay scrollbars do, instead of a bar always drawn beside every list. The thumb is
// transparent by default (index.css); these classes show it. Both are classes rather than CSS
// :hover because Chromium does not repaint a custom scrollbar when its element's :hover changes
// (checked 15 Oct: :hover matched, the thumb stayed hidden), while a class change does repaint.
//
// Safari (WebKit) is stricter: it styles the thumb once, when the scrollbar is built, and ignores
// every later change, class or :hover, even across a scroll (checked 15 Oct in Playwright's
// WebKit). It rebuilds the scrollbar when overflow goes off and on again, so it gets that kick.
// Never mid-scroll, because the reflow can stop a trackpad's momentum: only when the pointer
// enters or leaves a list, and once a scroll has settled. So in Safari a scroll does not brighten
// the bar; the bar shows because the pointer is over the list, which it is whenever you scroll it
// with a mouse or trackpad.
const SHOW_MS = 900;
const timers = new WeakMap();
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const STICKY_STYLE = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);

function scrollerOf(node) {
  for (let el = node instanceof Element ? node : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return el;
    }
  }
  return null;
}

function rebuild(el) {
  if (!STICKY_STYLE || !el?.isConnected || el.classList.contains('is-scrolling')) return;
  const { scrollTop, scrollLeft } = el;
  const was = el.style.overflow;
  el.style.overflow = 'hidden';
  void el.offsetWidth;
  el.style.overflow = was;
  el.scrollTop = scrollTop;
  el.scrollLeft = scrollLeft;
}

export function installScrollbarReveal() {
  if (typeof window === 'undefined') return;
  window.addEventListener('scroll', (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!(el instanceof Element)) return;
    el.classList.add('is-scrolling');
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => { el.classList.remove('is-scrolling'); rebuild(el); }, SHOW_MS));
  }, { capture: true, passive: true });

  let pointed = null;
  let pending = null;
  const point = (el) => {
    if (el === pointed) return;
    const was = pointed;
    was?.classList.remove('is-pointed');
    pointed = el;
    pointed?.classList.add('is-pointed');
    rebuild(was);
    rebuild(pointed);
  };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (pending) { pending.target = e.target; return; }
    pending = { target: e.target };
    requestAnimationFrame(() => { const t = pending.target; pending = null; point(scrollerOf(t)); });
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => point(null));
}
