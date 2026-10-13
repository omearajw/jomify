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

const newInstanceId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export const useQueueStore = create(persist((set) => ({
  items: [],
  // this install, for the lease on carrying out the queue
  instanceId: newInstanceId(),
  add: (tracks) => set((s) => ({ items: [...s.items, ...(Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t?.uri).map(slimTrack)] })),
  addNext: (tracks) => set((s) => ({ items: [...(Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t?.uri).map(slimTrack), ...s.items] })),
  remove: (key) => set((s) => ({ items: removeKey(s.items, key) })),
  move: (key, toIndex) => set((s) => ({ items: moveKey(s.items, key, toIndex) })),
  clear: () => set({ items: [] })
}), {
  name: 'jomify-queue',
  version: 1,
  partialize: (s) => ({ items: s.items, instanceId: s.instanceId }),
  merge: (persisted, current) => {
    const items = persisted?.items?.length ? persisted.items : manualFromOldStore();
    return { ...current, items, instanceId: persisted?.instanceId || current.instanceId };
  }
}));
