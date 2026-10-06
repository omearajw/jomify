import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { playOn } from '../services/spotify/playbackController';
import {
  addToQueue, addTracksToPlaylist, removeTrackFromPlaylist, unfollowPlaylist, unsaveAlbum, saveAlbumToLibrary,
  followPlaylist, fetchPlaylistSummary, fetchAlbumsByIds, fetchAlbumTrackUris, playContext, toggleTrackLike, checkTracksLiked,
  followArtists, unfollowArtists
} from '../services/spotify/api';
import { shareSpotifyLink } from '../services/share';
import { ListPlus, Plus, ChevronRight, ChevronDown, ChevronUp, Folder, Trash2, FolderPlus, Pin, PinOff, Pencil, CornerDownRight, User, Disc3, Heart, Play, Share2, UserPlus, UserCheck, BookmarkPlus, BookmarkMinus } from 'lucide-react';
import { idFromUri } from '../utils/spotifyUri';
import FolderFormDialog from './FolderFormDialog';
import { toast } from '../store/toastStore';
import { flattenFolderTree, descendantIds, childrenOf } from '../utils/library';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useSlice } from '../store/selectors';

// One ordinary entry: icon, label, action
function MenuItem({ icon: Icon, label, onClick, iconClass = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
    >
      <Icon className={`w-4 h-4 text-neutral-400 shrink-0 ${iconClass}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

// One picker for every "Move to…" list: playlists, albums and folders. Rows are indented by
// depth and labelled with their path so two "Favourites" folders in different places can be
// told apart. `excludeIds` hides a folder and its subtree (a folder can't move into itself).
function MoveToList({ folders, currentParentId, excludeIds, allowRoot = false, onPick, footer }) {
  const rows = flattenFolderTree(folders, { exclude: excludeIds || new Set() });
  return (
    <div className="max-h-[40dvh] md:max-h-48 overflow-y-auto custom-scrollbar">
      {allowRoot && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(null); }}
          disabled={currentParentId === null}
          className="w-full text-left px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate"
        >
          Top level
        </button>
      )}
      {rows.map(({ folder, depth, path }) => (
        <button
          key={folder.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(folder.id); }}
          disabled={folder.id === currentParentId}
          title={path.join(' › ')}
          style={{ paddingLeft: 16 + depth * 12 }}
          className="w-full text-left pr-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors truncate flex items-center gap-2"
        >
          {depth > 0 && <CornerDownRight className="w-3 h-3 text-neutral-600 shrink-0" />}
          <span className="truncate">{folder.name}</span>
        </button>
      ))}
      {footer}
    </div>
  );
}

const MENU_WIDTH = 224;     // w-56
const SUBMENU_WIDTH = 256;  // w-64
const VIEWPORT_PAD = 8;
import ConfirmDialog from './ConfirmDialog';
import { getUnfolderedItems } from '../utils/library';

export default function ContextMenu() {
  const {
    contextMenu, setContextMenu, token, triggerQueueRefresh,
    addManuallyQueuedTrack,
    playlists, albums, customFolders, profile, deletePlaylist, deleteFolder, setCurrentView, setActivePlaylistId,
    removeAlbumFromLibrary, addPlaylistToFolder, removePlaylistFromFolder, renameFolder, createFolder, moveFolder,
    reorderFolders, reorderPlaylistInFolder,
    pinnedItems, togglePin, movePinnedItem, navigateToArtist, navigateToAlbum, setNowPlayingOpen,
    setPlaylists, setAlbums, likedTracks, setLikedTracks, followedArtists, addFollowedArtist, removeFollowedArtist,
    navigateToPlaylist, requestEditPlaylist
  } = useSlice(useUserStore, [
    'contextMenu', 'setContextMenu', 'token', 'triggerQueueRefresh',
    'addManuallyQueuedTrack',
    'playlists', 'albums', 'customFolders', 'profile', 'deletePlaylist', 'deleteFolder', 'setCurrentView', 'setActivePlaylistId',
    'removeAlbumFromLibrary', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'renameFolder', 'createFolder', 'moveFolder',
    'reorderFolders', 'reorderPlaylistInFolder',
    'pinnedItems', 'togglePin', 'movePinnedItem', 'navigateToArtist', 'navigateToAlbum', 'setNowPlayingOpen',
    'setPlaylists', 'setAlbums', 'likedTracks', 'setLikedTracks', 'followedArtists', 'addFollowedArtist', 'removeFollowedArtist',
    'navigateToPlaylist', 'requestEditPlaylist'
  ]);

  const menuRef = useRef(null);
  const isMobile = useIsMobile();
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  // The dialogs outlive the menu: a click inside one lands outside the menu and closes it, and the
  // folder dialog is opened by a handler that closes the menu deliberately. So each dialog keeps a
  // snapshot of what it is about rather than reading the menu, and all of them render whether
  // or not the menu is open.
  const [confirmPlaylist, setConfirmPlaylist] = useState(null); // { id, name }
  const [confirmFolder, setConfirmFolder] = useState(null); // { id, name, subs }
  // Which folder dialog is open, and what it should do with the name it collects. The menu
  // itself has usually closed by the time the dialog is on screen, so the item id is captured
  // here rather than read from contextMenu later.
  const [folderDialog, setFolderDialog] = useState(null); // { mode: 'rename', folderId, name } | { mode: 'create', itemId?, parentId? }
  const [showMoveFolder, setShowMoveFolder] = useState(false);

  // Which folder groups in the "Add to Playlist" submenu are expanded. Every folder starts
  // closed each time the menu opens, so a big library is a short list of folders rather than
  // one long scroll of every playlist.
  const [openFolderIds, setOpenFolderIds] = useState(() => new Set());

  const closeMenu = () => {
    setContextMenu(null);
    setShowPlaylistMenu(false);
    setShowMoveFolder(false);
    setOpenFolderIds(new Set());
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    // Arrow keys walk the entries, Home/End jump, Enter and Space activate (they are buttons)
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeMenu(); return; }
      const el = menuRef.current;
      if (!el || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = [...el.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent !== null);
      if (items.length === 0) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContextMenu]);

  // Keep the menu on screen. Position is written straight to the element rather than held in
  // state so that hover re-renders (which open the submenu) never reset it. useLayoutEffect
  // runs before paint, so there is no flash at the unclamped position.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !contextMenu) return;

    // On a phone the menu is a sheet pinned to the bottom edge by its classes; inline
    // coordinates from an earlier desktop-sized render would override that
    if (isMobile) {
      el.style.left = '';
      el.style.top = '';
      return;
    }

    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_PAD;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(contextMenu.x, maxLeft));
    const top = Math.max(VIEWPORT_PAD, Math.min(contextMenu.y, maxTop));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // Focus lands on the menu itself, so the first arrow press reaches the first entry
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [contextMenu, isMobile]);

  const confirmDeletePlaylist = async () => {
    const target = confirmPlaylist;
    setConfirmPlaylist(null);
    setContextMenu(null);
    if (!token || !target) return;
    try {
      await unfollowPlaylist(token, target.id);
      deletePlaylist(target.id);
      if (target.id === useUserStore.getState().activePlaylistId) {
        setCurrentView('library');
        setActivePlaylistId(null);
      }
      toast(`Deleted "${target.name}"`, { tone: 'info' });
    } catch (err) {
      console.error(err);
      toast(`Couldn't delete "${target.name}"`, { tone: 'error' });
    }
  };

  const confirmDeleteFolder = () => {
    const target = confirmFolder;
    setConfirmFolder(null);
    if (!target) return;
    // The menu may already have closed under the dialog, so the folder id comes from the
    // snapshot; an onDelete handler supplied by the opener is still honoured when present
    if (typeof contextMenu?.onDelete === 'function') contextMenu.onDelete();
    else deleteFolder(target.id);
    setContextMenu(null);
  };

  const dialogs = (
    <>
      <FolderFormDialog
        open={Boolean(folderDialog)}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : (folderDialog?.parentId ? 'New subfolder' : 'New folder')}
        submitLabel={folderDialog?.mode === 'rename' ? 'Rename' : 'Create'}
        initialName={folderDialog?.mode === 'rename' ? folderDialog.name : ''}
        parentLabel={folderDialog?.parentId ? customFolders.find(f => f.id === folderDialog.parentId)?.name : ''}
        onSubmit={({ name }) => {
          if (folderDialog?.mode === 'rename') renameFolder(folderDialog.folderId, name);
          else createFolder(name, folderDialog.itemId ? [folderDialog.itemId] : [], folderDialog.parentId ?? null);
          setFolderDialog(null);
        }}
        onCancel={() => setFolderDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(confirmPlaylist)}
        title="Delete Playlist"
        message={`Delete "${confirmPlaylist?.name || 'this playlist'}" from your library?`}
        confirmLabel="Delete Playlist"
        onConfirm={confirmDeletePlaylist}
        onCancel={() => setConfirmPlaylist(null)}
      />
      <ConfirmDialog
        open={Boolean(confirmFolder)}
        title="Delete Folder"
        message={`Delete "${confirmFolder?.name || 'this folder'}"?${confirmFolder?.subs ? ` This also deletes ${confirmFolder.subs} subfolder${confirmFolder.subs === 1 ? '' : 's'}.` : ''} Your playlists will not be deleted.`}
        confirmLabel="Delete Folder"
        onConfirm={confirmDeleteFolder}
        onCancel={() => setConfirmFolder(null)}
      />
    </>
  );

  if (!contextMenu) return dialogs;

  // Submenu geometry, derived from the click position rather than measured. The clamp above
  // only ever moves the menu UP or LEFT, so using the raw coordinates here is conservative:
  // the real menu has at least this much room.
  const menuLeft = Math.min(contextMenu.x, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD);
  const flipSubmenu = menuLeft + MENU_WIDTH + SUBMENU_WIDTH + VIEWPORT_PAD > window.innerWidth;
  const submenuMaxHeight = Math.max(160, window.innerHeight - contextMenu.y - VIEWPORT_PAD - 48);

  // Anything you can actually add tracks to: playlists you own, plus collaborative ones. The
  // old owner-only filter silently hid collaborative playlists you had write access to.
  const userPlaylists = playlists.filter(p => p.owner?.id === profile?.id || p.collaborative);
  const { playlists: unfolderedPlaylists } = getUnfolderedItems(userPlaylists, [], customFolders);

  // Last row of every "Move to..." list. With no folders at all it is the only row, so the
  // heading no longer sits over an empty box.
  const newFolderEntry = (itemId) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setFolderDialog({ mode: 'create', itemId });
        setContextMenu(null);
      }}
      className="w-full text-left px-4 py-2 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors flex items-center gap-2"
    >
      <Plus className="w-3.5 h-3.5 text-neutral-500" /> New folder…
    </button>
  );

  const toggleFolderOpen = (folderId) => {
    setOpenFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  const sourcePlaylist = contextMenu.sourcePlaylistId ? playlists.find(p => p.id === contextMenu.sourcePlaylistId) : null;
  const folder = contextMenu?.folderId ? customFolders.find(f => f.id === contextMenu.folderId) : null;
  const canRemove = sourcePlaylist && sourcePlaylist.owner.id === profile?.id;

  // One-step reordering for touch screens, where the sidebar's drag-and-drop can't be used.
  // Neighbour ids drive the same store actions a drop would.
  const moveRows = (() => {
    // A pin on Home: earlier or later among the pins
    if (typeof contextMenu?.pinnedIndex === 'number') {
      const i = contextMenu.pinnedIndex;
      return {
        canUp: i > 0,
        canDown: i < pinnedItems.length - 1,
        labels: ['Move earlier', 'Move later'],
        up: () => { movePinnedItem(i, -1); closeMenu(); },
        down: () => { movePinnedItem(i, 1); closeMenu(); }
      };
    }
    // A track in one of your own playlists (custom order): the playlist view supplies the move
    if (contextMenu?.reorder) {
      const r = contextMenu.reorder;
      return {
        canUp: r.index > 0,
        canDown: r.index < r.count - 1,
        up: () => { r.move(-1); closeMenu(); },
        down: () => { r.move(1); closeMenu(); }
      };
    }
    if (contextMenu?.type === 'folder' && folder) {
      const siblings = childrenOf(customFolders, folder.parentId ?? null);
      const i = siblings.findIndex(f => f.id === folder.id);
      return {
        canUp: i > 0,
        canDown: i >= 0 && i < siblings.length - 1,
        up: () => reorderFolders(folder.id, siblings[i - 1].id, 'before'),
        down: () => reorderFolders(folder.id, siblings[i + 1].id, 'after')
      };
    }
    const itemId = contextMenu?.playlistId || contextMenu?.albumId;
    const parent = contextMenu?.parentFolderId ? customFolders.find(f => f.id === contextMenu.parentFolderId) : null;
    if (itemId && parent) {
      const ids = parent.playlistIds;
      const i = ids.indexOf(itemId);
      return {
        canUp: i > 0,
        canDown: i >= 0 && i < ids.length - 1,
        up: () => reorderPlaylistInFolder(parent.id, itemId, ids[i - 1]),
        down: () => reorderPlaylistInFolder(parent.id, itemId, ids[i + 1])
      };
    }
    return null;
  })();

  // Sandbox Pinning Logic
  const activeId = contextMenu?.playlistId || contextMenu?.albumId || contextMenu?.folderId;
  const activeType = contextMenu?.type;
  const canPin = ['playlist', 'album', 'folder'].includes(activeType);
  const isPinned = canPin ? pinnedItems.some(i => i.id === activeId) : false;

  const handleAddToQueue = async () => {
    const track = contextMenu.track;
    if (!token || !track) return;
    closeMenu();
    // Finding a device, waiting for this browser's player and asking where to play are the same
    // as for a play. With no device this used to open the picker and then forget the song.
    await playOn(async (deviceId) => {
      await addToQueue(token, deviceId, track.uri);
      // Only record the entry once Spotify has accepted it. It's persisted, so a failed add used
      // to leave a phantom in the queue panel that survived restarts.
      addManuallyQueuedTrack(track);
      setTimeout(() => triggerQueueRefresh(), 750);
      toast(`Queued "${track.name}"`, { tone: 'success' });
    }, { track, quiet: true }).catch(() => toast("Couldn't add to the queue", { tone: 'error' }));
  };

  const menuAlbumId = contextMenu?.albumId || null;
  const menuAlbum = contextMenu?.album || albums.find((a) => a.id === menuAlbumId) || null;
  const albumInLibrary = Boolean(menuAlbumId) && albums.some((a) => a.id === menuAlbumId);
  const menuArtistId = contextMenu?.artistId || null;
  const menuArtist = contextMenu?.artist || followedArtists.find((a) => a.id === menuArtistId) || null;
  const artistFollowed = Boolean(menuArtistId) && followedArtists.some((a) => a.id === menuArtistId);

  // What "Add to playlist" adds: the song, or every song of the album
  const handleAddToPlaylist = async (playlistId) => {
    if (!token || (!contextMenu.track && !menuAlbumId)) return;
    const playlistName = playlists.find(p => p.id === playlistId)?.name || 'playlist';
    const what = contextMenu.track ? `"${contextMenu.track.name}"` : `"${menuAlbum?.name || 'the album'}"`;
    closeMenu();
    try {
      const uris = contextMenu.track ? [contextMenu.track.uri] : await fetchAlbumTrackUris(token, menuAlbumId);
      for (let i = 0; i < uris.length; i += 100) await addTracksToPlaylist(token, playlistId, uris.slice(i, i + 100));
      toast(`Added ${what} to ${playlistName}`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Couldn't add to ${playlistName}`, { tone: 'error' });
    }
  };

  // The heart, from the menu: unknown state is looked up first, as the heart itself does
  const trackId = contextMenu?.track?.id || idFromUri(contextMenu?.track?.uri, 'track');
  const trackLiked = trackId ? likedTracks[trackId] : undefined;
  const handleLikeToggle = async () => {
    if (!token || !trackId) return;
    closeMenu();
    let current = trackLiked === true;
    if (trackLiked === undefined) {
      try { current = Boolean((await checkTracksLiked(token, [trackId]))[trackId]); } catch { return; }
    }
    setLikedTracks({ [trackId]: !current });
    try {
      await toggleTrackLike(token, trackId, current);
      toast(current ? 'Removed from Liked Songs' : 'Saved to Liked Songs', { tone: current ? 'info' : 'success' });
    } catch (err) {
      console.error(err);
      setLikedTracks({ [trackId]: current });
      toast("Couldn't change Liked Songs", { tone: 'error' });
    }
  };

  const handlePlayContext = (uri) => {
    if (!token) return;
    closeMenu();
    playOn((deviceId) => playContext(token, deviceId, uri));
  };

  // Spotify's queue takes one song per request; an album goes in song by song
  const handleQueueAlbum = async () => {
    if (!token || !menuAlbumId) return;
    closeMenu();
    try {
      const uris = await fetchAlbumTrackUris(token, menuAlbumId);
      await playOn(async (deviceId) => { for (const uri of uris) await addToQueue(token, deviceId, uri); }, { quiet: true });
      triggerQueueRefresh();
      toast(`Added ${uris.length} song${uris.length === 1 ? '' : 's'} to the queue`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast("Couldn't add the album to the queue", { tone: 'error' });
    }
  };

  const handleSaveAlbum = async () => {
    if (!token || !menuAlbumId) return;
    closeMenu();
    try {
      await saveAlbumToLibrary(token, menuAlbumId);
      const album = menuAlbum || (await fetchAlbumsByIds(token, [menuAlbumId]))[0];
      if (album) setAlbums([...useUserStore.getState().albums, { id: album.id, name: album.name, images: album.images, artists: album.artists, type: 'album', total_tracks: album.total_tracks }]);
      toast(`Saved "${album?.name || 'album'}" to your library`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast("Couldn't save the album", { tone: 'error' });
    }
  };

  // Someone else's playlist: saving it is following it, and it appears in the library
  const handleSavePlaylist = async () => {
    if (!token || !contextMenu?.playlistId) return;
    const id = contextMenu.playlistId;
    closeMenu();
    try {
      await followPlaylist(token, id);
      const summary = await fetchPlaylistSummary(token, id).catch(() => null);
      if (summary) setPlaylists([...useUserStore.getState().playlists, summary]);
      toast(`Saved "${summary?.name || 'playlist'}" to your library`, { tone: 'success' });
    } catch (err) {
      console.error(err);
      toast("Couldn't save the playlist", { tone: 'error' });
    }
  };
  const handleUnfollowPlaylist = async () => {
    if (!token || !menuPlaylist) return;
    const removed = menuPlaylist;
    closeMenu();
    try {
      await unfollowPlaylist(token, removed.id);
      setPlaylists(useUserStore.getState().playlists.filter((p) => p.id !== removed.id));
      toast(`Removed "${removed.name}" from your library`, {
        action: { label: 'Undo', onClick: async () => {
          try { await followPlaylist(token, removed.id); setPlaylists([...useUserStore.getState().playlists, removed]); }
          catch { toast("Couldn't put the playlist back", { tone: 'error' }); }
        } }
      });
    } catch (err) {
      console.error(err);
      toast("Couldn't remove the playlist", { tone: 'error' });
    }
  };

  const handleFollowArtist = async () => {
    if (!token || !menuArtistId) return;
    const name = menuArtist?.name || 'artist';
    closeMenu();
    try {
      if (artistFollowed) {
        await unfollowArtists(token, [menuArtistId]);
        removeFollowedArtist(menuArtistId);
        toast(`Unfollowed ${name}`, { action: { label: 'Undo', onClick: async () => { try { await followArtists(token, [menuArtistId]); if (menuArtist) addFollowedArtist(menuArtist); } catch { toast("Couldn't follow again", { tone: 'error' }); } } } });
      } else {
        await followArtists(token, [menuArtistId]);
        if (menuArtist) addFollowedArtist(menuArtist);
        toast(`Following ${name}`, { tone: 'success' });
      }
    } catch (err) {
      console.error(err);
      toast(artistFollowed ? "Couldn't unfollow" : "Couldn't follow", { tone: 'error' });
    }
  };

  const share = (type, id, name) => { closeMenu(); shareSpotifyLink(type, id, name); };

  const handleRemoveFromPlaylist = async () => {
    if (!token || !contextMenu.track || !contextMenu.sourcePlaylistId) return;
    const { track, sourcePlaylistId, onRemoved } = contextMenu;
    setContextMenu(null);
    try {
      await removeTrackFromPlaylist(token, sourcePlaylistId, track.uri);
      // The open playlist drops the row and offers an undo; without this the row stayed until
      // a reload, with no sign anything had happened
      if (onRemoved) onRemoved(track);
      else toast(`Removed "${track.name}"`, { tone: 'info' });
    } catch (err) {
      console.error(err);
      toast(`Couldn't remove "${track.name}"`, { tone: 'error' });
    }
  };

  const menuPlaylist = contextMenu?.playlistId ? playlists.find(p => p.id === contextMenu.playlistId) : null;
  const ownsMenuPlaylist = Boolean(menuPlaylist && menuPlaylist.owner?.id === profile?.id);

  const handleDeletePlaylist = () => {
    if (!menuPlaylist) return;
    setConfirmPlaylist({ id: menuPlaylist.id, name: menuPlaylist.name });
  };

  const handleDeleteFolder = () => {
    if (!contextMenu?.folderId) return;
    const f = customFolders.find(x => x.id === contextMenu.folderId);
    setConfirmFolder({ id: contextMenu.folderId, name: contextMenu.folderName || f?.name, subs: f ? descendantIds(customFolders, f.id).length : 0 });
  };

  const handleRemoveAlbum = async () => {
    if (!token || !contextMenu.albumId) return;
    try {
      // unsaveAlbum throws on a non-2xx response, so local state is only touched once Spotify
      // has actually removed it. Previously the response was ignored and the album vanished
      // locally even when the request failed, leaving the library diverged until reload.
      const albumId = contextMenu.albumId;
      const album = albums.find((a) => a.id === albumId);
      // Which folders held it, so Undo can put it back where it was
      const folderIds = customFolders.filter((f) => f.playlistIds.includes(albumId)).map((f) => f.id);
      await unsaveAlbum(token, albumId);
      removeAlbumFromLibrary(albumId);
      closeMenu();
      toast(`Removed ${album?.name || 'album'} from your library`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await saveAlbumToLibrary(token, albumId);
              if (album) useUserStore.getState().setAlbums([...useUserStore.getState().albums, album]);
              folderIds.forEach((id) => addPlaylistToFolder(id, albumId));
            } catch (err) {
              console.error('Failed to restore album:', err);
              toast("Couldn't put the album back", { tone: 'error' });
            }
          }
        }
      });
    } catch (err) {
      console.error('Failed to remove album:', err);
      toast("Couldn't remove the album", { tone: 'error' });
    }
  };

  // Taking something out of a folder, or unpinning it, is one tap to undo
  const removeFromFolderWithUndo = (folderId, itemId, name) => {
    const folder = customFolders.find((f) => f.id === folderId);
    removePlaylistFromFolder(folderId, itemId);
    toast(`Removed ${name || 'it'} from ${folder?.name || 'the folder'}`, {
      action: { label: 'Undo', onClick: () => addPlaylistToFolder(folderId, itemId) }
    });
  };
  const togglePinWithUndo = () => {
    const name = contextMenu.track?.name || contextMenu.folderName
      || playlists.find((p) => p.id === activeId)?.name || albums.find((a) => a.id === activeId)?.name
      || customFolders.find((f) => f.id === activeId)?.name || 'it';
    togglePin(activeId, activeType);
    setContextMenu(null);
    if (isPinned) toast(`Unpinned ${name}`, { action: { label: 'Undo', onClick: () => togglePin(activeId, activeType) } });
    else toast(`Pinned ${name} to Home`);
  };

  const addToPlaylistMenu = (
      <div
        className="relative"
        onMouseEnter={() => { if (!isMobile) setShowPlaylistMenu(true); }}
        onMouseLeave={() => { if (!isMobile) setShowPlaylistMenu(false); }}
      >
        <button
          // Click as well as hover, so it works on touch screens
          onClick={() => setShowPlaylistMenu(v => !v)}
          className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-3">
            <Plus className="w-4 h-4 text-neutral-400" />
            <span>Add to Playlist</span>
          </div>
          {showPlaylistMenu && isMobile ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
        </button>

        {/* Desktop: a flyout beside the menu. Phone: the list unfolds inside the sheet. */}
        {showPlaylistMenu && (
          <div className={isMobile ? 'w-full' : `absolute top-0 z-50 ${flipSubmenu ? 'right-full pr-2 -mr-2' : 'left-full pl-2 -ml-2'}`}>
            <div
              style={isMobile ? undefined : { maxHeight: submenuMaxHeight }}
              className={isMobile
                ? 'w-full max-h-[45dvh] bg-black/30 border-y border-white/5 py-2 overflow-y-auto'
                : 'w-64 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-2 overflow-y-auto custom-scrollbar'}
            >
              {unfolderedPlaylists.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => handleAddToPlaylist(pl.id)}
                  className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors"
                >
                  {pl.name}
                </button>
              ))}

              {flattenFolderTree(customFolders).map(({ folder, path }) => {
                const folderPls = userPlaylists.filter(p => folder.playlistIds.includes(p.id));
                if (folderPls.length === 0) return null;
                const isOpen = openFolderIds.has(folder.id);

                return (
                  <div key={folder.id} className="mt-1 pt-1 border-t border-white/5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleFolderOpen(folder.id); }}
                      aria-expanded={isOpen}
                      title={path.join(' › ')}
                      className="w-full px-4 py-2 flex items-center justify-between text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                    >
                      <span className="flex items-center min-w-0">
                        <Folder className={`w-3.5 h-3.5 mr-2 shrink-0 ${isOpen ? 'text-[var(--brand-mid)]' : 'text-neutral-500'}`} />
                        {/* Nested folders show their path; the accordion itself stays one level deep */}
                        <span className="truncate font-medium">{path.join(' › ')}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] font-bold text-neutral-500 tabular-nums">{folderPls.length}</span>
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
                          : <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />}
                      </span>
                    </button>

                    {isOpen && folderPls.map(pl => (
                      <button
                        key={pl.id}
                        onClick={() => handleAddToPlaylist(pl.id)}
                        className="w-full text-left px-4 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 truncate transition-colors pl-9"
                      >
                        {pl.name}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
  );

  return createPortal(
    <>
      {/* The document click-outside handler closes the menu when this is tapped */}
      {isMobile && <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm animate-fade-in" aria-hidden="true" />}
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className={isMobile
        ? 'fixed z-[9999] inset-x-0 bottom-0 w-full max-h-[80dvh] overflow-y-auto bg-neutral-900 border-t border-neutral-700 rounded-t-2xl shadow-2xl pt-2 pb-[env(safe-area-inset-bottom)] select-none'
        : 'fixed z-[9999] w-56 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 overflow-visible focus:outline-none'}
    >
      {isMobile && <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />}
      {isMobile && (contextMenu.track?.name || contextMenu.folderName || (contextMenu.playlistId && playlists.find(p => p.id === contextMenu.playlistId)?.name)) && (
        <p className="px-4 pb-2 text-xs font-bold uppercase tracking-wider text-neutral-500 truncate border-b border-white/5 mb-1">
          {contextMenu.track?.name || contextMenu.folderName || playlists.find(p => p.id === contextMenu.playlistId)?.name}
        </p>
      )}

      {/* UNIVERSAL PIN TOGGLE */}
      {canPin && (
        <button
          onClick={togglePinWithUndo}
          className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors border-b border-white/5"
        >
          {isPinned ? <PinOff className="w-4 h-4 text-neutral-400" /> : <Pin className="w-4 h-4 text-neutral-400" />}
          <span>{isPinned ? 'Unpin from Home' : 'Pin to Home'}</span>
        </button>
      )}

      {moveRows && (
        <div className="flex border-b border-white/5">
          <button
            type="button"
            disabled={!moveRows.canUp}
            onClick={(e) => { e.stopPropagation(); moveRows.up(); }}
            className="flex-1 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-center space-x-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4 text-neutral-400" />
            <span>{moveRows.labels?.[0] || 'Move up'}</span>
          </button>
          <button
            type="button"
            disabled={!moveRows.canDown}
            onClick={(e) => { e.stopPropagation(); moveRows.down(); }}
            className="flex-1 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-center space-x-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-l border-white/5"
          >
            <ChevronDown className="w-4 h-4 text-neutral-400" />
            <span>{moveRows.labels?.[1] || 'Move down'}</span>
          </button>
        </div>
      )}

      {(contextMenu?.type === 'track' || contextMenu?.track) && (
        <>
          <button
            onClick={handleAddToQueue}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <ListPlus className="w-4 h-4 text-neutral-400" />
            <span>Add to Queue</span>
          </button>
          {trackId && (
            <MenuItem icon={Heart} label={trackLiked === true ? 'Remove from Liked Songs' : 'Save to Liked Songs'} onClick={handleLikeToggle} iconClass={trackLiked === true ? 'fill-[var(--brand-mid)] text-[var(--brand-mid)]' : ''} />
          )}

          {/* Navigation lives here rather than on names inside rows, which stole taps on phones.
              Tracks come from the Web API (ids) or the SDK (uris only), so resolve both. */}
          {(contextMenu.track?.artists || [])
            .map(a => ({ id: a.id || idFromUri(a.uri, 'artist'), name: a.name }))
            .filter(a => a.id)
            .slice(0, 3)
            .map(a => (
              <button
                key={a.id}
                onClick={() => { closeMenu(); setNowPlayingOpen(false); navigateToArtist(a.id); }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
              >
                <User className="w-4 h-4 text-neutral-400 shrink-0" />
                <span className="truncate">Go to {a.name}</span>
              </button>
            ))}
          {(() => {
            const albumId = contextMenu.track?.album?.id || idFromUri(contextMenu.track?.album?.uri, 'album');
            if (!albumId) return null;
            return (
              <button
                onClick={() => { closeMenu(); setNowPlayingOpen(false); navigateToAlbum(albumId); }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
              >
                <Disc3 className="w-4 h-4 text-neutral-400 shrink-0" />
                <span className="truncate">Go to album{contextMenu.track?.album?.name ? `: ${contextMenu.track.album.name}` : ''}</span>
              </button>
            );
          })()}

          {canRemove && (
            <button
              onClick={handleRemoveFromPlaylist}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from this playlist</span>
            </button>
          )}

          {addToPlaylistMenu}
          {trackId && <MenuItem icon={Share2} label="Share" onClick={() => share('track', trackId, contextMenu.track?.name)} />}
        </>
      )}

      {(contextMenu?.type === 'playlist' || contextMenu?.playlistId) && (
        <>
          <MenuItem icon={Play} label="Play" onClick={() => handlePlayContext(`spotify:playlist:${contextMenu.playlistId}`)} />
          {/* Yours: edit and delete. Someone else's: save it to the library, or take it out again */}
          {ownsMenuPlaylist && (
            <MenuItem icon={Pencil} label="Edit details" onClick={() => { closeMenu(); requestEditPlaylist(contextMenu.playlistId); navigateToPlaylist(contextMenu.playlistId); }} />
          )}
          {!ownsMenuPlaylist && !menuPlaylist && <MenuItem icon={BookmarkPlus} label="Save to your library" onClick={handleSavePlaylist} />}
          {!ownsMenuPlaylist && menuPlaylist && <MenuItem icon={BookmarkMinus} label="Remove from your library" onClick={handleUnfollowPlaylist} />}
          <MenuItem icon={Share2} label="Share" onClick={() => share('playlist', contextMenu.playlistId, menuPlaylist?.name)} />
          {/* Only a playlist you own can be deleted. Offering it on others' used to end in a
              confirm that did nothing, and read "undefined" for playlists not in the library. */}
          {ownsMenuPlaylist && (
            <button
              onClick={handleDeletePlaylist}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Delete playlist</span>
            </button>
          )}

          {contextMenu?.parentFolderId && (
            <button
              onClick={() => {
                removeFromFolderWithUndo(contextMenu.parentFolderId, contextMenu.playlistId, playlists.find((p) => p.id === contextMenu.playlistId)?.name);
                setContextMenu(null);
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          <div className="px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider font-bold flex items-center"><FolderPlus className="w-3 h-3 mr-2" /> Move to...</div>
          <MoveToList
            folders={customFolders}
            currentParentId={contextMenu?.parentFolderId ?? null}
            onPick={(folderId) => { addPlaylistToFolder(folderId, contextMenu.playlistId); closeMenu(); }}
            footer={newFolderEntry(contextMenu.playlistId)}
          />
        </>
      )}

      {(contextMenu?.type === 'album' || contextMenu?.albumId) && (
        <>
          <MenuItem icon={Play} label="Play" onClick={() => handlePlayContext(`spotify:album:${menuAlbumId}`)} />
          <MenuItem icon={ListPlus} label="Add to Queue" onClick={handleQueueAlbum} />
          {addToPlaylistMenu}
          {(menuAlbum?.artists || []).filter((a) => a?.id).slice(0, 3).map((a) => (
            <MenuItem key={a.id} icon={User} label={`Go to ${a.name}`} onClick={() => { closeMenu(); navigateToArtist(a.id); }} />
          ))}
          {albumInLibrary ? (
            <button
              onClick={handleRemoveAlbum}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from Library</span>
            </button>
          ) : (
            <MenuItem icon={BookmarkPlus} label="Save to your library" onClick={handleSaveAlbum} />
          )}
          <MenuItem icon={Share2} label="Share" onClick={() => share('album', menuAlbumId, menuAlbum?.name)} />

          {contextMenu?.parentFolderId && (
            <button
              onClick={() => {
                removeFromFolderWithUndo(contextMenu.parentFolderId, contextMenu.albumId, albums.find((a) => a.id === contextMenu.albumId)?.name);
                setContextMenu(null);
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          <div className="px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider font-bold flex items-center"><FolderPlus className="w-3 h-3 mr-2" /> Move to...</div>
          <MoveToList
            folders={customFolders}
            currentParentId={contextMenu?.parentFolderId ?? null}
            onPick={(folderId) => { addPlaylistToFolder(folderId, contextMenu.albumId); closeMenu(); }}
            footer={newFolderEntry(contextMenu.albumId)}
          />
        </>
      )}

      {contextMenu?.type === 'artist' && menuArtistId && (
        <>
          <MenuItem icon={Play} label="Play" onClick={() => handlePlayContext(`spotify:artist:${menuArtistId}`)} />
          <MenuItem icon={artistFollowed ? UserCheck : UserPlus} label={artistFollowed ? 'Unfollow' : 'Follow'} onClick={handleFollowArtist} iconClass={artistFollowed ? 'text-[var(--brand-mid)]' : ''} />
          {!contextMenu.onArtistPage && <MenuItem icon={User} label="Go to artist" onClick={() => { closeMenu(); navigateToArtist(menuArtistId); }} />}
          <MenuItem icon={Share2} label="Share" onClick={() => share('artist', menuArtistId, menuArtist?.name)} />
        </>
      )}

      {contextMenu?.type === 'folder' && folder && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFolderDialog({ mode: 'rename', folderId: folder.id, name: folder.name });
              setContextMenu(null);
            }}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Pencil className="w-4 h-4 text-neutral-400" />
            <span>Rename folder</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFolderDialog({ mode: 'create', parentId: folder.id });
              setContextMenu(null);
            }}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <FolderPlus className="w-4 h-4 text-neutral-400" />
            <span>New subfolder</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMoveFolder(v => !v); }}
            aria-expanded={showMoveFolder}
            className="w-full px-4 py-3 text-left text-sm font-medium text-white hover:bg-neutral-800 flex items-center justify-between transition-colors"
          >
            <span className="flex items-center space-x-3">
              <CornerDownRight className="w-4 h-4 text-neutral-400" />
              <span>Move folder to…</span>
            </span>
            {showMoveFolder ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
          </button>
          {showMoveFolder && (
            <MoveToList
              folders={customFolders}
              currentParentId={folder.parentId ?? null}
              excludeIds={new Set([folder.id, ...descendantIds(customFolders, folder.id)])}
              allowRoot
              onPick={(targetId) => { moveFolder(folder.id, targetId); closeMenu(); }}
            />
          )}
          <button
            onClick={handleDeleteFolder}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-400 hover:bg-neutral-800 flex items-center space-x-3 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Delete folder</span>
          </button>
        </>
      )}

      {dialogs}
    </div>
    </>,
    document.body
  );
}