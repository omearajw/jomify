import { create } from 'zustand';

// Sync status only. Deliberately NOT persisted -- it describes this session's connection to the
// sync API, and a stale "Synced 2m ago" restored from localStorage would be a lie.
//
// Modelled on playerStore.js, which is likewise ephemeral.
export const useSyncStore = create((set) => ({
  // 'idle' | 'pulling' | 'pushing' | 'synced' | 'offline' | 'error' | 'disabled'
  status: 'idle',
  lastSyncedAt: null,
  errorMessage: null,
  // When the current run of failures began, so the UI can stay quiet about a brief blip but
  // escalate to a banner once sync has genuinely been broken for a while.
  failingSince: null,
  pendingChanges: false,
  // { localFolders, remoteFolders } while a first-sync choice is waiting on the user
  firstSyncConflict: null,

  setFirstSyncConflict: (firstSyncConflict) => set({ firstSyncConflict }),

  setStatus: (status, errorMessage = null) => set((state) => {
    const isFailure = status === 'error' || status === 'offline';
    return {
      status,
      errorMessage,
      failingSince: isFailure ? (state.failingSince ?? Date.now()) : null
    };
  }),

  markSynced: () => set({
    status: 'synced',
    lastSyncedAt: Date.now(),
    errorMessage: null,
    failingSince: null,
    pendingChanges: false
  }),

  setPendingChanges: (pendingChanges) => set({ pendingChanges })
}));
