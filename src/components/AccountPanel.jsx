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
import { canHearComputer } from '../views/ZenMode/zenPulse';
import { isDemo } from '../demo/boot';
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
const LAYOUTS = [
  { id: 'on', label: 'The room', hint: 'The now-playing room is the app, and the library slides over it' },
  { id: 'off', label: 'The old layout (legacy)', hint: 'The sidebar and pages Jomify had before the room. Kept as it is: new features and fixes go to the room only' }
];
const QUEUES = [
  { id: 'old', label: 'Current' },
  { id: 'new', label: 'New (testing)', hint: 'Jomify keeps the whole queue, playlist included, and hands Spotify the list to play. Shuffle, repeat and "When a playlist ends" are Jomify\'s; with "Let Spotify choose" the music stops at the end, as Spotify has nothing of its own to pick from a list' }
];
const HEARTS = [
  { id: 'always', label: 'Always' },
  { id: 'hover', label: 'When the pointer is on the row' }
];
const CONTRASTS = [
  { id: 'auto', label: 'Follow the system', hint: "On when the OS asks for more contrast" },
  { id: 'high', label: 'High contrast', hint: 'Brighter text, stronger lines, a solid panel' },
  { id: 'normal', label: 'As designed' }
];
const ZEN_EFFECTS = [
  { id: 'auto', label: 'Automatic', hint: 'Full effects; drops to the lighter scene if this device cannot keep up' },
  { id: 'full', label: 'Full', hint: 'Blended layers, blurred lyrics, always-moving backdrop' },
  { id: 'lite', label: 'Lite', hint: 'The same scene without the expensive layers' }
];
const ZEN_SOUNDS = [
  { id: 'tempo', label: "The song's tempo", hint: 'The light swells at the song\u2019s real BPM. Works everywhere, nothing to allow' },
  { id: 'sound', label: "This computer's sound", hint: 'Listens to what the computer plays. Asks to share your screen with its audio each time Zen opens' }
];
const GRID_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const LIBRARY_SORTS = [['recent', 'Recently played'], ['spotify', 'Spotify order'], ['az', 'A to Z'], ['za', 'Z to A'], ['owner', 'By owner']];

