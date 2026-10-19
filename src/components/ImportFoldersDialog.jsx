import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { toast } from '../store/toastStore';
import { parseSpotifyFolders, planImport, ImportFormatError } from '../import/spotifyFolders';
import { extractSpotifyFolders, CacheReadError } from '../import/spotifyCache';
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

// Where the Spotify desktop app keeps the folder tree. Windows first: that's where most of
// Jomify's users are.
// The whole data folder, not a subfolder: the reader finds the account folder inside it at any
// depth, and where Spotify keeps things differs between the Store and the download versions.
const CACHE_LOCATIONS = [
  { os: 'Windows (Spotify from the Microsoft Store, the usual case)', path: '%LOCALAPPDATA%\\Packages\\SpotifyAB.SpotifyMusic_zpdnekdrzrea0', hint: 'Paste this into the address bar of the window that opens, press Enter, then click "Select Folder" with that folder itself open. If Windows says it can\'t find it, use the next path.' },
  { os: 'Windows (Spotify downloaded from spotify.com)', path: '%LOCALAPPDATA%\\Spotify', hint: 'Same steps: paste, Enter, then "Select Folder" on the Spotify folder itself.' },
  { os: 'Mac', path: '~/Library/Application Support/Spotify', hint: 'Press Cmd+Shift+G in the window that opens, paste this, press Enter, then click Open.' }
];

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
  const profile = useUserStore((s) => s.profile);
  const importFolderTree = useUserStore((s) => s.importFolderTree);

  const [step, setStep] = useState('input');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('replace');
  const [root, setRoot] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showCli, setShowCli] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef(null);
  const dirInputRef = useRef(null);

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

  // The directory picker hands over every file under the chosen folder; only the handful of
  // LevelDB files for the signed-in account are actually read, and nothing leaves the browser
  const onDirectoryChosen = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setError('');
    setReading(true);
    try {
      const files = picked.map(f => ({
        path: f.webkitRelativePath || f.name,
        lastModified: f.lastModified,
        bytes: async () => new Uint8Array(await f.arrayBuffer())
      }));
      const { root: rawRoot } = await extractSpotifyFolders(files, { userId: profile?.id || null });
      setRoot(parseSpotifyFolders(JSON.stringify(rawRoot)).root);
      setStep('preview');
    } catch (err) {
      if (err instanceof CacheReadError || err instanceof ImportFormatError) setError(err.message);
      else {
        console.error('[import] cache read failed:', err);
        setError("Couldn't read Spotify's files. Quit Spotify and try again, or use the command-line tool below.");
      }
    } finally {
      setReading(false);
    }
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
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" className="ui-plane flex max-h-[90vh] w-full max-w-2xl flex-col">
        <div className="flex shrink-0 items-start justify-between gap-6 px-7 pb-5 pt-7">
          <div>
            <h2 id="import-dialog-title" className="text-[18px] font-semibold leading-tight tracking-[-0.01em]">Import Spotify folders</h2>
            <p className="mt-2 text-[13px] text-[var(--room-dim)]">Recreate your Spotify folder tree here, nesting included.</p>
          </div>
          <button type="button" onClick={onClose} className="ui-word shrink-0">Close</button>
        </div>

        <div className="custom-scrollbar space-y-6 overflow-y-auto border-t border-[var(--room-hair)] px-7 pb-7 pt-5">
          {step === 'input' ? (
            <>
              <div className="space-y-3">
                <p className="text-[14px] font-semibold">Read them from the Spotify app on this computer</p>
                <ol className="list-decimal space-y-1 pl-5 text-[13px] text-[var(--room-dim)]">
                  <li>Quit Spotify completely (on Windows, also from the tray icon by the clock).</li>
                  <li>Click the button below and pick Spotify's <span className="text-[var(--room-paper)]">data folder</span>. The whole thing is fine; Jomify finds your account inside it:</li>
                </ol>
                <ul className="space-y-3 pl-5 text-[12.5px] text-[var(--room-dim)]">
                  {CACHE_LOCATIONS.map(loc => (
                    <li key={loc.os}>
                      <span className="text-[var(--room-paper)]">{loc.os}:</span>{' '}
                      <code className="select-all rounded-[3px] px-1.5 py-0.5 text-[var(--room-paper)] [font-family:var(--font-mono)]" style={{ background: 'rgba(241,239,233,0.06)' }}>{loc.path}</code>
                      <span className="mt-0.5 block">{loc.hint}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[12.5px] text-[var(--room-dim)]">Your browser will ask something like "Upload 2,000 files?". Choose Upload. Only Spotify's small index files are read, in your browser; nothing is sent anywhere.</p>
                <p className="pt-1">
                  <button
                    type="button"
                    disabled={reading}
                    onClick={() => dirInputRef.current?.click()}
                    className="ui-pill disabled:cursor-not-allowed"
                  >
                    {reading ? 'Reading…' : 'Choose Spotify folder'}
                  </button>
                </p>
                <input ref={dirInputRef} type="file" webkitdirectory="" directory="" multiple onChange={onDirectoryChosen} className="hidden" />
              </div>

              {error && <p className="text-[13px] text-[rgb(240,160,160)]">{error}</p>}

              <div className="border-t border-[var(--room-hair)] pt-5">
                <button type="button" onClick={() => setShowCli(v => !v)} aria-expanded={showCli} className="ui-word whitespace-normal text-left">
                  Or use the command-line tool and paste its output
                </button>
              </div>

              {showCli && (
                <pre className="whitespace-pre-wrap border-l border-[var(--room-hair)] pl-4 text-[12px] leading-relaxed text-[var(--room-dim)] [font-family:var(--font-mono)]">{CLI_STEPS}</pre>
              )}

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='Paste the JSON here…  { "type": "folder", "children": [ … ] }'
                aria-label="Folder tree as JSON"
                rows={8}
                spellCheck={false}
                className="ui-field resize-y text-[12px] [font-family:var(--font-mono)]"
              />

              <div className="flex items-center justify-between gap-6">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ui-word"
                >
                  Upload .json
                </button>
                <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={onFileChosen} className="hidden" />
                <button
                  type="button"
                  disabled={!text.trim()}
                  onClick={preview}
                  className="ui-pill disabled:cursor-not-allowed"
                >
                  Preview
                </button>
              </div>
            </>
          ) : (
            <>
              <div role="radiogroup" aria-label="How to import" className="grid grid-cols-2 gap-6">
                {[
                  { id: 'replace', label: 'Replace everything', hint: "Wipe Jomify's folders and rebuild from Spotify." },
                  { id: 'merge', label: 'Merge', hint: 'Update imported folders in place; keep Jomify-only folders.' }
                ].map(option => (
                  // the radio itself is hidden, so its keyboard focus shows on the whole choice
                  <label key={option.id} className="block cursor-pointer border-t border-[var(--room-hair)] pt-3 outline-offset-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-[var(--room-dim)]">
                    <input type="radio" name="import-mode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} className="sr-only" />
                    <p className={`ui-headword inline text-[14px] font-medium ${mode === option.id ? 'text-[var(--room-paper)] decoration-[var(--room-paper)]' : 'text-[var(--room-dim)]'}`}>{option.label}</p>
                    <p className="mt-1.5 text-[12.5px] text-[var(--room-faint)]">{option.hint}</p>
                  </label>
                ))}
              </div>

              <div className="space-y-2 border-t border-[var(--room-hair)] pt-4 text-[13px]">
                <p className="font-medium">
                  {plan.stats.folders} folder{plan.stats.folders === 1 ? '' : 's'} · {plan.stats.playlists} playlist{plan.stats.playlists === 1 ? '' : 's'}
                  <span className="font-normal text-[var(--room-dim)]"> — {plan.stats.created} new, {plan.stats.updated} updated in place</span>
                </p>

                {plan.stats.skipped > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowSkipped(v => !v)} aria-expanded={showSkipped} className="ui-headword text-left text-[var(--room-paper)]">
                      {plan.stats.skipped} playlist{plan.stats.skipped === 1 ? '' : 's'} skipped — not in your library (you don't follow {plan.stats.skipped === 1 ? 'it' : 'them'})
                    </button>
                    {showSkipped && (
                      <ul className="custom-scrollbar mt-2 max-h-32 space-y-0.5 overflow-y-auto pl-5 text-[11.5px] text-[var(--room-faint)] [font-family:var(--font-mono)]">
                        {plan.stats.skippedUris.map(uri => <li key={uri}>{uri}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {plan.stats.noUri > 0 && (
                  <p className="text-[var(--room-dim)]">{plan.stats.noUri} folder{plan.stats.noUri === 1 ? ' had' : 's had'} no Spotify id; re-importing won't recognise {plan.stats.noUri === 1 ? 'it' : 'them'} as the same folder.</p>
                )}

                {mode === 'replace' && plan.stats.removed > 0 && (
                  <p className="text-[rgb(240,160,160)]">
                    Removes {plan.stats.removed} existing Jomify folder{plan.stats.removed === 1 ? '' : 's'}{plan.stats.removedPinned ? ` (${plan.stats.removedPinned} pinned)` : ''}.
                    Playlists and albums are never deleted. Sync your other devices first — an edit there after the replace brings a folder back.
                  </p>
                )}

                <p className={overCap ? 'font-semibold text-[rgb(240,160,160)]' : 'text-[var(--room-faint)]'}>
                  Synced data will be ~{kb(docChars)} of {kb(MAX_DOC_CHARS)}
                  {overCap ? ' — over the sync limit. Reduce the number of folders or playlists and try again.' : ''}
                </p>
              </div>

              <div className="flex items-center justify-between gap-6">
                <button type="button" onClick={() => setStep('input')} className="ui-word">
                  Back
                </button>
                <button
                  type="button"
                  disabled={overCap || plan.stats.folders === 0}
                  onClick={requestApply}
                  className="ui-pill disabled:cursor-not-allowed"
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
