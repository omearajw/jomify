import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { slimTrack, removeKey, moveKey, migrateManual } from '../services/queueLogic';

// Jomify's queue: the songs added by hand, in the order they will play, held by Jomify rather than
// Spotify (see services/queueLogic.js). Persisted, so it outlives a reload and a lost device.

// The hand-queued songs the old store kept, taken over once
function manualFromOldStore() {
  try {
    const raw = localStorage.getItem('jomify-storage');
    const list = raw ? JSON.parse(raw)?.state?.manuallyQueuedTracks : null;
    return migrateManual(list);
  } catch { return []; }
}

export const useQueueStore = create(persist((set) => ({
  items: [],
  add: (tracks) => set((s) => ({ items: [...s.items, ...(Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t?.uri).map(slimTrack)] })),
  addNext: (tracks) => set((s) => ({ items: [...(Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t?.uri).map(slimTrack), ...s.items] })),
  remove: (key) => set((s) => ({ items: removeKey(s.items, key) })),
  move: (key, toIndex) => set((s) => ({ items: moveKey(s.items, key, toIndex) })),
  clear: () => set({ items: [] })
}), {
  name: 'jomify-queue',
  version: 1,
  partialize: (s) => ({ items: s.items }),
  merge: (persisted, current) => {
    const items = persisted?.items?.length ? persisted.items : manualFromOldStore();
    return { ...current, items };
  }
}));
