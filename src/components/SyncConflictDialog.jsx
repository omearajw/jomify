import { createPortal } from 'react-dom';
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title" className="ui-plane w-full max-w-lg p-7">
        <h2 id="sync-conflict-title" className="text-[18px] font-semibold leading-tight tracking-[-0.01em]">This device and your account differ</h2>
        <p className="mt-2 text-[13px] text-[var(--room-dim)]">
          This device has <span className="text-[var(--room-paper)]">{describe(local)}</span>.
          Your account already has <span className="text-[var(--room-paper)]">{describe(remote)}</span> saved.
          Nothing is changed until you choose.
        </p>

        <dl className="mt-5 border-t border-[var(--room-hair)]">
          <div className="border-b border-[var(--room-hair)] py-3">
            <dt className="room-mono text-[var(--room-faint)]">Merge them all</dt>
            <dd id="sync-conflict-merge" className="mt-1 text-[13px] text-[var(--room-dim)]">Keep both sets. Nothing is lost.</dd>
          </div>
          <div className="border-b border-[var(--room-hair)] py-3">
            <dt className="room-mono text-[var(--room-faint)]">Use my account's</dt>
            <dd id="sync-conflict-remote" className="mt-1 text-[13px] text-[var(--room-dim)]">Replace this device's folders, pins, Sevens and friends with the account's. The account is untouched.</dd>
          </div>
        </dl>

        <div className="mt-7 flex items-center justify-end gap-6">
          <button
            type="button"
            onClick={() => resolveFirstSyncConflict('useRemote')}
            aria-describedby="sync-conflict-remote"
            className="ui-word"
          >
            Use my account's
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveFirstSyncConflict('merge')}
            aria-describedby="sync-conflict-merge"
            className="ui-pill"
          >
            Merge them all
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
