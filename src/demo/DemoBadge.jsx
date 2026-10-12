import { useEffect, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { exitDemo } from './boot';

// A small, quiet marker that this is the demo: what is different, and the way out. Signing out
// inside the demo leaves it too, rather than landing on an empty sign-in page with the demo
// still set up behind it.
export default function DemoBadge() {
  const token = useUserStore((s) => s.token);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!token) exitDemo(); }, [token]);

  return (
    <div className="fixed z-[90] top-[calc(env(safe-area-inset-top)+10px)] left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-black/70 backdrop-blur-md border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-black/85 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand-mid)]" aria-hidden="true" />
        Demo
      </button>
      {open && (
        <div role="dialog" aria-label="About the demo" className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-32px)] rounded-2xl bg-neutral-950/95 backdrop-blur-md border border-white/10 p-4 text-sm text-neutral-300 shadow-2xl">
          <p className="font-semibold text-white">You're looking around Jomify</p>
          <p className="mt-2">Everything works on a made-up library of real albums. Playback is silent: Spotify only plays music to a signed-in Premium account. Lyrics, Zen and the rest are real.</p>
          <p className="mt-2">Nothing you change is saved; it all resets when you close the tab.</p>
          <button
            type="button"
            onClick={exitDemo}
            className="mt-4 w-full rounded-full bg-brand-gradient py-2 font-bold text-white"
          >
            Sign in with Spotify
          </button>
        </div>
      )}
    </div>
  );
}
