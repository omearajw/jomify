import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
// Explicit .js extensions so scripts/store-cases.mjs can import this store under plain node
import { markFoldersDeleted, markPinsDeleted, syncNow } from '../sync/meta.js';
import {
  byOrder, childrenOf, descendantIds, isDescendant, nextSiblingOrder, repairFolderTree
} from '../utils/library.js';

// Keeps the first occurrence of each id, preserving order
const uniqueById = (items) => {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

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
    folderId: state.activeFolderId,
    userId: state.currentUserId
  }
].slice(-HISTORY_CAP);

export const useUserStore = create(
  subscribeWithSelector(persist(
    (set, get) => ({
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
      currentUserId: null,
      likedTracks: {}, 
      isQueueOpen: false,
      isNowPlayingOpen: false,
      isDevicePickerOpen: false,
      isAccountOpen: false,
      contextMenu: null,
      isZenMode: false,
      savedVolume: 50,
      stagedSeven: [],
      
      // --- CUSTOM FOLDER ENGINE ---
      customFolders: [], 
      activeFolderId: null,
      libraryGridSize: 'medium',
      
      setLibraryGridSize: (size) => set({ libraryGridSize: size }),
      librarySort: 'spotify', // 'spotify' | 'az' | 'za' | 'owner'
      setLibrarySort: (mode) => set({ librarySort: mode }),
      setActiveFolderId: (folderId) => set((state) => ({
        activeFolderId: folderId,
        manageFolderId: folderId ? state.manageFolderId : null
      })),

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

      // --- FRIENDS ---
      // Spotify offers no way to list who you follow, so this is a hand-built, synced list:
      // { id, name, image, addedAt }. Profiles are re-fetched live; only the identity is stored.
      friends: [],
      addFriend: (profile) => set((state) => {
        if (!profile?.id || state.friends.some(f => f.id === profile.id)) return state;
        return {
          friends: [...state.friends, {
            id: profile.id,
            name: profile.display_name || profile.name || profile.id,
            image: profile.images?.[0]?.url || profile.image || null,
            addedAt: Date.now()
          }]
        };
      }),
      removeFriend: (userId) => set((state) => ({ friends: state.friends.filter(f => f.id !== userId) })),

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

      // `initialItemIds` lets "New folder…" in a context menu create the folder with the item
      // already inside, in one state change. The items are pulled out of any other folder so
      // the one-folder-per-item invariant holds.
      createFolder: (name, initialItemIds = [], parentId = null) => set((state) => {
        const parent = parentId !== null && state.customFolders.some(f => f.id === parentId) ? parentId : null;
        const moving = new Set(initialItemIds);
        return {
          customFolders: [
            ...state.customFolders.map(f => (
              moving.size ? { ...f, playlistIds: f.playlistIds.filter(id => !moving.has(id)) } : f
            )),
            {
              // The random suffix matters: Date.now() alone collides when two folders are created
              // in the same millisecond, and colliding ids make every folder action hit both.
              // It doubles as the sync id, so it must also be unique across devices.
              id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              playlistIds: [...moving],
              parentId: parent,
              order: nextSiblingOrder(state.customFolders, parent)
            }
          ].sort(byOrder)
        };
      }),

      // Rejects moves that would make a folder its own ancestor; the merge can still produce
      // such a cycle from two devices' concurrent moves, which repairFolderTree handles on read.
      moveFolder: (folderId, newParentId = null) => set((state) => {
        const folders = state.customFolders;
        const folder = folders.find(f => f.id === folderId);
        if (!folder || folderId === newParentId) return {};
        if (newParentId !== null && !folders.some(f => f.id === newParentId)) return {};
        if (newParentId !== null && isDescendant(folders, newParentId, folderId)) return {};
        if ((folder.parentId ?? null) === newParentId) return {};

        const order = nextSiblingOrder(folders, newParentId);
        return {
          customFolders: folders
            .map(f => (f.id === folderId ? { ...f, parentId: newParentId, order } : f))
            .sort(byOrder)
        };
      }),

      // Applies a planned import (see src/import/spotifyFolders.js). Replace mode tombstones
      // every existing folder the plan doesn't mention; both modes pull imported playlists out
      // of whatever folder they were in. One set(), so one sync push.
      importFolderTree: (incoming, { mode = 'replace' } = {}) => {
        const state = get();
        const incomingIds = new Set(incoming.map(f => f.id));
        const existingIds = new Set(state.customFolders.map(f => f.id));
        const removedIds = mode === 'replace'
          ? state.customFolders.filter(f => !incomingIds.has(f.id)).map(f => f.id)
          : [];

        if (removedIds.length > 0) {
          const at = syncNow();
          markFoldersDeleted(removedIds, at);
          const removedSet = new Set(removedIds);
          const droppedPins = state.pinnedItems.filter(p => removedSet.has(p.id)).map(p => p.id);
          if (droppedPins.length > 0) markPinsDeleted(droppedPins, at);
        }

        const removed = new Set(removedIds);
        const moving = new Set(incoming.flatMap(f => f.playlistIds || []));

        set((s) => {
          const existing = new Map(s.customFolders.map(f => [f.id, f]));
          const kept = s.customFolders
            .filter(f => !removed.has(f.id) && !incomingIds.has(f.id))
            .map(f => ({ ...f, playlistIds: f.playlistIds.filter(id => !moving.has(id)) }));
          const imported = incoming.map(f => ({
            ...(existing.get(f.id) || {}),
            ...f,
            parentId: f.parentId ?? null,
            playlistIds: f.playlistIds || []
          }));
          return {
            customFolders: [...kept, ...imported].sort(byOrder),
            pinnedItems: s.pinnedItems.filter(p => !removed.has(p.id)),
            activeFolderId: removed.has(s.activeFolderId) ? null : s.activeFolderId,
            manageFolderId: removed.has(s.manageFolderId) ? null : s.manageFolderId,
            viewHistory: s.viewHistory.map(h => (removed.has(h.folderId) ? { ...h, folderId: null } : h))
          };
        });

        return {
          created: incoming.filter(f => !existingIds.has(f.id)).length,
          updated: incoming.filter(f => existingIds.has(f.id)).length,
          removed: removedIds.length
        };
      },

      renameFolder: (folderId, name) => set((state) => ({
        customFolders: state.customFolders.map(f => (f.id === folderId ? { ...f, name } : f))
      })),

      // Drops folder entries whose id resolves to nothing in the loaded library. Only ever
      // called from an explicit button, never automatically: during a transient load failure
      // "missing" and "not loaded yet" look identical.
      removeMissingFolderItems: (folderId, presentIds) => set((state) => {
        const present = new Set(presentIds);
        return {
          customFolders: state.customFolders.map(f => (
            f.id === folderId ? { ...f, playlistIds: f.playlistIds.filter(id => present.has(id)) } : f
          ))
        };
      }),

      // Set by the sidebar's "+" on a folder so Library opens that folder straight into manage
      // mode. Cleared when the folder is left.
      manageFolderId: null,
      requestFolderManage: (folderId) => set({ manageFolderId: folderId }),
      clearManageRequest: () => set({ manageFolderId: null }),

      // Cascades: the folder and everything under it. Items inside are never deleted, only
      // unfoldered. This and importFolderTree are the only two places that remove folders and
      // the only two that mint tombstones -- the sync layer never infers a folder removal from
      // a diff, because a false tombstone would delete real folders on every device at once.
      // Every descendant gets its own tombstone at ONE timestamp, or an untombstoned child
      // would come straight back from the server.
      deleteFolder: (folderId) => {
        const state = get();
        const root = state.customFolders.find(f => f.id === folderId);
        if (!root) return;

        const ids = [folderId, ...descendantIds(state.customFolders, folderId)];
        const gone = new Set(ids);
        const at = syncNow();
        markFoldersDeleted(ids, at);

        const droppedPins = state.pinnedItems.filter(p => gone.has(p.id)).map(p => p.id);
        if (droppedPins.length > 0) markPinsDeleted(droppedPins, at);

        const fallback = root.parentId ?? null;
        set((s) => ({
          customFolders: s.customFolders.filter(f => !gone.has(f.id)),
          pinnedItems: s.pinnedItems.filter(p => !gone.has(p.id)),
          activeFolderId: gone.has(s.activeFolderId) ? fallback : s.activeFolderId,
          manageFolderId: gone.has(s.manageFolderId) ? null : s.manageFolderId,
          viewHistory: s.viewHistory.map(h => (gone.has(h.folderId) ? { ...h, folderId: fallback } : h))
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

      // The album counterpart of deletePlaylist: one set() that cleans every slice, instead of
      // the N separate folder writes the context menu used to loop through.
      removeAlbumFromLibrary: (albumId) => set((state) => ({
        albums: (state.albums || []).filter(a => a.id !== albumId),
        customFolders: state.customFolders.map(f => ({
          ...f,
          playlistIds: f.playlistIds.filter(id => id !== albumId)
        })),
        pinnedItems: state.pinnedItems.filter(p => p.id !== albumId),
        currentAlbumId: state.currentAlbumId === albumId ? null : state.currentAlbumId,
        viewHistory: state.viewHistory.filter(h => !(h.view === 'album' && h.albumId === albumId))
      })),

      // Places `dragId` before or after `dropId` among the drop target's SIBLINGS. A drop onto a
      // folder in another parent reparents in the same change. `position` is optional so the
      // old two-argument callers keep their splice semantics: a drag that sat earlier in the
      // list lands after the target, otherwise before it.
      reorderFolders: (dragId, dropId, position) => set((state) => {
        const folders = state.customFolders;
        const drag = folders.find(f => f.id === dragId);
        const drop = folders.find(f => f.id === dropId);
        if (!drag || !drop || dragId === dropId) return {};

        const targetParent = drop.parentId ?? null;
        if (targetParent !== null && (targetParent === dragId || isDescendant(folders, targetParent, dragId))) return {};

        const siblings = childrenOf(folders, targetParent).filter(f => f.id !== dragId);
        const dropIndex = siblings.findIndex(f => f.id === dropId);
        if (dropIndex === -1) return {};

        let resolved = position;
        if (resolved !== 'before' && resolved !== 'after') {
          const ordered = childrenOf(folders, targetParent);
          const dragWasEarlier = (drag.parentId ?? null) === targetParent
            && ordered.findIndex(f => f.id === dragId) < ordered.findIndex(f => f.id === dropId);
          resolved = dragWasEarlier ? 'after' : 'before';
        }

        const insertAt = resolved === 'after' ? dropIndex + 1 : dropIndex;
        const before = siblings[insertAt - 1];
        const after = siblings[insertAt];
        let order;
        if (!before) order = (after?.order ?? 1000) - 1000;
        else if (!after) order = (before.order ?? 0) + 1000;
        else order = ((before.order ?? 0) + (after.order ?? 0)) / 2;

        const arranged = [
          ...siblings.slice(0, insertAt),
          { ...drag, parentId: targetParent, order },
          ...siblings.slice(insertAt)
        ];

        // If repeated midpoints have squeezed the gaps shut, renumber this sibling group only
        const collapsed = arranged.some((f, i) => i > 0 && Math.abs((f.order ?? 0) - (arranged[i - 1].order ?? 0)) < 0.001);
        const finalSiblings = collapsed ? arranged.map((f, i) => ({ ...f, order: (i + 1) * 1000 })) : arranged;
        const replaced = new Map(finalSiblings.map(f => [f.id, f]));

        return { customFolders: folders.map(f => replaced.get(f.id) || f).sort(byOrder) };
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
      
      // expiresInSeconds comes from Spotify's token response. The 3600 fallback only applies if
      // a caller doesn't pass it; it used to be hardcoded, so a shorter-lived token would have
      // expired mid-session before the heartbeat thought to refresh it.
      setToken: (newToken, expiresInSeconds) => set({
        token: newToken,
        tokenExpiresAt: Date.now() + ((Number(expiresInSeconds) || 3600) * 1000)
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
          friends: [],
          likedTracks: {},
          manuallyQueuedTracks: []
        } : {})
      }),

      queueRefreshTrigger: 0,
      triggerQueueRefresh: () => set((state) => ({ queueRefreshTrigger: state.queueRefreshTrigger + 1 })),

      // Only what the queue panel renders and the matcher needs. Full Spotify track objects
      // (every image size, full album and artist payloads) were being written to localStorage
      // for a list that doesn't even outlive the Spotify queue.
      manuallyQueuedTracks: [],
      addManuallyQueuedTrack: (track) => set((state) => ({
        manuallyQueuedTracks: [...state.manuallyQueuedTracks, {
          id: track.id,
          uri: track.uri,
          name: track.name,
          duration_ms: track.duration_ms,
          linked_from: track.linked_from ? { id: track.linked_from.id, uri: track.linked_from.uri } : undefined,
          artists: (track.artists || []).map(a => ({ id: a.id, name: a.name, uri: a.uri })),
          album: track.album ? {
            id: track.album.id,
            name: track.album.name,
            images: track.album.images?.[0] ? [track.album.images[0]] : []
          } : undefined
        }]
      })),
      
      // Matches on identity only. The old fuzzy clause compared the part of the name before any
      // "-" or "(", so "Song" and "Song - Live" by the same artist collided and playing one
      // removed the other. Spotify's relinking is the one legitimate case where the playing
      // track's id differs from what was queued, and it tells us via linked_from.
      consumeManuallyQueuedTrack: (playingTrack) => set((state) => {
        if (!playingTrack) return state;
        const linked = playingTrack.linked_from;
        const index = state.manuallyQueuedTracks.findIndex(t =>
          (t.id && t.id === playingTrack.id) ||
          (t.uri && t.uri === playingTrack.uri) ||
          (linked && ((t.uri && t.uri === linked.uri) || (t.id && t.id === linked.id)))
        );
        if (index > -1) {
          const newTracks = [...state.manuallyQueuedTracks];
          newTracks.splice(index, 1);
          return { manuallyQueuedTracks: newTracks };
        }
        return state;
      }),

      queueData: null,
      setQueueData: (data) => set((state) => ({
        queueData: typeof data === 'function' ? data(state.queueData) : data
      })),

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
      // Both de-duplicate by id at the door. Several async loaders merge into these lists
      // (the initial fetch, pinned-item hydration, playlist creation) and a duplicate entry
      // renders as a duplicate card with a duplicate React key. Making it impossible here is
      // cheaper than making every merge site perfect.
      setPlaylists: (playlistData) => set({ playlists: uniqueById(playlistData) }),
      setAlbums: (albumData) => set({ albums: uniqueById(albumData) }),
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
      setLikedTracks: (updates) => set((state) => ({ likedTracks: { ...state.likedTracks, ...updates } })),
      setApiCooldown: (timestamp) => set({ apiCooldownUntil: timestamp }),
      toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
      setQueueOpen: (open) => set({ isQueueOpen: Boolean(open) }),
      setNowPlayingOpen: (open) => set({ isNowPlayingOpen: Boolean(open) }),
      setDevicePickerOpen: (open) => set({ isDevicePickerOpen: Boolean(open) }),
      setAccountOpen: (open) => set({ isAccountOpen: Boolean(open) }),
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

      navigateToUser: (userId) => set((state) => {
        if (!userId || (state.currentView === 'user' && state.currentUserId === userId)) return {};
        return {
          viewHistory: pushHistory(state),
          currentView: 'user',
          currentUserId: userId
        };
      }),

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
          activeFolderId: prev.folderId,
          currentUserId: prev.userId ?? null
        };
      }),
    }),
    {
      name: 'jomify-storage',
      version: 2,

      // Zustand treats state stored without a version as version 0. Each step only ever ADDS or
      // repairs fields -- nothing here can remove a folder. v2 runs the tree repair once so a
      // store that predates nesting can't hold an orphan or a cycle.
      migrate: (persisted, fromVersion) => {
        if (!persisted || fromVersion >= 2) return persisted;
        if (fromVersion >= 1) {
          return { ...persisted, customFolders: repairFolderTree(persisted.customFolders || []).folders };
        }

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

        return { ...persisted, customFolders: repairFolderTree(customFolders).folders, unaddedCheckPlaylists };
      },

      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        savedVolume: state.savedVolume,
        customFolders: state.customFolders,
        libraryGridSize: state.libraryGridSize,
        librarySort: state.librarySort,
        pinnedItems: state.pinnedItems, // SAVES YOUR SANDBOX
        manuallyQueuedTracks: state.manuallyQueuedTracks,
        playlistSortSettings: state.playlistSortSettings,
        stagedSeven : state.stagedSeven,
        sevens: state.sevens,
        sevensSeeded: state.sevensSeeded,
        unaddedCheckPlaylists: state.unaddedCheckPlaylists,
        friends: state.friends
      }),
    }
  ))
);