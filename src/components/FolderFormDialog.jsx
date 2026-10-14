import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// The outer component only decides whether the dialog exists. Because the body mounts fresh
// every time it opens, its state initialises from the props naturally -- no "reset when
// opened" effect, which is what the previous version needed and the hooks linter flagged.
export default function FolderFormDialog(props) {
  if (!props.open) return null;
  return <FolderFormDialogBody {...props} />;
}

function FolderFormDialogBody({ title, submitLabel, initialName = '', parentLabel = '', onSubmit, onCancel, isSubmitting = false }) {
  const [name, setName] = useState(initialName || '');
  const canSubmit = Boolean(name.trim()) && !isSubmitting;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => { if (canSubmit) onSubmit({ name: name.trim() }); };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" className="ui-plane w-full max-w-md p-8">
        <div className="mb-5 flex items-start justify-between">
          <h2 id="folder-dialog-title" className="room-mono text-[var(--room-dim)]">{title}</h2>
          <button type="button" onClick={onCancel} className="ui-word">Close</button>
        </div>
        <label htmlFor="folder-name" className="room-mono mb-1 block text-[var(--room-faint)]">{parentLabel ? `Folder name · inside ${parentLabel}` : 'Folder name'}</label>
        <input
          id="folder-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          className="ui-field"
          placeholder="Road trips"
        />
        <div className="mt-7 flex items-center justify-end gap-6">
          <button type="button" onClick={onCancel} className="ui-word">Cancel</button>
          <button type="button" disabled={!canSubmit} onClick={submit} className="ui-pill">{isSubmitting ? 'Saving…' : submitLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
