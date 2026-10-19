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
