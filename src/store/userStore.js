import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { markFolderDeleted } from '../sync/meta';

// Folders carry a sparse numeric `order` rather than relying on array position, so that a
// reorder on one device touches exactly one folder and can be merged without disturbing
// concurrent edits to the others. The array is kept sorted by it, so every existing render site
// that iterates customFolders keeps working unchanged.
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1);

// One place that knows what a history frame looks like. Capped so bouncing between two views
// all afternoon doesn't grow the stack without bound.
const HISTORY_CAP = 50;
const pushHistory = (state) => [
  ...state.viewHistory,
  {
    view: state.currentView,
    playlistId: state.activePlaylistId,
    artistId: state.currentArtistId,
    albumId: state.currentAlbumId,
    folderId: state.activeFolderId
  }
].slice(-HISTORY_CAP);

export const useUserStore = create(
  subscribeWithSelector(persist(
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
      stagedSeven: [],
      
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

      // --- THE SEVENS ENGINE ---
      // Each entry: { playlistId, partnerId, partnerName, partnerLocked, active, poolPlaylistId }
      // `active` false means the Seven is finished: it is still cross-referenced for duplicate
      // tracks, but it never prompts you that it is your turn.
      sevens: [],
      sevensSeeded: false,

      addSeven: (playlistId) => set((state) => {
        if (!playlistId || state.sevens.some(s => s.playlistId === playlistId)) return state;
        return {
          sevens: [...state.sevens, {
            playlistId,
            partnerId: null,
            partnerName: null,
            partnerLocked: false,
            active: true,
            poolPlaylistId: ''
          }]
        };
      }),

      removeSeven: (playlistId) => set((state) => ({
        sevens: state.sevens.filter(s => s.playlistId !== playlistId)
      })),

      updateSeven: (playlistId, patch) => set((state) => ({
        sevens: state.sevens.map(s => s.playlistId === playlistId ? { ...s, ...patch } : s)
      })),

      // One-time migration for the Sevens that used to be hardcoded in App.jsx
      seedLegacySevens: (legacyIds, legacyPoolPlaylistId) => set((state) => {
        if (state.sevensSeeded) return state;
        const existing = new Set(state.sevens.map(s => s.playlistId));
        const seeded = legacyIds
          .filter(id => !existing.has(id))
          .map(id => ({
            playlistId: id,
            partnerId: null,
            partnerName: null,
            partnerLocked: false,
            active: true,
            poolPlaylistId: legacyPoolPlaylistId || ''
          }));
        return { sevens: [...state.sevens, ...seeded], sevensSeeded: true };
      }),

      createFolder: (name) => set((state) => {
        const highestOrder = state.customFolders.reduce((max, f) => Math.max(max, f.order ?? 0), 0);
        return {
          customFolders: [...state.customFolders, {
            // The random suffix matters: Date.now() alone collides when two folders are created
            // in the same millisecond, and colliding ids make every folder action hit both.
            // It doubles as the sync id, so it must also be unique across devices.
            id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            playlistIds: [],
            parentId: null,      // reserved for nested folders; the UI is flat for now
            order: highestOrder + 1000
          }]
        };
      }),

      deleteFolder: (folderId) => {
        // THE ONLY TOMBSTONE MINT SITE IN THE APP. This is also the only code path anywhere that
        // removes a folder from customFolders, which is what lets the sync layer record deletions
        // explicitly instead of inferring them from a diff. Inference is the one way a false
        // tombstone could arise, and a false tombstone is the one bug that could delete real
        // folders on every device at once.
        markFolderDeleted(folderId);
        set((state) => ({
          customFolders: state.customFolders.filter(f => f.id !== folderId),
          pinnedItems: state.pinnedItems.filter(p => p.id !== folderId), // Remove from pins if deleted
          activeFolderId: state.activeFolderId === folderId ? null : state.activeFolderId,
          viewHistory: state.viewHistory.map(h => h.folderId === folderId ? { ...h, folderId: null } : h)
        }));
      },

      addStagedTrack: (track) => set((state) => {
        if (state.stagedSeven.length >= 7) return state;
        return { stagedSeven: [...state.stagedSeven, track] };
      }),
      
      removeStagedTrack: (uri) => set((state) => ({
        stagedSeven: state.stagedSeven.filter(t => t.uri !== uri)
      })),

      clearStagedTracks: () => set({ stagedSeven: [] }),

      setStagedSeven: (tracks) => set({ stagedSeven: tracks }),
      
      addPlaylistToFolder: (folderId, playlistId) => set((state) => ({
        customFolders: state.customFolders.map(f => {
          // Drop the item from any folder it already lives in so it never appears twice
          const withoutItem = { ...f, playlistIds: f.playlistIds.filter(id => id !== playlistId) };
          if (f.id !== folderId) return withoutItem;
          return { ...withoutItem, playlistIds: [...withoutItem.playlistIds, playlistId] };
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
        currentView: state.activePlaylistId === playlistId ? 'library' : state.currentView,
        // Otherwise Back after a delete lands on the dead playlist and fetches a 404
        viewHistory: state.viewHistory.filter(h => !(h.view === 'playlist' && h.playlistId === playlistId))
      })),

      reorderFolders: (dragId, dropId) => set((state) => {
        const newFolders = [...state.customFolders].sort(byOrder);
        const dragIndex = newFolders.findIndex(f => f.id === dragId);
        const dropIndex = newFolders.findIndex(f => f.id === dropId);
        if (dragIndex === -1 || dropIndex === -1 || dragIndex === dropIndex) return state;

        const [draggedItem] = newFolders.splice(dragIndex, 1);
        newFolders.splice(dropIndex, 0, draggedItem);

        // Give the moved folder an order between its new neighbours, so this reorder is a change
        // to one folder rather than a rewrite of the whole list.
        const before = newFolders[dropIndex - 1];
        const after = newFolders[dropIndex + 1];
        let order;
        if (!before) order = (after?.order ?? 1000) - 1000;
        else if (!after) order = (before.order ?? 0) + 1000;
        else order = ((before.order ?? 0) + (after.order ?? 0)) / 2;

        newFolders[dropIndex] = { ...draggedItem, order };

        // If repeated midpoints have squeezed the gaps shut, renumber. Rare, and treated as an
        // ordinary edit to every folder.
        const collapsed = newFolders.some((f, i) => i > 0 && Math.abs(f.order - newFolders[i - 1].order) < 0.001);
        if (collapsed) {
          return { customFolders: newFolders.map((f, i) => ({ ...f, order: (i + 1) * 1000 })) };
        }

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

      // Soft by default. logout() fires involuntarily when a token refresh fails or expires, and
      // wiping folders on a transient network blip is exactly the bug commit ea508a9 fixed. Only
      // a deliberate "Disconnect Account" passes { hard: true }, and the caller is responsible
      // for confirming the data is safely on the server first.
      logout: ({ hard = false } = {}) => set({
        token: null,
        refreshToken: null,
        tokenExpiresAt: null,
        profile: null,
        playlists: [],
        albums: [],
        currentView: 'home',
        viewHistory: [],
        activeFolderId: null,
        ...(hard ? {
          customFolders: [],
          pinnedItems: [],
          sevens: [],
          sevensSeeded: false,
          stagedSeven: [],
          playlistSortSettings: {},
          unaddedCheckPlaylists: [],
          likedTracks: {},
          manuallyQueuedTracks: []
        } : {})
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

      playlistSortSettings: {},
      setPlaylistSortSettings: (playlistId, settings) => set((state) => ({
        playlistSortSettings: { ...state.playlistSortSettings, [playlistId]: settings }
      })),

      // The "unadded songs" cross-check list. This used to live in its own localStorage key,
      // which meant it was the one piece of real user config the sync layer would have missed.
      unaddedCheckPlaylists: [],
      setUnaddedCheckPlaylists: (ids) => set((state) => ({
        unaddedCheckPlaylists: typeof ids === 'function' ? ids(state.unaddedCheckPlaylists) : ids
      })),

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
          viewHistory: pushHistory(state),
          currentView: view
        };
      }),

      navigateToArtist: (artistId) => set((state) => ({
        viewHistory: pushHistory(state),
        currentView: 'artist',
        currentArtistId: artistId
      })),

      navigateToAlbum: (albumId) => set((state) => ({
        viewHistory: pushHistory(state),
        currentView: 'album',
        currentAlbumId: albumId
      })),

      // Playlist navigation used to be `setActivePlaylistId(id); setCurrentView('playlist')` at
      // nine call sites. That never recorded history when already on a playlist (setCurrentView
      // early-returns for the same view), and even when it did, the frame captured the NEW id
      // because it was snapshotted after the overwrite. So Back from playlist to playlist did
      // nothing, everywhere. This pushes the frame first, then moves.
      navigateToPlaylist: (playlistId) => set((state) => {
        if (state.currentView === 'playlist' && state.activePlaylistId === playlistId) return {};
        return {
          viewHistory: pushHistory(state),
          currentView: 'playlist',
          activePlaylistId: playlistId
        };
      }),
      
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
      version: 1,

      // Zustand treats state stored without a version as version 0, so this runs exactly once on
      // an existing install. It only ever ADDS fields -- nothing here can remove a folder.
      migrate: (persisted, fromVersion) => {
        if (!persisted || fromVersion >= 1) return persisted;

        const folders = Array.isArray(persisted.customFolders) ? persisted.customFolders : [];

        // Array position becomes an explicit sort key, preserving today's visual order exactly
        const customFolders = folders.map((folder, index) => ({
          ...folder,
          parentId: folder.parentId ?? null,
          order: typeof folder.order === 'number' ? folder.order : (index + 1) * 1000
        }));

        // Adopt the list that used to live in its own localStorage key. The old key is left in
        // place, unread, as a rollback path for one release.
        let unaddedCheckPlaylists = persisted.unaddedCheckPlaylists ?? [];
        if (!Array.isArray(unaddedCheckPlaylists) || unaddedCheckPlaylists.length === 0) {
          try {
            const legacy = localStorage.getItem('jomify_unadded_check_playlists');
            if (legacy) unaddedCheckPlaylists = JSON.parse(legacy) ?? [];
          } catch {
            unaddedCheckPlaylists = [];
          }
        }

        return { ...persisted, customFolders, unaddedCheckPlaylists };
      },

      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        savedVolume: state.savedVolume,
        customFolders: state.customFolders,
        libraryGridSize: state.libraryGridSize,
        pinnedItems: state.pinnedItems, // SAVES YOUR SANDBOX
        queueOrder: state.queueOrder,
        manuallyQueuedTracks: state.manuallyQueuedTracks,
        playlistSortSettings: state.playlistSortSettings,
        stagedSeven : state.stagedSeven,
        sevens: state.sevens,
        sevensSeeded: state.sevensSeeded,
        unaddedCheckPlaylists: state.unaddedCheckPlaylists
      }),
    }
  ))
);