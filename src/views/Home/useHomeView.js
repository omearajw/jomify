import { useRef, useState } from 'react';
import { create } from 'zustand';
import { useUserStore } from '../../store/userStore';
import { useSlice } from '../../store/selectors';
import { playContext } from '../../services/spotify/api';
import { startPlaying } from '../../queue/play';
import { childrenOf } from '../../utils/library';
import { useIsMobile } from '../../hooks/useMediaQuery';

// Pins Spotify answered nothing for, so Home can say so instead of showing a gap. App's pin
// hydration fills it for the whole session, whatever page is open, and both Home pages read it,
// so it lives outside either of them.
export const usePinFailures = create((set) => ({
  failed: new Set(),
  attempt: 0,
  // Ids already asked for, so each pin is fetched once. Mutated in place: nothing draws it.
  asked: new Set(),
  markFailed: (ids) => set((s) => ({ failed: new Set([...s.failed, ...ids]) })),
  retry: () => set((s) => {
    s.failed.forEach((id) => s.asked.delete(id));
    return { failed: new Set(), attempt: s.attempt + 1 };
  })
}));

// Home, with no markup: your profile, whose turn it is in each Seven, friends and the pins
// resolved to what they open. The old page (inline in App.jsx) and the room's
// (src/room/RoomHome.jsx) are two faces on it. The turn check and the pin hydration stay in App,
// which runs them for the whole session; this reads what they leave in the stores.
export function useHomeView() {
  const {
    token, profile, playlists, albums, customFolders, pinnedItems, sevens, sevenTurns, friends,
    navigateToUser, navigateToPlaylist, navigateToAlbum, setCurrentView, setActiveFolderId, setContextMenu,
    togglePin, reorderPinnedItems, requestWorkspace, setAccountOpen
  } = useSlice(useUserStore, [
    'token', 'profile', 'playlists', 'albums', 'customFolders', 'pinnedItems', 'sevens', 'sevenTurns', 'friends',
    'navigateToUser', 'navigateToPlaylist', 'navigateToAlbum', 'setCurrentView', 'setActiveFolderId', 'setContextMenu',
    'togglePin', 'reorderPinnedItems', 'requestWorkspace', 'setAccountOpen'
  ]);
  const failedPins = usePinFailures((s) => s.failed);
  const retryPins = usePinFailures((s) => s.retry);
  const isMobile = useIsMobile();

  const [showStats, setShowStats] = useState(false);
  const toggleStats = () => setShowStats((v) => !v);

  // A Seven marked finished after its turn was fetched must stop nagging without a refetch
  const activeSevenTurns = (sevenTurns || []).filter((turn) => sevens.some((s) => s.playlistId === turn.id && s.active));
  const openTurn = (playlistId) => { requestWorkspace(playlistId); navigateToPlaylist(playlistId); };

  const openProfile = () => { if (profile?.id) navigateToUser(profile.id); };
  const openFriends = () => setCurrentView('friends');
  const openAccount = () => setAccountOpen(true);

  // Each pin as what it shows and what it opens. Pins whose item hasn't loaded are left out;
  // `index` stays the pin's place in pinnedItems, which the menu and the reorder go by.
  const pins = pinnedItems.map((pinned, index) => {
    const key = `${pinned.type}-${pinned.id}`;
    if (failedPins.has(pinned.id) && pinned.type !== 'folder') {
      return { key, index, pinned, failed: true, unpin: () => togglePin(pinned.id, pinned.type) };
    }
    let item, open, kind, detail, covers = null;
    if (pinned.type === 'playlist') {
      item = playlists.find((p) => p.id === pinned.id);
      if (!item) return null;
      open = () => navigateToPlaylist(item.id);
      kind = 'Playlist';
      detail = item.owner?.display_name || 'Spotify';
    } else if (pinned.type === 'album') {
      item = albums.find((a) => a.id === pinned.id);
      if (!item) return null;
      open = () => navigateToAlbum(item.id);
      kind = 'Album';
      detail = item.artists?.map((a) => a.name).join(', ');
    } else if (pinned.type === 'folder') {
      item = customFolders.find((f) => f.id === pinned.id);
      if (!item) return null;
      // Open THIS folder, not just the library root
      open = () => { setCurrentView('library'); setActiveFolderId(item.id); };
      kind = 'Folder';
      const subfolders = childrenOf(customFolders, item.id).length;
      detail = `${item.playlistIds.length} item${item.playlistIds.length === 1 ? '' : 's'}${subfolders ? ` · ${subfolders} folder${subfolders === 1 ? '' : 's'}` : ''}`;
      // The room draws a folder from the covers of its first few things
      covers = [];
      for (const id of item.playlistIds) {
        const images = (playlists.find((p) => p.id === id) || albums.find((a) => a.id === id))?.images;
        if (images?.length) covers.push(images);
        if (covers.length === 4) break;
      }
    } else {
      return null;
    }
    const openMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        type: pinned.type,
        playlistId: pinned.type === 'playlist' ? pinned.id : null,
        albumId: pinned.type === 'album' ? pinned.id : null,
        folderId: pinned.type === 'folder' ? pinned.id : null,
        // Lets the menu offer "move earlier / later" among the pins
        pinnedIndex: index,
        x: e.pageX,
        y: e.pageY
      });
    };
    const play = pinned.type === 'folder' ? null : () => startPlaying({ uri: `spotify:${pinned.type}:${pinned.id}`, name: item.name }, (deviceId) => playContext(token, deviceId, `spotify:${pinned.type}:${pinned.id}`));
    return { key, index, pinned, failed: false, item, title: item.name, images: item.images, covers, kind, detail, open, play, openMenu };
  }).filter(Boolean);

  // Desktop drag to reorder the pins; the index being dragged
  const pinDrag = useRef(null);
  const pinDragProps = (index) => ({
    draggable: !isMobile,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); pinDrag.current = index; },
    onDragOver: (e) => { if (pinDrag.current !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
    onDrop: (e) => { e.preventDefault(); if (pinDrag.current !== null && pinDrag.current !== index) reorderPinnedItems(pinDrag.current, index); pinDrag.current = null; },
    onDragEnd: () => { pinDrag.current = null; }
  });

  return {
    token, profile, playlists, isMobile,
    showStats, toggleStats,
    activeSevenTurns, openTurn,
    friends, navigateToUser, openProfile, openFriends, openAccount,
    pinnedCount: pinnedItems.length, pins, retryPins, pinDragProps
  };
}
