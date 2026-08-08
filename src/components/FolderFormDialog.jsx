import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function FolderFormDialog({ open, title, submitLabel, initialName = '', onSubmit, onCancel, isSubmitting = false }) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) {
      setName(initialName || '');
    }
  }, [open, initialName]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm text-neutral-400 mt-1">Enter a name to create a new folder.</p>
          </div>
          <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-white transition-colors p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">Folder name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl bg-neutral-900 border border-white/10 px-4 py-3 text-white placeholder:text-neutral-500 focus:border-green-500 outline-none focus:ring-2 focus:ring-green-500/20"
              placeholder="My favorite playlists"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-neutral-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || isSubmitting}
              onClick={() => onSubmit({ name: name.trim() })}
              className="rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-black transition-all disabled:cursor-not-allowed disabled:opacity-50 hover:bg-green-400"
            >
              {isSubmitting ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
