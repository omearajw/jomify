import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

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
        className="flex items-center gap-2 rounded-full bg-neutral-900/95 border border-white/10 px-4 py-2 text-sm font-semibold text-white shadow-2xl backdrop-blur-md hover:bg-neutral-800 transition-colors"
      >
        <RefreshCw className="w-4 h-4 text-brand-gradient" />
        Update ready · Reload
      </button>
    </div>
  );
}
