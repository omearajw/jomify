import { Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { toggleShuffle, cycleRepeat } from '../services/spotify/playbackController';

// Shuffle and repeat as plain switches (Jack, 21 Oct): a press flips the mode and plays nothing;
// Play then follows it. On shows plainly, the icon bright with a dot under it, because a brighter
// icon alone was hard to read on a playlist page.

const Dot = ({ on }) => <span aria-hidden="true" className={`absolute -bottom-[7px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[var(--room-paper)] transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />;

export function ShuffleToggle({ size = 18, className = '' }) {
  const on = usePlayerStore((s) => s.isShuffled);
  return (
    <button type="button" onClick={() => toggleShuffle()} aria-pressed={on} aria-label={on ? 'Shuffle: on' : 'Shuffle: off'} title={on ? 'Shuffle: on' : 'Shuffle: off'}
      className={`room-press relative grid place-items-center transition-colors ${on ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'} ${className}`}>
      <Shuffle style={{ width: size, height: size }} />
      <Dot on={on} />
    </button>
  );
}

export function RepeatToggle({ size = 18, className = '' }) {
  const mode = usePlayerStore((s) => s.repeatMode);
  const label = mode === 2 ? 'Repeat: this song' : mode === 1 ? 'Repeat: on' : 'Repeat: off';
  const Icon = mode === 2 ? Repeat1 : Repeat;
  return (
    <button type="button" onClick={() => cycleRepeat()} aria-pressed={mode !== 0} aria-label={label} title={label}
      className={`room-press relative grid place-items-center transition-colors ${mode ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'} ${className}`}>
      <Icon style={{ width: size, height: size }} />
      <Dot on={mode !== 0} />
    </button>
  );
}
