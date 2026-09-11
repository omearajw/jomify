import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Terminal, ChevronDown, ChevronRight, FolderInput } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { toast } from '../store/toastStore';
import { parseSpotifyFolders, planImport, ImportFormatError } from '../import/spotifyFolders';
import { storeToDoc } from '../sync/transform';
import { getMeta } from '../sync/meta';
import { MAX_DOC_CHARS } from '../sync/mergeSyncDoc';
import ConfirmDialog from './ConfirmDialog';

// Body mounts fresh on open so every field starts clean (same pattern as FolderFormDialog)
export default function ImportFoldersDialog(props) {
  if (!props.open) return null;
  return <ImportFoldersDialogBody {...props} />;
}

const CLI_STEPS = `1. Quit Spotify so its cache is fully written.
2. Install once (Mac/Linux):
     curl -L https://git.io/folders > /usr/local/bin/spotifyfolders
     chmod +x /usr/local/bin/spotifyfolders
   Windows: download folders.py from github.com/mikez/spotify-folders and run
     python folders.py
3. Run:  spotifyfolders > spotify-folders.json
   (if it asks for the "snappy" library, follow its instructions and run again)
4. Upload spotify-folders.json here, or paste its contents.`;

// Sync refuses documents over the server's cap; leave headroom for clocks and tombstones the
// exact figure can't know about yet
const SIZE_HEADROOM = 0.9;

function estimateDocChars(planFolders, mode) {
  const state = useUserStore.getState();
  const meta = getMeta();
  const plannedIds = new Set(planFolders.map(f => f.id));
  const nextFolders = mode === 'replace'
    ? planFolders
    : [...state.customFolders.filter(f => !plannedIds.has(f.id)), ...planFolders];
  const removed = mode === 'replace'
    ? state.customFolders.filter(f => !plannedIds.has(f.id)).map(f => f.id)
    : [];
  const deletedFolders = { ...meta.deletedFolders };
  removed.forEach(id => { deletedFolders[id] = Date.now(); });

  const doc = storeToDoc({ ...state, customFolders: nextFolders }, { ...meta, deletedFolders });
  return JSON.stringify(doc).length;
}