function Choice({ label, value, options, onChange }) {
  const chosen = options.find((o) => o.id === value);
  return (
    <div className="border-t border-[var(--room-hair)] pt-3 pb-1" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono mb-2 text-[var(--room-faint)]">{label}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`text-[13px] transition-colors ${value === o.id ? 'font-semibold text-[var(--room-paper)]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}
            style={{ transitionDuration: 'var(--room-mid)' }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {chosen?.hint && <p className="mt-1.5 text-[12px] text-[var(--room-faint)]">{chosen.hint}</p>}
    </div>
  );
}

// The room's optional modes, each switched on or off (Jack, 19 Oct: for people who don't use them).
// Off, a mode leaves the rail and the phone's launcher; what it holds is kept, so on again
// brings it back as it was.
const MODES = [
  { id: 'sevens', label: 'Sevens' },
  { id: 'unadded', label: 'Unadded' },
  { id: 'party', label: 'Party' }
];
function ModeSwitches({ off, onToggle }) {
  return (
    <div className="border-t border-[var(--room-hair)] pt-3 pb-1" style={{ fontFamily: 'var(--font-room)' }}>
      <p className="room-mono mb-2 text-[var(--room-faint)]">Modes</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Modes">
        {MODES.map((m) => {
          const on = !off.includes(m.id);
          return (
            <button key={m.id} type="button" role="switch" aria-checked={on} onClick={() => onToggle(m.id)}
              className={`text-[13px] transition-colors ${on ? 'font-semibold text-[var(--room-paper)]' : 'text-[var(--room-faint)] line-through decoration-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}
              style={{ transitionDuration: 'var(--room-mid)' }}>
              {m.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] text-[var(--room-faint)]">Tap one to switch it off or on. Off, it leaves the rail and the launcher; nothing in it is lost.</p>
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
    if (isDemo()) return { text: 'Demo: nothing is saved', isError: false };
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
      <div className="mt-auto border-t border-[var(--room-hair)] pt-2 flex flex-col gap-1 text-[11px] leading-tight text-[var(--room-faint)] shrink-0">
        <p className={syncLabel.isError ? 'text-red-400' : 'text-[var(--room-faint)]'}>{syncLabel.text}</p>
        {backupMessage && (
          <p className={backupMessage.isError ? 'text-red-400' : 'text-[var(--room-paper)]'}>{backupMessage.text}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {!isDemo() && <>
            <button onClick={handleSyncNow} disabled={syncing} className="hover:text-[var(--room-paper)] transition-colors disabled:opacity-60">{syncing ? 'Syncing…' : 'Sync now'}</button>
            <span className="w-0.5 h-0.5 rounded-full bg-white/15" />
          </>}
          <button onClick={handleExportBackup} className="hover:text-[var(--room-paper)] transition-colors">Back up</button>
          <span className="w-0.5 h-0.5 rounded-full bg-white/15" />
          <button onClick={() => backupFileInputRef.current?.click()} className="hover:text-[var(--room-paper)] transition-colors">Restore</button>
          <span className="w-0.5 h-0.5 rounded-full bg-white/15" />
          <button onClick={() => setShowLog(true)} className="hover:text-[var(--room-paper)] transition-colors">Log</button>
          <span className="w-0.5 h-0.5 rounded-full bg-white/15" />
          {/* Notifications and Disconnect live in the full panel, the same one the phone opens */}
          <button onClick={() => useUserStore.getState().setAccountOpen(true)} className="hover:text-[var(--room-paper)] transition-colors">Settings…</button>
        </div>
        <p className="text-[var(--room-faint)] truncate" title={tagline}>Build {__BUILD_ID__}{tagline ? ` · ${tagline}` : ''}</p>
        {fileInput}
        {restoreDialog}
        {disconnectDialog}
        {logPanel}
      </div>
    );
  }

  const row = 'ui-row';
  return (
    <div className="space-y-3">
      <div className="pb-3" style={{ fontFamily: 'var(--font-room)' }}>
        <p className="room-mono text-[var(--room-faint)]">Signed in as</p>
        <p className="text-[var(--room-paper)] font-semibold truncate">{profile?.display_name || profile?.id || '…'}</p>
        <p className={`text-xs mt-1 ${syncLabel.isError ? 'text-red-400' : 'text-[var(--room-dim)]'}`}>{syncLabel.text}</p>
      </div>
      {backupMessage && (
        <p className={`px-1 text-sm ${backupMessage.isError ? 'text-red-400' : 'text-[var(--room-paper)]'}`}>{backupMessage.text}</p>
      )}

      <p className="pt-4 room-mono text-[var(--room-faint)]">Playback</p>
      <Choice label="When a playlist ends" value={playbackSettings?.whenPlaylistEnds || 'spotify'} options={ENDINGS} onChange={(v) => setPlaybackSetting('whenPlaylistEnds', v)} />
      <Choice label="Queue" value={playbackSettings?.queueEngine ? 'new' : 'old'} options={QUEUES} onChange={(v) => setPlaybackSetting('queueEngine', v === 'new')} />

      <p className="pt-4 room-mono text-[var(--room-faint)]">App</p>
      <Choice label="Open on" value={playbackSettings?.startupPage || 'resume'} options={STARTS} onChange={(v) => setPlaybackSetting('startupPage', v)} />
      <Choice label="Layout" value={playbackSettings?.newLayout ?? 'on'} options={LAYOUTS} onChange={(v) => setPlaybackSetting('newLayout', v)} />
      {(playbackSettings?.newLayout ?? 'on') === 'on' && <ModeSwitches off={playbackSettings?.modesOff || []} onToggle={(id) => { const off = playbackSettings?.modesOff || []; setPlaybackSetting('modesOff', off.includes(id) ? off.filter((x) => x !== id) : [...off, id]); }} />}
      {(playbackSettings?.newLayout ?? 'on') === 'on' && <Choice label="Hearts on song rows" value={playbackSettings?.rowHearts || 'always'} options={HEARTS} onChange={(v) => setPlaybackSetting('rowHearts', v)} />}
      <Choice label="Contrast" value={playbackSettings?.contrast || 'auto'} options={CONTRASTS} onChange={(v) => setPlaybackSetting('contrast', v)} />
      <Choice label="Zen mode effects" value={playbackSettings?.zenEffects || 'auto'} options={ZEN_EFFECTS} onChange={(v) => { setPlaybackSetting('zenEffects', v); if (v !== 'auto') { try { localStorage.removeItem('jomify_zen_lite'); } catch { /* fine */ } } }} />
      {canHearComputer() && <Choice label="Zen mode moves to" value={playbackSettings?.zenSound || 'tempo'} options={ZEN_SOUNDS} onChange={(v) => setPlaybackSetting('zenSound', v)} />}
      <div className="border-t border-[var(--room-hair)] pt-3 space-y-3" style={{ fontFamily: 'var(--font-room)' }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--room-paper)]">Library card size</p>
          <div className="flex items-center gap-1 bg-black/30 rounded-full p-1">
            {GRID_SIZES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={libraryGridSize === id} onClick={() => setLibraryGridSize(id)} className={`px-3 py-1 rounded-full text-xs font-semibold ${libraryGridSize === id ? 'bg-[var(--room-paper)] text-[#0a0810]' : 'text-[var(--room-dim)] hover:text-[var(--room-paper)]'}`}>{label}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[var(--room-paper)]">Library order</span>
          <select value={librarySort} onChange={(e) => setLibrarySort(e.target.value)} className="bg-black/30 border border-[var(--room-hair)] rounded-[6px] px-3 py-1.5 text-sm text-[var(--room-paper)] focus:outline-none">
            {LIBRARY_SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>

      <p className="pt-4 room-mono text-[var(--room-faint)]">Sevens</p>
      <NotificationToggle />

      <p className="pt-4 room-mono text-[var(--room-faint)]">Account and sync</p>
      <div className="border-t border-[var(--room-hair)]" style={{ fontFamily: 'var(--font-room)' }}>
        {!isDemo() && <button type="button" onClick={handleSyncNow} disabled={syncing} className={`${row} disabled:opacity-60`}>
          <RefreshCw className={`w-5 h-5 text-[var(--room-dim)] ${syncing ? 'animate-spin' : ''}`} /> Sync now
        </button>}
        <button type="button" onClick={handleExportBackup} className={row}>
          <Download className="w-5 h-5 text-[var(--room-dim)]" /> Back up data
        </button>
        <button type="button" onClick={() => backupFileInputRef.current?.click()} className={row}>
          <Upload className="w-5 h-5 text-[var(--room-dim)]" /> Restore a backup
        </button>
        <button type="button" onClick={() => setShowLog(true)} className={row}>
          <Bug className="w-5 h-5 text-[var(--room-dim)]" /> Debug log
        </button>
        <button type="button" onClick={() => { setAccountOpen(false); setShortcutsOpen(true); }} className={`${row} hidden md:flex`}>
          <Keyboard className="w-5 h-5 text-[var(--room-dim)]" /> Keyboard shortcuts
        </button>
        <button type="button" onClick={() => setConfirmDisconnect(true)} className={`${row} ui-row-danger`}>
          <LogOut className="w-5 h-5" /> Disconnect account
        </button>
      </div>
      <p className="px-1 text-xs text-[var(--room-faint)]">Build {__BUILD_ID__}</p>
      {fileInput}
      {restoreDialog}
      {disconnectDialog}
      {logPanel}
    </div>
  );
}
