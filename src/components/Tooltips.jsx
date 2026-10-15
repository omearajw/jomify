import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One tooltip for the whole app, on the room's language: a small solid plane with the control's
// name, after the pointer has rested on it for a moment. It reads what is already there, so no
// control has to opt in: an icon-only button's aria-label (a button with words on it needs no
// name), or a `title` (whose native tooltip it replaces), or `data-tip` for a hint written for it.
// Touch has no hover, so it shows only for a mouse or a pen; a press, a scroll or a key hides it.

const DELAY_MS = 550;
const GAP = 8;

function tipOf(el) {
  if (el.dataset.tip) return el.dataset.tip;
  if (el.dataset.tipTitle) return el.dataset.tipTitle;
  const label = el.getAttribute('aria-label');
  if (label && !el.textContent.trim()) return label;
  return null;
}

function targetOf(node) {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.dataset.tip || el.hasAttribute('title') || el.dataset.tipTitle) return el;
    if (el.matches('button, a, [role="button"], [role="slider"], input[type="range"]') && el.getAttribute('aria-label') && !el.textContent.trim()) return el;
  }
  return null;
}

export default function Tooltips() {
  const [tip, setTip] = useState(null); // { text, x, y, below }
  const timer = useRef(null);
  const current = useRef(null);

  useEffect(() => {
    // the native tooltip would show as well: its text moves to data-tip-title while hovered
    const borrowTitle = (el) => {
      const t = el.getAttribute('title');
      if (t) { el.dataset.tipTitle = t; el.removeAttribute('title'); }
    };
    const giveTitleBack = (el) => {
      if (el?.dataset?.tipTitle) { el.setAttribute('title', el.dataset.tipTitle); delete el.dataset.tipTitle; }
    };
    const hide = () => {
      clearTimeout(timer.current);
      giveTitleBack(current.current);
      current.current = null;
      setTip(null);
    };
    const onOver = (e) => {
      if (e.pointerType && e.pointerType === 'touch') return;
      const el = targetOf(e.target);
      if (el === current.current) return;
      hide();
      if (!el) return;
      borrowTitle(el);
      const text = tipOf(el);
      if (!text) return;
      current.current = el;
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below });
      }, DELAY_MS);
    };
    const onOut = (e) => {
      if (!current.current) return;
      if (e.relatedTarget && current.current.contains(e.relatedTarget)) return;
      hide();
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  // kept on screen: centred on the control, clamped to the window's edges
  const half = Math.min(140, tip.text.length * 3.6 + 12);
  const x = Math.max(half + 8, Math.min(window.innerWidth - half - 8, tip.x));
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-[280px] rounded-[4px] px-2.5 py-1.5 text-[11.5px] leading-[1.35] text-[var(--room-paper)]"
      style={{
        left: x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
        background: 'var(--room-solid)', boxShadow: '0 0 0 1px var(--room-hair), 0 8px 24px rgba(0,0,0,0.45)',
        fontFamily: 'var(--font-room)', animation: 'room-fade-in 160ms ease-out both'
      }}
    >
      {tip.text}
    </div>,
    document.body
  );
}
