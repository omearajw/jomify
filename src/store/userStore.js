import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUserStore = create(
  persist(
    (set) => ({
      token: null,
      tokenExpiresAt: null, // NEW: Tracks when the token dies
      profile: null,
      playlists: [],
      currentView: 'home', 
      viewHistory: [], 
      activePlaylistId: null,
      likedTracks: {}, 
      
      // NEW: Sets the token AND a 1-hour expiration timer
      setToken: (newToken) => set({ 
        token: newToken,
        tokenExpiresAt: Date.now() + (3600 * 1000) // Current time + 1 hour in milliseconds
      }),

      // NEW: A clean wipe function to reset the app
      logout: () => set({ 
        token: null, 
        tokenExpiresAt: null, 
        profile: null, 
        playlists: [],
        currentView: 'home',
        viewHistory: []
      }),

      setProfile: (userData) => set({ profile: userData }),
      setPlaylists: (playlistData) => set({ playlists: playlistData }),
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
      setLikedTracks: (updates) => set((state) => ({ 
        likedTracks: { ...state.likedTracks, ...updates } 
      })),

      setCurrentView: (view) => set((state) => {
        if (state.currentView === view) return {}; 
        return {
          viewHistory: [...state.viewHistory, state.currentView],
          currentView: view
        };
      }),
      
      goBack: () => set((state) => {
        if (state.viewHistory.length === 0) return {};
        const newHistory = [...state.viewHistory];
        const prevView = newHistory.pop();
        return {
          viewHistory: newHistory,
          currentView: prevView
        };
      }),
    }),
    {
      name: 'jomify-storage',
      // Ensure we save BOTH the token and its death-clock
      partialize: (state) => ({ 
        token: state.token, 
        tokenExpiresAt: state.tokenExpiresAt 
      }), 
    }
  )
);