import { useEffect, useRef, useState } from 'react';
import { Download, Upload, RefreshCw, LogOut, Bug } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useSyncStore } from '../store/syncStore';
import { downloadBackup, parseBackup, applyBackup } from '../sync/backup';
import { isSafeToHardLogout, pullNow, syncNowIfPending } from '../sync/engine';
import { clearMeta } from '../sync/meta';
import ConfirmDialog from './ConfirmDialog';
import NotificationToggle from './NotificationToggle';
import DebugLogPanel from './DebugLogPanel';
import { disableNotifications } from '../pwa/push';
import { clearLibraryCache } from '../services/libraryCache';
import { Keyboard } from 'lucide-react';

const ENDINGS = [
  { id: 'spotify', label: 'Let Spotify choose', hint: "Spotify's own autoplay carries on with songs it picks" },
  { id: 'liked', label: 'Carry on into Liked Songs', hint: 'Shuffled, from your whole collection' },
  { id: 'artists', label: "Songs by the playlist's artists", hint: "Popular songs by the people on the playlist that weren't on it" },
  { id: 'stop', label: 'Stop', hint: 'Silence when the playlist ends' }
];
const STARTS = [
  { id: 'resume', label: 'Where I left off' },
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Your Library' }
];
const ZEN_EFFECTS = [
  { id: 'auto', label: 'Automatic', hint: 'Full effects; drops to the lighter scene if this device cannot keep up' },
  { id: 'full', label: 'Full', hint: 'Blended layers, blurred lyrics, always-moving backdrop' },
  { id: 'lite', label: 'Lite', hint: 'The same scene without the expensive layers' }
];
const GRID_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const LIBRARY_SORTS = [['recent', 'Recently played'], ['spotify', 'Spotify order'], ['az', 'A to Z'], ['za', 'Z to A'], ['owner', 'By owner']];

