import { useEffect, useRef } from 'react';
import { subscribeLevels, useWaveSource, MAX_BARS } from '../../audio/levels';
import { usePlayerStore } from '../../store/playerStore';

// What the lyrics panel shows when a song has none: a wide, mirrored glass waveform with the bass in
// the middle and the treble out to the edges, and a quiet line beneath. It follows the real levels
// when there are any (Spotify's analysis, or the microphone) and drifts on its own otherwise, so
// Zen mode never stops on an error message.

const BARS = 48;

function drift(t, j, dist, playing) {
  if (!playing) return 0.06 + 0.03 * Math.sin(t * 0.8 + j * 0.3);
  const v = 0.34 + 0.22 * Math.sin(t * 1.9 + j * 0.42) + 0.16 * Math.sin(t * 3.1 - j * 0.27) + 0.1 * Math.sin(t * 0.7 + j * 1.3);
  return v * (1 - 0.55 * dist);
}

export default function AmbientWave({ caption = 'No words for this one. Just listen.', variant = 'zen' }) {
  const bars = useRef([]);
  const source = useWaveSource();
  const live = useRef(source);
  useEffect(() => { live.current = source; }, [source]);

  useEffect(() => subscribeLevels((levels) => {
    const t = performance.now() / 1000;
    const playing = usePlayerStore.getState().playbackState?.paused === false;
    const centre = (BARS - 1) / 2;
    for (let j = 0; j < BARS; j++) {
      const el = bars.current[j];
      if (!el) continue;
      const dist = Math.abs(j - centre) / centre;
      let v;
      if (live.current) {
        const band = dist * (MAX_BARS - 1);
        const lo = Math.floor(band);
        const frac = band - lo;
        v = ((levels[lo] || 0) * (1 - frac) + (levels[Math.min(MAX_BARS - 1, lo + 1)] || 0) * frac) * (1.15 - 0.45 * dist);
      } else {
        v = drift(t, j, dist, playing);
      }
      el.style.transform = `scaleY(${Math.max(0.04, Math.min(1, v)).toFixed(3)})`;
    }
  }), []);

  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center gap-8 px-6" aria-label={caption}>
      <div className={`relative w-full ${variant === 'zen' ? 'max-w-3xl h-56 md:h-72' : 'max-w-4xl h-48 md:h-64'}`}>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-between gap-[3px]">
          {Array.from({ length: BARS }, (_, j) => (
            <div
              key={j}
              ref={(el) => { bars.current[j] = el; }}
              className="flex-1 h-full rounded-full origin-center will-change-transform"
              style={{
                transform: 'scaleY(0.06)',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.75) 30%, rgba(255,255,255,0.95) 50%, color-mix(in srgb, var(--brand-mid) 60%, transparent) 70%, transparent 100%)',
                boxShadow: '0 0 18px rgba(255,255,255,0.12)'
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.35em] text-white/45 text-center">{caption}</p>
    </div>
  );
}
