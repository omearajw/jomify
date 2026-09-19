import { useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
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
  const Icon = enabled ? Bell : BellOff;

  return (
    <div className={compact ? '' : 'rounded-2xl border border-white/10 bg-white/5 p-4'}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 shrink-0 ${enabled ? 'text-[var(--brand-mid)]' : 'text-neutral-400'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Sevens notifications</p>
          <p className="text-xs text-neutral-400">
            {enabled
              ? 'On for this device: a ping when a Seven is dropped, and a reminder every 3 days while it\'s your turn.'
              : 'Get a ping when a partner drops a Seven, and a reminder every 3 days while it\'s your turn.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy || (!enabled && !supported)}
          onClick={toggle}
          aria-label={enabled ? 'Turn Sevens notifications off' : 'Turn Sevens notifications on'}
          className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${enabled ? 'bg-[var(--brand-mid)]' : 'bg-neutral-700'}`}
        >
          {busy
            ? <Loader2 className="w-4 h-4 animate-spin text-white absolute top-1.5 left-4" />
            : <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />}
        </button>
      </div>
      {blocker && !enabled && <p className="text-xs text-amber-300 mt-2">{blocker}</p>}
    </div>
  );
}
