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
        className="ui-plane group inline-flex min-h-[44px] items-center px-4 md:min-h-[34px]"
      >
        <span className="ui-word group-hover:text-[var(--room-paper)] group-hover:decoration-[var(--room-paper)]">Demo</span>
      </button>
      {open && (
        <div role="dialog" aria-label="About the demo" className="ui-plane absolute right-0 mt-1 w-72 max-w-[calc(100vw-32px)] p-5 text-[13px] text-[var(--room-dim)]">
          <p className="text-[15px] font-semibold text-[var(--room-paper)]">You're looking around Jomify</p>
          <p className="mt-2">Everything works on a made-up library of real albums. Playback is silent: Spotify only plays music to a signed-in Premium account. Lyrics, Zen and the rest are real.</p>
          <p className="mt-2">Nothing you change is saved; it all resets when you close the tab.</p>
          <button
            type="button"
            onClick={exitDemo}
            className="ui-pill mt-5 min-h-[40px] w-full"
          >
            Sign in with Spotify
          </button>
        </div>
      )}
    </div>
  );
}
