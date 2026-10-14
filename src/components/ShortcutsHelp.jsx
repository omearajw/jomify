import { useEffect } from 'react';
import { createPortal } from 'react-dom';
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4 py-6" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="ui-plane w-full max-w-2xl p-8">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="room-mono text-[var(--room-dim)]">Keyboard shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} className="ui-word">Close</button>
        </div>
        <div className="mt-6 grid gap-8 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="room-mono mb-1 text-[var(--room-faint)]">{g.title}</p>
              <dl>
                {g.keys.map(([k, what]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-t border-[var(--room-hair)] py-2 text-[13px]">
                    <dt className="text-[var(--room-dim)]">{what}</dt>
                    <dd className="room-mono whitespace-nowrap text-[var(--room-paper)]">{k}</dd>
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
