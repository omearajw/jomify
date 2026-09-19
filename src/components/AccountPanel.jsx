import { useEffect, useRef, useState } from 'react';
import { Download, Upload, RefreshCw, LogOut } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import { downloadBackup, parseBackup, applyBackup } from '../sync/backup';
import { isSafeToHardLogout, pullNow, syncNowIfPending } from '../sync/engine';
import { clearMeta } from '../sync/meta';
import ConfirmDialog from './ConfirmDialog';
import NotificationToggle from './NotificationToggle';

function formatAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Sync status, backup, restore and disconnect. Lived in the sidebar footer, which phones never
// show, so a broken sync on a phone was invisible and undoable. The sidebar keeps the compact
// `footer` look; the phone gets the `sheet` variant.
export default function AccountPanel({ variant = 'footer', tagline = '' }) {
  const logout = useUserStore((s) => s.logout);
  const profile = useUserStore((s) => s.profile);
  const syncStatus = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const [, forceTick] = useState(0);

  useEffect(() => {
    // Keeps "Synced 2m ago" honest without re-rendering constantly
    const id = setInterval(() => forceTick(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const syncLabel = (() => {
    switch (syncStatus) {
      case 'pulling':
      case 'pushing': return { text: 'Syncing…', isError: false };
      case 'offline': return { text: 'Offline — will sync when reconnected', isError: false };
      case 'error': return { text: 'Sync paused — retrying', isError: true };
      case 'disabled': return { text: 'Sync is off', isError: true };
      default:
        if (!lastSyncedAt) return { text: 'Not synced yet', isError: false };
        return { text: `Synced ${formatAgo(lastSyncedAt)}`, isError: false };
    }
  })();

  const backupFileInputRef = useRef(null);
  const [backupMessage, setBackupMessage] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const flashMessage = (text, isError = false) => {
    setBackupMessage({ text, isError });
    setTimeout(() => setBackupMessage(null), 6000);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      syncNowIfPending();
      const result = await pullNow();
      flashMessage(result ? 'Synced.' : 'Sync failed. It will keep retrying.', !result);
    } finally {
      setSyncing(false);
    }
  };

  const handleExportBackup = () => {
    try {
      const backup = downloadBackup();
      flashMessage(`Saved ${backup.counts.folders} folders and ${backup.counts.pins} pins.`);
    } catch (err) {
      console.error('Backup failed:', err);
      flashMessage('Backup failed. See the console for details.', true);
    }
  };

  const handleRestoreFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Let the same file be picked again after a cancel
    if (!file) return;
    try {
      setPendingRestore(parseBackup(await file.text()));
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  const handleConfirmRestore = () => {
    try {
      applyBackup(pendingRestore);
      flashMessage('Backup restored.');
    } catch (err) {
      console.error('Restore failed:', err);
      flashMessage('Restore failed. See the console for details.', true);
    } finally {
      setPendingRestore(null);
    }
  };

  // A deliberate disconnect clears this device's copy of the synced data, but only once that
  // data is demonstrably on the server. The involuntary logout() calls in App.jsx stay soft,
  // because wiping folders over a transient network blip is exactly the bug commit ea508a9 fixed.
  const handleDisconnect = () => {
    const canHardClear = isSafeToHardLogout();
    if (canHardClear) clearMeta();
    logout({ hard: canHardClear });
    window.location.href = '/';
  };

  const restoreDialog = (
    <ConfirmDialog
      open={Boolean(pendingRestore)}
      title="Restore this backup?"
      message={pendingRestore
        ? `This replaces your current folders and pins with the backup from ${new Date(pendingRestore.exportedAt).toLocaleString()} (${pendingRestore.counts?.folders ?? 0} folders, ${pendingRestore.counts?.pins ?? 0} pins). Folders and pins not in the backup are removed on every device.`
        : ''}
      confirmLabel="Restore"
      onConfirm={handleConfirmRestore}
      onCancel={() => setPendingRestore(null)}
    />
  );
  const fileInput = (
    <input ref={backupFileInputRef} type="file" accept="application/json,.json" onChange={handleRestoreFileChosen} className="hidden" />
  );

  if (variant === 'footer') {
    return (
      <div className="mt-auto border-t border-neutral-800 pt-6 flex flex-col space-y-2 text-xs text-neutral-600 shrink-0">
        {tagline && <p>{tagline}</p>}
        <div className="flex items-center gap-3">
          <button onClick={handleExportBackup} className="text-left hover:text-white transition-colors">Back up data</button>
          <span className="w-1 h-1 rounded-full bg-neutral-700" />
          <button onClick={() => backupFileInputRef.current?.click()} className="text-left hover:text-white transition-colors">Restore</button>
        </div>
        {backupMessage && (
          <p className={backupMessage.isError ? 'text-red-400' : 'text-[var(--brand-start)]'}>{backupMessage.text}</p>
        )}
        {fileInput}
        <p className={syncLabel.isError ? 'text-red-400' : 'text-neutral-600'}>{syncLabel.text}</p>
        <button onClick={handleDisconnect} className="text-left hover:text-white transition-colors">Disconnect Account</button>
        {restoreDialog}
      </div>
    );
  }

  const row = 'w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold text-white hover:bg-white/5 active:bg-white/10 transition-colors';
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Signed in as</p>
        <p className="text-white font-semibold truncate">{profile?.display_name || profile?.id || '…'}</p>
        <p className={`text-xs mt-1 ${syncLabel.isError ? 'text-red-400' : 'text-neutral-400'}`}>{syncLabel.text}</p>
      </div>
      {backupMessage && (
        <p className={`px-1 text-sm ${backupMessage.isError ? 'text-red-400' : 'text-[var(--brand-start)]'}`}>{backupMessage.text}</p>
      )}
      <NotificationToggle />
      <div className="rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
        <button type="button" onClick={handleSyncNow} disabled={syncing} className={`${row} disabled:opacity-60`}>
          <RefreshCw className={`w-5 h-5 text-neutral-400 ${syncing ? 'animate-spin' : ''}`} /> Sync now
        </button>
        <button type="button" onClick={handleExportBackup} className={row}>
          <Download className="w-5 h-5 text-neutral-400" /> Back up data
        </button>
        <button type="button" onClick={() => backupFileInputRef.current?.click()} className={row}>
          <Upload className="w-5 h-5 text-neutral-400" /> Restore a backup
        </button>
        <button type="button" onClick={handleDisconnect} className={`${row} text-red-400`}>
          <LogOut className="w-5 h-5" /> Disconnect account
        </button>
      </div>
      {fileInput}
      {restoreDialog}
    </div>
  );
}
