import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useUserStore } from '../store/userStore';

const GROUPS = [
  { title: 'Playback', keys: [['Space', 'Play or pause'], ['→ / ←', 'Seek 10 seconds'], ['Ctrl/⌘ →', 'Next song'], ['Ctrl/⌘ ←', 'Previous song'], ['↑ / ↓', 'Volume'], ['M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat'], ['L', 'Like the song playing']] },
  { title: 'Around the app', keys: [['Ctrl/⌘ K', 'Search'], ['Q', 'Queue'], ['Z', 'Zen mode'], ['Alt ←', 'Back'], ['Esc', 'Close a menu or dialog'], ['?', 'This sheet']] },
  { title: 'In Zen mode', keys: [['P', 'Projector'], ['E', 'Projector editor'], ['G', 'Alignment grid']] }
];

// The cheat sheet behind "?"; the shortcuts themselves live in PlayerBar and MainLayout
export default function ShortcutsHelp() {
  const open = useUserStore((s) => s.isShortcutsOpen);
  const setOpen = useUserStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 py-6 bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="w-full max-w-2xl rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 id="shortcuts-title" className="text-xl font-bold text-white">Keyboard shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors p-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 grid gap-6 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 mb-3">{g.title}</p>
              <dl className="space-y-2">
                {g.keys.map(([k, what]) => (
                  <div key={k} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-neutral-300">{what}</dt>
                    <dd><kbd className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-white whitespace-nowrap">{k}</kbd></dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
