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
      albums: [],
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

      // --- PINNED SANDBOX STATE ---
      pinnedItems: [], 
      togglePin: (id, type) => set((state) => {
        const isPinned = state.pinnedItems.some(item => item.id === id);
        if (isPinned) {
          return { pinnedItems: state.pinnedItems.filter(item => item.id !== id) };
        } else {
          return { pinnedItems: [...state.pinnedItems, { id, type }] };
        }
      }),

      createFolder: (name) => set((state) => ({ 
        customFolders: [...state.customFolders, { id: `folder-${Date.now()}`, name, playlistIds: [] }] 
      })),
      
      deleteFolder: (folderId) => set((state) => ({ 
        customFolders: state.customFolders.filter(f => f.id !== folderId),
        pinnedItems: state.pinnedItems.filter(p => p.id !== folderId) // Remove from pins if deleted
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

      deletePlaylist: (playlistId) => set((state) => ({
        playlists: state.playlists.filter(p => p.id !== playlistId),
        customFolders: state.customFolders.map(f => ({
          ...f,
          playlistIds: f.playlistIds.filter(id => id !== playlistId)
        })),
        pinnedItems: state.pinnedItems.filter(p => p.id !== playlistId), // Remove from pins if deleted
        activePlaylistId: state.activePlaylistId === playlistId ? null : state.activePlaylistId,
        currentView: state.activePlaylistId === playlistId ? 'library' : state.currentView
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

      updatePlaylistImage: (playlistId, newImageUrl) => set((state) => ({
        playlists: state.playlists.map((pl) =>
          pl.id === playlistId
            ? { ...pl, images: [{ url: newImageUrl }] }
            : pl
        ),
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
        albums: [],
        pinnedItems: [],
        currentView: 'home',
        viewHistory: [],
        activeFolderId: null
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
      queueOrder: [],
      setQueueOrder: (order) => set((state) => ({
        queueOrder: typeof order === 'function' ? order(state.queueOrder) : order
      })),
      setQueueData: (data) => set((state) => ({
        queueData: typeof data === 'function' ? data(state.queueData) : data
      })),
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
      setAlbums: (albumData) => set({ albums: albumData }),
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
      setLikedTracks: (updates) => set((state) => ({ likedTracks: { ...state.likedTracks, ...updates } })),
      setApiCooldown: (timestamp) => set({ apiCooldownUntil: timestamp }),
      toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
      setContextMenu: (menuData) => set({ contextMenu: menuData }),
      toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),
      setSavedVolume: (vol) => set({ savedVolume: vol }),

      setCurrentView: (view) => set((state) => {
        if (state.currentView === view) return {}; 
        return {
          viewHistory: [...state.viewHistory, {
            view: state.currentView,
            playlistId: state.activePlaylistId,
            artistId: state.currentArtistId,
            albumId: state.currentAlbumId,
            folderId: state.activeFolderId 
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
          activeFolderId: prev.folderId 
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
        libraryGridSize: state.libraryGridSize,
        pinnedItems: state.pinnedItems, // SAVES YOUR SANDBOX
        queueOrder: state.queueOrder,
        manuallyQueuedTracks: state.manuallyQueuedTracks
      }), 
    }
  )
);