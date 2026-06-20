import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUserStore = create(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      tokenExpiresAt: null,
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
      
      // --- CUSTOM FOLDER ENGINE ---
      customFolders: [], 
      activeFolderId: null,
      libraryGridSize: 'medium',
      
      setLibraryGridSize: (size) => set({ libraryGridSize: size }),
      setActiveFolderId: (folderId) => set({ activeFolderId: folderId }),

      // --- GLOBAL DRAG AND DROP STATE ---
      draggedItem: null, 
      setDraggedItem: (item) => set({ draggedItem: item }),

      createFolder: (name) => set((state) => ({ 
        customFolders: [...state.customFolders, { id: `folder-${Date.now()}`, name, playlistIds: [] }] 
      })),
      
      deleteFolder: (folderId) => set((state) => ({ 
        customFolders: state.customFolders.filter(f => f.id !== folderId) 
      })),
      
      addPlaylistToFolder: (folderId, playlistId) => set((state) => ({
        customFolders: state.customFolders.map(f => {
          if (f.id === folderId) return { ...f, playlistIds: [...new Set([...f.playlistIds, playlistId])] };
          return { ...f, playlistIds: f.playlistIds.filter(id => id !== playlistId) };
        })
      })),
      
      removePlaylistFromFolder: (folderId, playlistId) => set((state) => ({
        customFolders: state.customFolders.map(f => 
          f.id === folderId ? { ...f, playlistIds: f.playlistIds.filter(id => id !== playlistId) } : f
        )
      })),

      reorderFolders: (dragId, dropId) => set((state) => {
        const newFolders = [...state.customFolders];
        const dragIndex = newFolders.findIndex(f => f.id === dragId);
        const dropIndex = newFolders.findIndex(f => f.id === dropId);
        if (dragIndex === -1 || dropIndex === -1) return state;
        
        const [draggedItem] = newFolders.splice(dragIndex, 1);
        newFolders.splice(dropIndex, 0, draggedItem);
        return { customFolders: newFolders };
      }),

      reorderPlaylistInFolder: (folderId, dragId, dropId) => set((state) => ({
        customFolders: state.customFolders.map(f => {
          if (f.id !== folderId) return f;
          const newIds = [...f.playlistIds];
          const dragIndex = newIds.indexOf(dragId);
          const dropIndex = newIds.indexOf(dropId);
          if (dragIndex === -1 || dropIndex === -1) return f;
          
          const [draggedItem] = newIds.splice(dragIndex, 1);
          newIds.splice(dropIndex, 0, draggedItem);
          return { ...f, playlistIds: newIds };
        })
      })),
      
      setToken: (newToken) => set({ 
        token: newToken,
        tokenExpiresAt: Date.now() + (3600 * 1000) 
      }),

      setRefreshToken: (newRefreshToken) => set({
        refreshToken: newRefreshToken
      }),

      logout: () => set({ 
        token: null, 
        refreshToken: null,
        tokenExpiresAt: null, 
        profile: null, 
        playlists: [],
        currentView: 'home',
        viewHistory: [],
        activeFolderId: null
        // Notice customFolders is explicitly excluded here so they are permanent!
      }),

      queueRefreshTrigger: 0,
      triggerQueueRefresh: () => set((state) => ({ queueRefreshTrigger: state.queueRefreshTrigger + 1 })),

      manuallyQueuedTracks: [],
      addManuallyQueuedTrack: (track) => set((state) => ({
        manuallyQueuedTracks: [...state.manuallyQueuedTracks, track]
      })),
      
      consumeManuallyQueuedTrack: (playingTrack) => set((state) => {
        if (!playingTrack) return state;
        const index = state.manuallyQueuedTracks.findIndex(t => 
          t.id === playingTrack.id || 
          t.uri === playingTrack.uri ||
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
            queue: [track, ...state.queueData.queue] 
          }
        };
      }),

      setProfile: (userData) => set({ profile: userData }),
      setPlaylists: (playlistData) => set({ playlists: playlistData }),
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
      setLikedTracks: (updates) => set((state) => ({ likedTracks: { ...state.likedTracks, ...updates } })),
      setApiCooldown: (timestamp) => set({ apiCooldownUntil: timestamp }),
      toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
      setContextMenu: (menuData) => set({ contextMenu: menuData }),
      toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),
      setSavedVolume: (vol) => set({ savedVolume: vol }),

      // --- NAVIGATION BUG FIX: State Snapshots ---
      setCurrentView: (view) => set((state) => {
        if (state.currentView === view) return {}; 
        return {
          viewHistory: [...state.viewHistory, {
            view: state.currentView,
            playlistId: state.activePlaylistId,
            artistId: state.currentArtistId,
            albumId: state.currentAlbumId,
            folderId: state.activeFolderId // Takes a snapshot of the exact folder you were in
          }],
          currentView: view
        };
      }),

      navigateToArtist: (artistId) => set((state) => ({
        viewHistory: [...state.viewHistory, { view: state.currentView, playlistId: state.activePlaylistId, artistId: state.currentArtistId, albumId: state.currentAlbumId, folderId: state.activeFolderId }],
        currentView: 'artist',
        currentArtistId: artistId
      })),

      navigateToAlbum: (albumId) => set((state) => ({
        viewHistory: [...state.viewHistory, { view: state.currentView, playlistId: state.activePlaylistId, artistId: state.currentArtistId, albumId: state.currentAlbumId, folderId: state.activeFolderId }],
        currentView: 'album',
        currentAlbumId: albumId
      })),
      
      goBack: () => set((state) => {
        if (state.viewHistory.length === 0) return {};
        const newHistory = [...state.viewHistory];
        const prev = newHistory.pop();
        return {
          viewHistory: newHistory,
          currentView: prev.view,
          activePlaylistId: prev.playlistId,
          currentArtistId: prev.artistId,
          currentAlbumId: prev.albumId,
          activeFolderId: prev.folderId // Restores the folder perfectly
        };
      }),
    }),
    {
      name: 'jomify-storage',
      partialize: (state) => ({ 
        token: state.token, 
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        savedVolume: state.savedVolume,
        customFolders: state.customFolders, 
        libraryGridSize: state.libraryGridSize
      }), 
    }
  )
);