function Choice({ label, value, options, onChange }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-semibold text-white mb-3">{label}</p>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`w-full text-left rounded-xl px-3 py-2 transition-colors ${value === o.id ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'}`}
          >
            <span className="text-sm font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-neutral-500">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const [showLog, setShowLog] = useState(false);
  const logPanel = showLog && <DebugLogPanel onClose={() => setShowLog(false)} />;

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
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const sevensNotifications = useUserStore((s) => s.sevensNotifications);
  const playbackSettings = useUserStore((s) => s.playbackSettings);
  const setPlaybackSetting = useUserStore((s) => s.setPlaybackSetting);
  const libraryGridSize = useUserStore((s) => s.libraryGridSize);
  const setLibraryGridSize = useUserStore((s) => s.setLibraryGridSize);
  const librarySort = useUserStore((s) => s.librarySort);
  const setLibrarySort = useUserStore((s) => s.setLibrarySort);
  const setShortcutsOpen = useUserStore((s) => s.setShortcutsOpen);
  const setAccountOpen = useUserStore((s) => s.setAccountOpen);
  const handleDisconnect = async () => {
    setConfirmDisconnect(false);
    // Otherwise the server keeps pinging a phone that no longer belongs to this account
    if (sevensNotifications) {
      const token = useUserStore.getState().token;
      if (token) await disableNotifications(token).catch((err) => console.warn('Could not switch notifications off before disconnecting:', err));
    }
    const canHardClear = isSafeToHardLogout();
    if (canHardClear) clearMeta();
    logout({ hard: canHardClear });
    clearLibraryCache();
    window.location.href = '/';
  };
  const disconnectDialog = (
    <ConfirmDialog
      open={confirmDisconnect}
      title="Disconnect this account?"
      message={`Jomify signs out of Spotify on this device${sevensNotifications ? ' and switches off its Sevens notifications' : ''}. ${isSafeToHardLogout() ? 'Your folders, pins and Sevens are backed up to your account and come back when you sign in again.' : "This device's folders and pins haven't finished backing up, so they stay on the device until you sign in again."}`}
      confirmLabel="Disconnect"
      onConfirm={handleDisconnect}
      onCancel={() => setConfirmDisconnect(false)}
    />
  );

  const restoreDialog = (
    <ConfirmDialog
      open={Boolean(pendingRestore)}
      title="Restore this backup?"
      message={pendingRestore
        ? `This replaces your folders, pins, Sevens, friends, sort settings, check playlists and volume with the backup from ${new Date(pendingRestore.exportedAt).toLocaleString()} (${pendingRestore.counts?.folders ?? 0} folders, ${pendingRestore.counts?.pins ?? 0} pins, ${pendingRestore.counts?.sevens ?? 0} Sevens). Anything not in the backup is removed on every device.`
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
      <div className="mt-auto border-t border-neutral-800 pt-2 flex flex-col gap-1 text-[11px] leading-tight text-neutral-600 shrink-0">
        <p className={syncLabel.isError ? 'text-red-400' : 'text-neutral-600'}>{syncLabel.text}</p>
        {backupMessage && (
          <p className={backupMessage.isError ? 'text-red-400' : 'text-[var(--brand-start)]'}>{backupMessage.text}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleSyncNow} disabled={syncing} className="hover:text-white transition-colors disabled:opacity-60">{syncing ? 'Syncing…' : 'Sync now'}</button>
          <span className="w-0.5 h-0.5 rounded-full bg-neutral-700" />
          <button onClick={handleExportBackup} className="hover:text-white transition-colors">Back up</button>
          <span className="w-0.5 h-0.5 rounded-full bg-neutral-700" />
          <button onClick={() => backupFileInputRef.current?.click()} className="hover:text-white transition-colors">Restore</button>
          <span className="w-0.5 h-0.5 rounded-full bg-neutral-700" />
          <button onClick={() => setShowLog(true)} className="hover:text-white transition-colors">Log</button>
          <span className="w-0.5 h-0.5 rounded-full bg-neutral-700" />
          {/* Notifications and Disconnect live in the full panel, the same one the phone opens */}
          <button onClick={() => useUserStore.getState().setAccountOpen(true)} className="hover:text-white transition-colors">Settings…</button>
        </div>
        <p className="text-neutral-700 truncate" title={tagline}>Build {__BUILD_ID__}{tagline ? ` · ${tagline}` : ''}</p>
        {fileInput}
        {restoreDialog}
        {disconnectDialog}
        {logPanel}
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

      <p className="px-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">Playback</p>
      <Choice label="When a playlist ends" value={playbackSettings?.whenPlaylistEnds || 'spotify'} options={ENDINGS} onChange={(v) => setPlaybackSetting('whenPlaylistEnds', v)} />

      <p className="px-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">App</p>
      <Choice label="Open on" value={playbackSettings?.startupPage || 'resume'} options={STARTS} onChange={(v) => setPlaybackSetting('startupPage', v)} />
      <Choice label="Zen mode effects" value={playbackSettings?.zenEffects || 'auto'} options={ZEN_EFFECTS} onChange={(v) => { setPlaybackSetting('zenEffects', v); if (v !== 'auto') { try { localStorage.removeItem('jomify_zen_lite'); } catch { /* fine */ } } }} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">Library card size</p>
          <div className="flex items-center gap-1 bg-black/30 rounded-full p-1">
            {GRID_SIZES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={libraryGridSize === id} onClick={() => setLibraryGridSize(id)} className={`px-3 py-1 rounded-full text-xs font-bold ${libraryGridSize === id ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}>{label}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-white">Library order</span>
          <select value={librarySort} onChange={(e) => setLibrarySort(e.target.value)} className="bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none">
            {LIBRARY_SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>

      <p className="px-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">Sevens</p>
      <NotificationToggle />

      <p className="px-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">Account and sync</p>
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
        <button type="button" onClick={() => setShowLog(true)} className={row}>
          <Bug className="w-5 h-5 text-neutral-400" /> Debug log
        </button>
        <button type="button" onClick={() => { setAccountOpen(false); setShortcutsOpen(true); }} className={`${row} hidden md:flex`}>
          <Keyboard className="w-5 h-5 text-neutral-400" /> Keyboard shortcuts
        </button>
        <button type="button" onClick={() => setConfirmDisconnect(true)} className={`${row} text-red-400`}>
          <LogOut className="w-5 h-5" /> Disconnect account
        </button>
      </div>
      <p className="px-1 text-xs text-neutral-600">Build {__BUILD_ID__}</p>
      {fileInput}
      {restoreDialog}
      {disconnectDialog}
      {logPanel}
    </div>
  );
}