function ImportFoldersDialogBody({ onClose }) {
  const playlists = useUserStore((s) => s.playlists);
  const customFolders = useUserStore((s) => s.customFolders);
  const pinnedItems = useUserStore((s) => s.pinnedItems);
  const importFolderTree = useUserStore((s) => s.importFolderTree);

  const [step, setStep] = useState('input');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('replace');
  const [root, setRoot] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef(null);

  const plan = useMemo(() => {
    if (!root) return null;
    return planImport(root, { playlists, existingFolders: customFolders, pinnedItems, mode });
  }, [root, playlists, customFolders, pinnedItems, mode]);

  const docChars = useMemo(() => (plan ? estimateDocChars(plan.folders, mode) : 0), [plan, mode]);
  const overCap = docChars > MAX_DOC_CHARS * SIZE_HEADROOM;
  const kb = (n) => `${Math.round(n / 1024)} KB`;

  const preview = () => {
    setError('');
    try {
      setRoot(parseSpotifyFolders(text).root);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ImportFormatError ? err.message : "Couldn't read that file.");
    }
  };

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setText(await file.text());
    setError('');
  };

  const apply = () => {
    if (!plan || overCap) return;
    const result = importFolderTree(plan.folders, { mode });
    const skipped = plan.stats.skipped ? `, skipped ${plan.stats.skipped} you don't follow` : '';
    toast(`Imported ${plan.stats.folders} folders and ${plan.stats.playlists} playlists${skipped}`, { tone: 'success', duration: 5000 });
    if (result.removed > 0) toast(`Removed ${result.removed} previous folder${result.removed === 1 ? '' : 's'}`, { tone: 'info' });
    onClose();
  };

  const requestApply = () => {
    if (mode === 'replace' && customFolders.length > 0) setConfirmOpen(true);
    else apply();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 shadow-brand-glow">
              <FolderInput className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id="import-dialog-title" className="text-xl font-bold text-white">Import Spotify folders</h2>
              <p className="text-sm text-neutral-400">Recreate your Spotify folder tree here, nesting included.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {step === 'input' ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-4">
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5" /> Spotify doesn't expose folders through its API, so this reads them from the desktop app
                </p>
                <pre className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed font-mono">{CLI_STEPS}</pre>
              </div>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='Paste the JSON here…  { "type": "folder", "children": [ … ] }'
                rows={8}
                spellCheck={false}
                className="w-full rounded-2xl bg-neutral-900 border border-white/10 px-4 py-3 text-xs text-white font-mono placeholder:text-neutral-600 focus:border-[#f91362] outline-none focus:ring-2 focus:ring-[#f91362]/20"
              />

              {error && <p className="text-sm text-red-400 font-medium">{error}</p>}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-neutral-300 hover:bg-white/5 transition-colors"
                >
                  <Upload className="w-4 h-4" /> Upload .json
                </button>
                <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={onFileChosen} className="hidden" />
                <button
                  type="button"
                  disabled={!text.trim()}
                  onClick={preview}
                  className="rounded-full bg-brand-gradient text-white px-5 py-2 text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Preview
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'replace', label: 'Replace everything', hint: "Wipe Jomify's folders and rebuild from Spotify." },
                  { id: 'merge', label: 'Merge', hint: 'Update imported folders in place; keep Jomify-only folders.' }
                ].map(option => (
                  <label key={option.id} className={`rounded-2xl border p-4 cursor-pointer transition-colors ${mode === option.id ? 'border-[var(--brand-mid)] bg-[var(--brand-mid)]/10' : 'border-white/10 hover:border-white/20'}`}>
                    <input type="radio" name="import-mode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} className="sr-only" />
                    <p className="text-white font-bold text-sm">{option.label}</p>
                    <p className="text-xs text-neutral-400 mt-1">{option.hint}</p>
                  </label>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-4 space-y-2 text-sm">
                <p className="text-white font-semibold">
                  {plan.stats.folders} folder{plan.stats.folders === 1 ? '' : 's'} · {plan.stats.playlists} playlist{plan.stats.playlists === 1 ? '' : 's'}
                  <span className="text-neutral-500 font-normal"> — {plan.stats.created} new, {plan.stats.updated} updated in place</span>
                </p>

                {plan.stats.skipped > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowSkipped(v => !v)} className="text-amber-300 flex items-center gap-1 hover:underline">
                      {showSkipped ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      {plan.stats.skipped} playlist{plan.stats.skipped === 1 ? '' : 's'} skipped — not in your library (you don't follow {plan.stats.skipped === 1 ? 'it' : 'them'})
                    </button>
                    {showSkipped && (
                      <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-neutral-500 font-mono space-y-0.5 pl-5">
                        {plan.stats.skippedUris.map(uri => <li key={uri}>{uri}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {plan.stats.noUri > 0 && (
                  <p className="text-neutral-400">{plan.stats.noUri} folder{plan.stats.noUri === 1 ? ' had' : 's had'} no Spotify id; re-importing won't recognise {plan.stats.noUri === 1 ? 'it' : 'them'} as the same folder.</p>
                )}

                {mode === 'replace' && plan.stats.removed > 0 && (
                  <p className="text-red-300">
                    Removes {plan.stats.removed} existing Jomify folder{plan.stats.removed === 1 ? '' : 's'}{plan.stats.removedPinned ? ` (${plan.stats.removedPinned} pinned)` : ''}.
                    Playlists and albums are never deleted. Sync your other devices first — an edit there after the replace brings a folder back.
                  </p>
                )}

                <p className={overCap ? 'text-red-400 font-semibold' : 'text-neutral-500'}>
                  Synced data will be ~{kb(docChars)} of {kb(MAX_DOC_CHARS)}
                  {overCap ? ' — over the sync limit. Reduce the number of folders or playlists and try again.' : ''}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setStep('input')} className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-neutral-300 hover:bg-white/5 transition-colors">
                  Back
                </button>
                <button
                  type="button"
                  disabled={overCap || plan.stats.folders === 0}
                  onClick={requestApply}
                  className="rounded-full bg-brand-gradient text-white px-5 py-2 text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mode === 'replace' ? 'Replace folders' : 'Merge folders'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Replace all folders?"
        message={plan ? `This removes ${plan.stats.removed} existing folder${plan.stats.removed === 1 ? '' : 's'} and rebuilds ${plan.stats.folders} from Spotify. Playlists and albums are never deleted.` : ''}
        confirmLabel="Replace"
        onConfirm={() => { setConfirmOpen(false); apply(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>,
    document.body
  );
}
