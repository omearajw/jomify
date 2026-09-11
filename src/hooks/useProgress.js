import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';

// Current position of the playing track, ticking once a second between state updates. Remote
// state only arrives every few seconds, so the position is interpolated from the moment it was
// captured rather than from the last event alone.
export function useProgress() {
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionAt = usePlayerStore((s) => s.positionAt);
  const paused = playbackState?.paused ?? true;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const duration = playbackState?.duration ?? 0;
  const base = playbackState?.position ?? 0;
  const elapsed = paused ? 0 : Math.max(0, Math.max(now, positionAt) - positionAt);
  const position = duration ? Math.min(duration, base + elapsed) : base + elapsed;

  return { position, duration, paused, track: playbackState?.track_window?.current_track ?? null };
}
