import { createPortal } from 'react-dom';
import { FolderPlus } from 'lucide-react';
import { useSyncStore } from '../store/syncStore';
import { resolveFirstSyncConflict } from '../sync/engine';

// Shown once, on a device's first sync, only when BOTH this device and the account already
// have synced data (folders, pins, Sevens or friends). Merging is the default and never loses
// anything; "use my account's" discards only this device's local copy and never writes a
// deletion to the server.
const describe = (counts) => {
  const parts = [
    counts.folders ? `${counts.folders} folder${counts.folders === 1 ? '' : 's'}` : null,
    counts.pins ? `${counts.pins} pin${counts.pins === 1 ? '' : 's'}` : null,
    counts.sevens ? `${counts.sevens} Seven${counts.sevens === 1 ? '' : 's'}` : null,
    counts.friends ? `${counts.friends} friend${counts.friends === 1 ? '' : 's'}` : null
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nothing';
};

export default function SyncConflictDialog() {
  const conflict = useSyncStore((s) => s.firstSyncConflict);
  if (!conflict) return null;

  const { local, remote } = conflict;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title" className="w-full max-w-lg rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-white/10 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-brand-gradient flex items-center justify-center shrink-0 shadow-brand-glow">
            <FolderPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 id="sync-conflict-title" className="text-xl font-bold text-white">This device and your account differ</h2>
            <p className="text-sm text-neutral-400 mt-1">
              This device has <span className="text-white font-semibold">{describe(local)}</span>.
              Your account already has <span className="text-white font-semibold">{describe(remote)}</span> saved.
              Nothing is changed until you choose.
            </p>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => resolveFirstSyncConflict('merge')}
            className="w-full rounded-2xl bg-brand-gradient text-white px-5 py-3 text-sm font-bold shadow-brand-glow hover:scale-[1.01] transition-transform text-left"
          >
            Merge them all
            <span className="block text-xs font-medium text-white/80 mt-0.5">Keep both sets. Nothing is lost.</span>
          </button>
          <button
            type="button"
            onClick={() => resolveFirstSyncConflict('useRemote')}
            className="w-full rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-neutral-200 hover:bg-white/5 transition-colors text-left"
          >
            Use my account's
            <span className="block text-xs font-medium text-neutral-500 mt-0.5">Replace this device's folders, pins, Sevens and friends with the account's. The account is untouched.</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
