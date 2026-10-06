import { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { setSleepTimer } from '../services/spotify/playbackController';

const OPTIONS = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '45 minutes', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: 'End of this song', song: true }
];

const timerFor = (option) => (option ? (option.song ? { atSongEnd: true } : { until: Date.now() + option.minutes * 60000 }) : null);

const describe = (timer, now) => {
  if (!timer) return '';
  if (timer.atSongEnd) return 'End of song';
  const left = Math.max(0, Math.round((timer.until - now) / 60000));
  return left <= 1 ? 'Under a minute' : `${left} min`;
};

// A moon button with a small picker: pause after a while, or when the song ends. Lit while set.
export default function SleepTimer({ className = '', buttonClass = '' }) {
  const timer = usePlayerStore((s) => s.sleepTimer);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(null);

  useEffect(() => {
    if (!timer?.until) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [timer?.until]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (option) => {
    setSleepTimer(timerFor(option));
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={timer ? `Sleep timer: ${describe(timer, now)}` : 'Sleep timer'}
        title={timer ? `Sleep timer: ${describe(timer, now)}` : 'Sleep timer'}
        className={`${buttonClass} ${timer ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : ''}`}
      >
        <Moon className="w-5 h-5" />
        {timer && <span className="sr-only">{describe(timer, now)}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full right-0 mb-2 w-52 rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl py-2 z-[9500]">
          <p className="px-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">Sleep timer{timer ? ` · ${describe(timer, now)}` : ''}</p>
          {OPTIONS.map((o) => (
            <button key={o.label} type="button" role="menuitem" onClick={() => pick(o)} className="w-full px-4 py-2.5 text-left text-sm font-medium text-white hover:bg-white/5">
              {o.label}
            </button>
          ))}
          {timer && (
            <button type="button" role="menuitem" onClick={() => pick(null)} className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-300 hover:bg-white/5 border-t border-white/5 mt-1">
              Turn off
            </button>
          )}
        </div>
      )}
    </div>
  );
}
