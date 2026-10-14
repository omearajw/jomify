import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { toast } from '../store/toastStore';
import { isPushSupported, beginEnableNotifications, disableNotifications, describePushBlocker } from '../pwa/push';

// Switch for Sevens push notifications. Turning it on asks for permission, subscribes this
// device, then sends the user to Spotify once more to give the server its own sign-in (a
// separate grant, so the server refreshing it can never sign the browser out).
export default function NotificationToggle({ compact = false }) {
  const enabled = useUserStore((s) => s.sevensNotifications);
  const token = useUserStore((s) => s.token);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      if (enabled) {
        await disableNotifications(token);
        toast('Sevens notifications off', { tone: 'info' });
      } else {
        // Redirects to Spotify on success; only errors come back here
        await beginEnableNotifications(token);
      }
    } catch (err) {
      toast(err?.message || "Couldn't change notifications", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const supported = isPushSupported();
  const blocker = describePushBlocker();

  return (
    <div className={`flex items-center justify-between gap-6 py-3 ${compact ? '' : 'border-t border-[var(--room-hair)]'}`}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--room-paper)]">Sevens notifications</span>
        <span className="block text-[12px] text-[var(--room-faint)]">
          {enabled
            ? 'On for this device: a ping when a Seven is dropped, and a reminder every 3 days while it\'s your turn.'
            : 'A ping when a partner drops a Seven, and a reminder every 3 days while it\'s your turn.'}
        </span>
        {blocker && !enabled && <span className="room-mono mt-1 block text-[var(--room-faint)]">{blocker}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-pressed={enabled}
        disabled={busy || (!enabled && !supported)}
        onClick={toggle}
        aria-label={enabled ? 'Turn Sevens notifications off' : 'Turn Sevens notifications on'}
        className="ui-word shrink-0"
      >
        {busy ? 'Working' : enabled ? 'On' : 'Off'}
      </button>
    </div>
  );
}
