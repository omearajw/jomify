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
      apiCooldownUntil: null, 
      activePlaylistId: null,
      currentArtistId: null,
      currentAlbumId: null,
      likedTracks: {}, 
      isQueueOpen: false,
      contextMenu: null,
      isZenMode: false,
      savedVolume: 50,
      
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

      // NEW: Queue Sync Trigger
      queueRefreshTrigger: 0,
      triggerQueueRefresh: () => set((state) => ({ queueRefreshTrigger: state.queueRefreshTrigger + 1 })),

      // NEW: Smart memory for manually queued tracks
      manuallyQueuedTracks: [],
      addManuallyQueuedTrack: (track) => set((state) => ({
        manuallyQueuedTracks: [...state.manuallyQueuedTracks, track]
      })),
      
      // NEW: Consumes the track using a robust fuzzy match
      consumeManuallyQueuedTrack: (playingTrack) => set((state) => {
        if (!playingTrack) return state;
        
        const index = state.manuallyQueuedTracks.findIndex(t => 
          t.id === playingTrack.id || 
          t.uri === playingTrack.uri ||
          // Strip away " - Remastered" or "(Radio Edit)" to find the core song name
          (t.name.split(/[-(]/)[0].trim().toLowerCase() === playingTrack.name.split(/[-(]/)[0].trim().toLowerCase() &&
           t.artists?.[0]?.name === playingTrack.artists?.[0]?.name)
        );
        
        if (index > -1) {
          const newTracks = [...state.manuallyQueuedTracks];
          newTracks.splice(index, 1);
          return { manuallyQueuedTracks: newTracks };
        }
        return state;
      }),

      queueData: null,
      setQueueData: (data) => set({ queueData: data }),
      injectOptimisticQueueItem: (track) => set((state) => {
        if (!state.queueData) return state;
        return {
          queueData: {
            ...state.queueData,
            queue: [track, ...state.queueData.queue] // Instantly pushes track to the top
          }
        };
      }),

      setProfile: (userData) => set({ profile: userData }),
      setPlaylists: (playlistData) => set({ playlists: playlistData }),
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
      setLikedTracks: (updates) => set((state) => ({ 
      setApiCooldown: (timestamp) => set({ apiCooldownUntil: timestamp }),
      toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
      setContextMenu: (menuData) => set({ contextMenu: menuData }),
      toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),
      setSavedVolume: (vol) => set({ savedVolume: vol }),
        likedTracks: { ...state.likedTracks, ...updates } 
      })),

      setCurrentView: (view) => set((state) => {
        if (state.currentView === view) return {}; 
        return {
          viewHistory: [...state.viewHistory, state.currentView],
          currentView: view
        };
      }),

      navigateToArtist: (artistId) => set((state) => ({
        viewHistory: [...state.viewHistory, state.currentView],
        currentView: 'artist',
        currentArtistId: artistId
      })),

      navigateToAlbum: (albumId) => set((state) => ({
        viewHistory: [...state.viewHistory, state.currentView],
        currentView: 'album',
        currentAlbumId: albumId
      })),
      
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
        tokenExpiresAt: state.tokenExpiresAt,
        savedVolume: state.savedVolume
      }), 
    }
  )
);