import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// `children` go between the message and the buttons, for a dialog that has something to show
// (what a bulk change will do). `tone` 'neutral' keeps the confirm button white for changes
// that aren't destructive.
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, children, tone = 'danger' }) {
  // Escape cancels. Every dialog in the app is destructive-or-important, so the keyboard way
  // out is the safe one.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="ui-plane w-full max-w-md p-7">
        <h2 id="confirm-dialog-title" className="text-[18px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {message && <p className="mt-2 text-[13px] text-[var(--room-dim)]">{message}</p>}
        {children && <div className="custom-scrollbar mt-5 max-h-[50vh] overflow-y-auto border-t border-[var(--room-hair)] pt-4">{children}</div>}
        <div className="mt-7 flex items-center justify-end gap-6">
          {/* Cancel takes focus by default: Enter on a destructive dialog should not destroy */}
          <button type="button" autoFocus onClick={onCancel} className="ui-word">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={`ui-pill ${tone === 'danger' ? 'ui-pill-danger' : ''}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
