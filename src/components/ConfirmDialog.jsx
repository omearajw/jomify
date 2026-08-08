import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="text-sm text-neutral-400 mt-1">{message}</p>
          </div>
          <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-white transition-colors p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-3 p-6">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-white/10 px-4 py-3 text-sm font-semibold text-neutral-300 hover:bg-white/5 transition-colors">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className="flex-1 rounded-full bg-red-500 px-4 py-3 text-sm font-semibold text-white hover:bg-red-400 transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
