import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';


// The outer component only decides whether the dialog exists. Because the body mounts fresh
// every time it opens, its state initialises from the props naturally -- no "reset when
// opened" effect, which is what the previous version needed and the hooks linter flagged.
export default function PlaylistFormDialog(props) {
  if (!props.open) return null;
  return <PlaylistFormDialogBody {...props} />;
}

function Switch({ label, hint, on, disabled = false, onChange }) {
  return (
    <div className={`flex items-center justify-between gap-6 border-t border-[var(--room-hair)] py-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--room-paper)]">{label}</span>
        <span className="block text-[12px] text-[var(--room-faint)]">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="ui-word shrink-0" aria-pressed={on}>
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function PlaylistFormDialogBody({
  title,
  submitLabel,
  initialName = '',
  initialDescription = '',
  initialImageUrl = '',
  initialPublic = false,
  initialCollaborative = false,
  onSubmit,
  onCancel,
  isSubmitting = false
}) {
  const [name, setName] = useState(initialName || '');
  const [description, setDescription] = useState(initialDescription || '');
  // Spotify only allows collaboration on private playlists, so one switch rules the other
  const [isPublic, setIsPublic] = useState(Boolean(initialPublic) && !initialCollaborative);
  const [collaborative, setCollaborative] = useState(Boolean(initialCollaborative));
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(initialImageUrl || '');
  const canSubmit = Boolean(name.trim()) && !isSubmitting;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    if (canSubmit) onSubmit({ name: name.trim(), description: description.trim(), imageFile, imagePreview, isPublic: isPublic && !collaborative, collaborative });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div role="dialog" style={{ fontFamily: 'var(--font-room)' }} aria-modal="true" aria-labelledby="playlist-dialog-title" className="ui-plane flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col p-8">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="playlist-dialog-title" className="room-mono text-[var(--room-dim)]">{title}</h2>
            
          </div>
          <button type="button" onClick={onCancel} className="ui-word">Close</button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
          <div>
            <label htmlFor="playlist-name" className="room-mono mb-1 block text-[var(--room-faint)]">Playlist name</label>
            <input
              id="playlist-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              className="ui-field"
              placeholder="My new playlist"
            />
          </div>

          <div>
            <label htmlFor="playlist-description" className="room-mono mb-1 block text-[var(--room-faint)]">Description</label>
            <textarea
              id="playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="ui-field"
              placeholder="A playlist for late night listening..."
            />
          </div>

          <div>
            <Switch
              label="Public"
              hint={collaborative ? 'A collaborative playlist is always private' : isPublic ? 'Shows on your profile and in search' : 'Only people with the link can see it'}
              on={isPublic && !collaborative}
              disabled={collaborative}
              onChange={setIsPublic}
            />
            <Switch
              label="Collaborative"
              hint="Anyone with the link can add and remove songs"
              on={collaborative}
              onChange={(v) => { setCollaborative(v); if (v) setIsPublic(false); }}
            />
          </div>

          <div>
            <label className="room-mono mb-1 block text-[var(--room-faint)]">Cover image</label>
            <div className="grid grid-cols-1 gap-3">
              {imagePreview ? (
                <div className="relative h-40 w-40 overflow-hidden rounded-[4px] bg-white/5">
                  <img src={imagePreview} alt="Playlist cover preview" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="room-mono flex h-40 w-40 items-center justify-center rounded-[4px] bg-white/5 text-[var(--room-faint)]">
                  <span>No cover selected</span>
                </div>
              )}

              <label className="ui-word inline-block cursor-pointer">
              Choose a file
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    setImageFile(null);
                    setImagePreview(initialImageUrl || '');
                    return;
                  }

                  if (!file.type.startsWith('image/')) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setImagePreview(reader.result);
                  };
                  reader.readAsDataURL(file);
                  setImageFile(file);
                }}
              />
              </label>
              <p className="text-[12px] text-[var(--room-faint)]">Any image works; it's made square and sent to Spotify as a JPEG.</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-6 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="ui-word"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="ui-pill"
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
