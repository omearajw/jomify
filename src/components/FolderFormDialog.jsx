import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// The outer component only decides whether the dialog exists. Because the body mounts fresh
// every time it opens, its state initialises from the props naturally -- no "reset when
// opened" effect, which is what the previous version needed and the hooks linter flagged.
export default function FolderFormDialog(props) {
  if (!props.open) return null;
  return <FolderFormDialogBody {...props} />;
}

function FolderFormDialogBody({ title, submitLabel, initialName = '', onSubmit, onCancel, isSubmitting = false }) {
  const [name, setName] = useState(initialName || '');
  const canSubmit = Boolean(name.trim()) && !isSubmitting;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => { if (canSubmit) onSubmit({ name: name.trim() }); };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" className="w-full max-w-md rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 id="folder-dialog-title" className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm text-neutral-400 mt-1">Enter a name to create a new folder.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="folder-name" className="block text-sm font-semibold text-neutral-300 mb-2">Folder name</label>
            <input
              id="folder-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              className="w-full rounded-2xl bg-neutral-900 border border-white/10 px-4 py-3 text-white placeholder:text-neutral-500 focus:border-[#f91362] outline-none focus:ring-2 focus:ring-[#f91362]/20"
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
              disabled={!canSubmit}
              onClick={submit}
              className="rounded-full bg-brand-gradient text-white px-5 py-2 text-sm font-semibold transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
