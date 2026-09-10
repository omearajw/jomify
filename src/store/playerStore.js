import { create } from 'zustand';

export const usePlayerStore = create((set) => ({
  player: null,          
  deviceId: null,        
  playbackState: null,   
  isShuffled: false, // NEW: Dedicated local shuffle state
  
  setPlayer: (playerInstance) => set({ player: playerInstance }),
  setDeviceId: (id) => set({ deviceId: id }),
  
  // True between an optimistic shuffle flip and Spotify's acknowledgement. While it's set, SDK
  // state events must not overwrite isShuffled -- a stale event landing mid-flight made the
  // button visibly bounce.
  shufflePending: false,

  setPlaybackState: (state) => set((current) => ({
    playbackState: state,
    // The SDK payload property is 'shuffle', not 'shuffle_state'
    isShuffled: current.shufflePending ? current.isShuffled : state.shuffle
  })),

  setShuffle: (value) => set({ isShuffled: Boolean(value) }),
  setShufflePending: (pending) => set({ shufflePending: Boolean(pending) }),

  // Kept for callers that still use the old name; prefer setShuffle + setShufflePending so a
  // failure can restore the real previous value instead of blindly flipping again.
  toggleOptimisticShuffle: () => set((state) => ({ isShuffled: !state.isShuffled })),
}));