import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Registers the worker and offers the reload when a new build is waiting. Reloading is the
// user's call because it stops in-browser playback.
export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError(err) { console.warn('[pwa] service worker registration failed:', err); }
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] z-[8500] animate-fade-in">
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        aria-label="Update ready · Reload"
        className="ui-plane group flex min-h-[44px] items-center gap-5 px-5 py-2.5 text-[13px]"
      >
        Update ready
        <span className="ui-word group-hover:text-[var(--room-paper)] group-hover:decoration-[var(--room-paper)]">Reload</span>
      </button>
    </div>
  );
}

// On the sign-in page there is nothing playing and nothing to lose, so a waiting build is taken at
// once rather than offered: without this a signed-out device kept showing the copy it had saved,
// with no pill to reach (the pill lives in the signed-in app), until the app was fully quit (Jack,
// 19 Oct: the old sign-in page after the new one shipped). It also looks for a new build each time
// the page comes back into view, since a sign-in page can sit open for days.
export function SignedOutUpdater() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
    },
    onRegisterError(err) { console.warn('[pwa] service worker registration failed:', err); }
  });
  useEffect(() => { if (needRefresh) updateServiceWorker(true); }, [needRefresh, updateServiceWorker]);
  return null;
}
