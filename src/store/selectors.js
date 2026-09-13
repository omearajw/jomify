import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from './playerStore';

// `const { a, b } = useStore()` subscribes to the whole store, so every unrelated set() re-renders
// the component. Picking named keys with a shallow compare keeps the destructuring style while
// only re-rendering when one of those values actually changes. Actions are stable references.
export function useSlice(store, keys) {
  return store(useShallow((state) => {
    const out = {};
    for (const key of keys) out[key] = state[key];
    return out;
  }));
}

// What a list screen needs to highlight the playing row. The remote poller replaces
// playbackState every few seconds; this only changes when the track or the paused flag does
// (the adapter keeps the track object identity across polls).
export function usePlaybackSummary() {
  return usePlayerStore(useShallow((s) => ({
    currentPlayingTrack: s.playbackState?.track_window?.current_track ?? null,
    isCurrentTrackPaused: s.playbackState?.paused ?? true
  })));
}
