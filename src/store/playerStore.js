import { create } from 'zustand';

export const usePlayerStore = create((set) => ({
  player: null,          
  deviceId: null,        
  playbackState: null,   
  isShuffled: false, // NEW: Dedicated local shuffle state
  
  setPlayer: (playerInstance) => set({ player: playerInstance }),
  setDeviceId: (id) => set({ deviceId: id }),
  
  setPlaybackState: (state) => set({ 
    playbackState: state,
    // FIX: The SDK payload property is 'shuffle', not 'shuffle_state'
    isShuffled: state.shuffle 
  }),
  
  // NEW: Instantly flip the UI state without waiting for the server
  toggleOptimisticShuffle: () => set((state) => ({ isShuffled: !state.isShuffled })),
}));