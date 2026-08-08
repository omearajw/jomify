import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function PlaylistFormDialog({
  open,
  title,
  submitLabel,
  initialName = '',
  initialDescription = '',
  initialImageUrl = '',
  onSubmit,
  onCancel,
  isSubmitting = false
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(initialImageUrl);

  useEffect(() => {
    if (open) {
      setName(initialName || '');
      setDescription(initialDescription || '');
      setImageFile(null);
      setImagePreview(initialImageUrl || '');
    }
  }, [open, initialName, initialDescription, initialImageUrl]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm text-neutral-400 mt-1">Use this form to create or edit your playlist.</p>
          </div>
          <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-white transition-colors p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">Playlist name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl bg-neutral-900 border border-white/10 px-4 py-3 text-white placeholder:text-neutral-500 focus:border-green-500 outline-none focus:ring-2 focus:ring-green-500/20"
              placeholder="My new playlist"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-2xl bg-neutral-900 border border-white/10 px-4 py-3 text-white placeholder:text-neutral-500 focus:border-green-500 outline-none focus:ring-2 focus:ring-green-500/20"
              placeholder="A playlist for late night listening..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">Cover image</label>
            <div className="grid grid-cols-1 gap-3">
              {imagePreview ? (
                <div className="relative w-full h-48 rounded-3xl overflow-hidden bg-neutral-900 border border-white/10">
                  <img src={imagePreview} alt="Playlist cover preview" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full h-48 rounded-3xl border border-dashed border-white/10 bg-neutral-950 flex items-center justify-center text-neutral-500">
                  <span>No cover selected</span>
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                className="text-sm text-neutral-300 file:text-sm file:rounded-full file:border-0 file:bg-green-500 file:px-4 file:py-2 file:text-black"
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
              <p className="text-xs text-neutral-500">Choose a JPEG or PNG image to set as the playlist cover.</p>
            </div>
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
              onClick={() => onSubmit({ name: name.trim(), description: description.trim(), imageFile, imagePreview })}
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
