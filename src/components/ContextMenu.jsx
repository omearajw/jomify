import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUserStore } from '../store/userStore';
import { useQueueStore } from '../store/queueStore';
import { nudge as nudgeQueue } from '../services/queueConductor';
import { playOn } from '../services/spotify/playbackController';
import {
  addTracksToPlaylist, removeTrackFromPlaylist, removeTracksFromPlaylist, unfollowPlaylist, unsaveAlbum, saveAlbumToLibrary,
  followPlaylist, fetchPlaylistSummary, fetchAlbumsByIds, fetchAlbumTracks, fetchAlbumTrackUris, playContext, toggleTrackLike, checkTracksLiked,
  followArtists, unfollowArtists
} from '../services/spotify/api';
import { shareSpotifyLink } from '../services/share';
import { ListPlus, Plus, ChevronRight, Trash2, FolderPlus, Pin, PinOff, Pencil, User, Disc3, Heart, Play, Share2, UserPlus, UserCheck, BookmarkPlus, BookmarkMinus, CheckSquare } from 'lucide-react';
import { idFromUri } from '../utils/spotifyUri';
import FolderFormDialog from './FolderFormDialog';
import { toast } from '../store/toastStore';
import { flattenFolderTree, descendantIds } from '../utils/library';
import { useIsMobile } from '../hooks/useMediaQuery';
import ConfirmDialog from './ConfirmDialog';
import { recentTargets, noteTarget } from '../utils/recentTargets';
import { useSlice } from '../store/selectors';

// One ordinary entry: a word on a hairline. The icon is kept for the phone's sheet, where a
// glyph helps a thumb; on the language the row is the label alone.
// eslint-disable-next-line no-unused-vars
function MenuItem({ icon: Icon, label, onClick, iconClass = '', danger = false }) {
  return (
    <button type="button" onClick={onClick} className={`ui-row px-5 ${danger ? 'ui-row-danger' : ''}`}>
      <span className="truncate">{label}</span>
    </button>
  );
}

const VIEWPORT_PAD = 8;


const Label = ({ children }) => <p className="room-mono px-5 pb-1 pt-3 text-[var(--room-faint)]">{children}</p>;
const Row = ({ onClick, name, detail, disabled }) => (
  <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} className="ui-row px-5">
    <span className="min-w-0 flex-1 truncate">{name}{detail && <span className="text-[var(--room-faint)]"> · {detail}</span>}</span>
  </button>
);

// The picker that "Add to playlist" and "Move to" open in place of the menu's rows: a search
// field and one flat list, nothing to expand (DESIGN.md §11, 14 Oct). Playlists carry their
// folder as a detail beside the name; folders are rows with their path. Drag onto the tree is
// the first way to do either; this is the fallback, and the phone's way.
function PickerBody({ kind, query, setQuery, onBack, playlists, folders, pinnedIds, onPickPlaylist, move, maxHeight }) {
  const q = query.trim().toLowerCase();
  let body;
  if (kind === 'add') {
    const inFolder = new Map();
    for (const f of folders) for (const id of f.playlistIds || []) inFolder.set(id, f);
    const row = (p) => <Row key={p.id} onClick={() => onPickPlaylist(p.id)} name={p.name} detail={inFolder.get(p.id)?.name} />;
    const byName = (x, y) => (x.name || '').localeCompare(y.name || '', undefined, { sensitivity: 'base' });
    if (q) {
      const hits = playlists.filter((p) => (p.name || '').toLowerCase().includes(q)).sort(byName);
      body = hits.length ? hits.map(row) : <p className="px-5 py-5 text-[13px] text-[var(--room-faint)]">Nothing matches</p>;
    } else {
      const recentIds = recentTargets();
      const recent = recentIds.map((id) => playlists.find((p) => p.id === id)).filter(Boolean);
      const pinned = playlists.filter((p) => pinnedIds.has(p.id) && !recentIds.includes(p.id));
      const shown = new Set([...recent, ...pinned].map((p) => p.id));
      const rest = playlists.filter((p) => !shown.has(p.id)).sort(byName);
      body = (
        <>
          {recent.length > 0 && <><Label>Recent</Label>{recent.map(row)}</>}
          {pinned.length > 0 && <><Label>Pinned</Label>{pinned.map(row)}</>}
          {(recent.length > 0 || pinned.length > 0) && <Label>All</Label>}
          {rest.map(row)}
        </>
      );
    }
  } else {
    const rows = flattenFolderTree(folders, { exclude: move?.excludeIds || new Set() });
    const list = q ? rows.filter(({ path }) => path.join(' ').toLowerCase().includes(q)) : rows;
    body = (
      <>
        {!q && move?.currentParentId && move.onOut && <Row onClick={move.onOut} name="Out of any folder" />}
        {!q && move?.allowRoot && <Row onClick={() => move.onPick(null)} name="Top level" disabled={move.currentParentId === null} />}
        {list.map(({ folder, path }) => (
          <Row key={folder.id} onClick={() => move.onPick(folder.id)} name={folder.name} detail={path.length > 1 ? path.slice(0, -1).join(' › ') : undefined} disabled={folder.id === move?.currentParentId} />
        ))}
        {q && list.length === 0 && <p className="px-5 py-5 text-[13px] text-[var(--room-faint)]">Nothing matches</p>}
        {move?.footer}
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-5 pb-1">
        <span className="room-mono text-[var(--room-faint)]">{kind === 'add' ? 'Add to playlist' : 'Move to'}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onBack(); }} className="ui-word">Back</button>
      </div>
      <div className="px-5 pb-1">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onBack(); } }}
          placeholder={kind === 'add' ? 'Find a playlist' : 'Find a folder'}
          aria-label={kind === 'add' ? 'Find a playlist' : 'Find a folder'}
          className="ui-field [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div className="custom-scrollbar overflow-y-auto" style={{ maxHeight }}>{body}</div>
    </div>
  );
}

export default function ContextMenu() {
  const {
    contextMenu, setContextMenu, token, triggerQueueRefresh,
    playlists, albums, customFolders, profile, deletePlaylist, deleteFolder, setCurrentView, setActivePlaylistId,
    removeAlbumFromLibrary, addPlaylistToFolder, removePlaylistFromFolder, renameFolder, createFolder, moveFolder,
    pinnedItems, togglePin, navigateToArtist, navigateToAlbum, setNowPlayingOpen,
    setPlaylists, setAlbums, likedTracks, setLikedTracks, followedArtists, addFollowedArtist, removeFollowedArtist,
    navigateToPlaylist, requestEditPlaylist
  } = useSlice(useUserStore, [
    'contextMenu', 'setContextMenu', 'token', 'triggerQueueRefresh',
    'playlists', 'albums', 'customFolders', 'profile', 'deletePlaylist', 'deleteFolder', 'setCurrentView', 'setActivePlaylistId',
    'removeAlbumFromLibrary', 'addPlaylistToFolder', 'removePlaylistFromFolder', 'renameFolder', 'createFolder', 'moveFolder',
    
    'pinnedItems', 'togglePin', 'navigateToArtist', 'navigateToAlbum', 'setNowPlayingOpen',
    'setPlaylists', 'setAlbums', 'likedTracks', 'setLikedTracks', 'followedArtists', 'addFollowedArtist', 'removeFollowedArtist',
    'navigateToPlaylist', 'requestEditPlaylist'
  ]);

  const menuRef = useRef(null);
  const isMobile = useIsMobile();
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

  // Which folder groups in the "Add to Playlist" submenu are expanded. Every folder starts
  // closed each time the menu opens, so a big library is a short list of folders rather than
  // one long scroll of every playlist.
  // the picker in place of the rows: { kind: 'add' } or { kind: 'move', ... }
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerFor, setPickerFor] = useState(null);
  if (pickerFor !== contextMenu) { setPickerFor(contextMenu); setPicker(null); setPickerQuery(''); }

  const closeMenu = () => {
    setContextMenu(null);
    setPicker(null);
    setPickerQuery('');
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
  const submenuMaxHeight = Math.max(160, window.innerHeight - contextMenu.y - VIEWPORT_PAD - 48);

  // Anything you can actually add tracks to: playlists you own, plus collaborative ones. The
  // old owner-only filter silently hid collaborative playlists you had write access to.
  const userPlaylists = playlists.filter(p => p.owner?.id === profile?.id || p.collaborative);

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
      className="ui-row px-5"
    >
      <Plus className="w-3.5 h-3.5 text-[var(--room-faint)]" /> New folder…
    </button>
  );

  const sourcePlaylist = contextMenu.sourcePlaylistId ? playlists.find(p => p.id === contextMenu.sourcePlaylistId) : null;
  const folder = contextMenu?.folderId ? customFolders.find(f => f.id === contextMenu.folderId) : null;
  const canRemove = sourcePlaylist && sourcePlaylist.owner.id === profile?.id;

  // One-step reordering for touch screens, where the sidebar's drag-and-drop can't be used.
  // Neighbour ids drive the same store actions a drop would.

  // Sandbox Pinning Logic
  const activeId = contextMenu?.playlistId || contextMenu?.albumId || contextMenu?.folderId;
  const activeType = contextMenu?.type;
  const canPin = ['playlist', 'album', 'folder'].includes(activeType);
  const isPinned = canPin ? pinnedItems.some(i => i.id === activeId) : false;

  // Several rows selected: the menu acts on all of them; `tracks` stands in for `track`
  const manyTracks = Array.isArray(contextMenu?.tracks) ? contextMenu.tracks.filter((t) => t?.uri) : null;
  const trackList = manyTracks || (contextMenu?.track ? [contextMenu.track] : []);
  const describeMany = (list) => (list.length === 1 ? `"${list[0].name}"` : `${list.length} songs`);

  // Jomify holds the queue and hands Spotify each song when it is due (services/queueConductor.js)
  const handleAddToQueue = () => {
    const list = trackList;
    if (!token || list.length === 0) return;
    closeMenu();
    useQueueStore.getState().add(list);
    nudgeQueue();
    triggerQueueRefresh();
    toast(`Queued ${describeMany(list)}`, { tone: 'success' });
    contextMenu.onDone?.();
  };

  const menuAlbumId = contextMenu?.albumId || null;
  const menuAlbum = contextMenu?.album || albums.find((a) => a.id === menuAlbumId) || null;
  const albumInLibrary = Boolean(menuAlbumId) && albums.some((a) => a.id === menuAlbumId);
  const menuArtistId = contextMenu?.artistId || null;
  const menuArtist = contextMenu?.artist || followedArtists.find((a) => a.id === menuArtistId) || null;
  const artistFollowed = Boolean(menuArtistId) && followedArtists.some((a) => a.id === menuArtistId);

  // What "Add to playlist" adds: the song, or every song of the album
  const handleAddToPlaylist = async (playlistId) => {
    if (!token || (trackList.length === 0 && !menuAlbumId)) return;
    const playlistName = playlists.find(p => p.id === playlistId)?.name || 'playlist';
    const what = trackList.length ? describeMany(trackList) : `"${menuAlbum?.name || 'the album'}"`;
    const onDone = contextMenu.onDone;
    closeMenu();
    try {
      const uris = trackList.length ? trackList.map((t) => t.uri) : await fetchAlbumTrackUris(token, menuAlbumId);
      for (let i = 0; i < uris.length; i += 100) await addTracksToPlaylist(token, playlistId, uris.slice(i, i + 100));
      noteTarget(playlistId);
      toast(`Added ${what} to ${playlistName}`, { tone: 'success' });
      onDone?.();
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

  const handleQueueAlbum = async () => {
    if (!token || !menuAlbumId) return;
    closeMenu();
    try {
      const tracks = await fetchAlbumTracks(token, menuAlbumId);
      useQueueStore.getState().add(tracks);
      nudgeQueue();
      triggerQueueRefresh();
      toast(`Added ${tracks.length} song${tracks.length === 1 ? '' : 's'} to the queue`, { tone: 'success' });
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
    if (!token || trackList.length === 0 || !contextMenu.sourcePlaylistId) return;
    const { sourcePlaylistId, onRemoved, onRemovedMany, onDone } = contextMenu;
    const list = trackList;
    setContextMenu(null);
    try {
      if (list.length === 1) await removeTrackFromPlaylist(token, sourcePlaylistId, list[0].uri);
      else await removeTracksFromPlaylist(token, sourcePlaylistId, list.map((t) => t.uri));
      // The open playlist drops the rows and offers an undo; without this the row stayed until
      // a reload, with no sign anything had happened
      if (list.length > 1 && onRemovedMany) onRemovedMany(list);
      else if (onRemoved) list.forEach((t) => onRemoved(t));
      else toast(`Removed ${describeMany(list)}`, { tone: 'info' });
      onDone?.();
    } catch (err) {
      console.error(err);
      toast(`Couldn't remove ${describeMany(list)}`, { tone: 'error' });
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
    <button type="button" onClick={(e) => { e.stopPropagation(); setPicker({ kind: 'add' }); }} className="ui-row px-5 justify-between">
      <span>Add to playlist</span>
      <ChevronRight className="h-3.5 w-3.5 text-[var(--room-faint)]" />
    </button>
  );
  const moveRow = (label, opts) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); setPicker({ kind: 'move', ...opts }); }} className="ui-row px-5 justify-between">
      <span>{label}</span>
      <ChevronRight className="h-3.5 w-3.5 text-[var(--room-faint)]" />
    </button>
  );

  return createPortal(
    <>
      {/* The document click-outside handler closes the menu when this is tapped */}
      {isMobile && <div className="fixed inset-0 z-[9998] bg-black/60 animate-fade-in" aria-hidden="true" />}
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className={isMobile
        ? 'fixed z-[9999] inset-x-0 bottom-0 w-full max-h-[80dvh] overflow-y-auto ui-plane rounded-t-[10px] pt-2 pb-[env(safe-area-inset-bottom)] select-none'
        : `fixed z-[9999] ${picker ? 'w-80' : 'w-64'} ui-plane py-2 overflow-visible focus:outline-none`}
    >
      {isMobile && <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/25" aria-hidden="true" />}
      {isMobile && (contextMenu.track?.name || contextMenu.folderName || (contextMenu.playlistId && playlists.find(p => p.id === contextMenu.playlistId)?.name)) && (
        <p className="px-5 pb-2 room-mono text-[var(--room-faint)] truncate">
          {contextMenu.track?.name || contextMenu.folderName || playlists.find(p => p.id === contextMenu.playlistId)?.name}
        </p>
      )}

      {picker ? (
        <PickerBody
          kind={picker.kind}
          query={pickerQuery}
          setQuery={setPickerQuery}
          onBack={() => { setPicker(null); setPickerQuery(''); }}
          playlists={userPlaylists}
          folders={customFolders}
          pinnedIds={new Set(pinnedItems.map((p) => p.id))}
          onPickPlaylist={handleAddToPlaylist}
          move={picker.kind === 'move' ? picker : null}
          maxHeight={isMobile ? '55dvh' : Math.min(window.innerHeight * 0.6, submenuMaxHeight)}
        />
      ) : (<>
      {/* UNIVERSAL PIN TOGGLE */}
      {canPin && (
        <button
          onClick={togglePinWithUndo}
          className="ui-row px-5"
        >
          {isPinned ? <PinOff className="w-4 h-4 text-[var(--room-dim)]" /> : <Pin className="w-4 h-4 text-[var(--room-dim)]" />}
          <span>{isPinned ? 'Unpin from Home' : 'Pin to Home'}</span>
        </button>
      )}

      {(contextMenu?.type === 'track' || contextMenu?.track || manyTracks) && (
        <>
          {manyTracks && (
            <p className="px-5 pb-2 room-mono text-[var(--room-faint)]">{manyTracks.length} songs selected</p>
          )}
          {contextMenu.onSelect && !manyTracks && (
            <MenuItem icon={CheckSquare} label="Select" onClick={() => { const fn = contextMenu.onSelect; closeMenu(); fn(); }} />
          )}
          <button
            onClick={handleAddToQueue}
            className="ui-row px-5"
          >
            <ListPlus className="w-4 h-4 text-[var(--room-dim)]" />
            <span>Add to Queue</span>
          </button>
          {trackId && !manyTracks && (
            <MenuItem icon={Heart} label={trackLiked === true ? 'Remove from Liked Songs' : 'Save to Liked Songs'} onClick={handleLikeToggle} iconClass={trackLiked === true ? 'fill-[var(--room-paper)] text-[var(--room-paper)]' : ''} />
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
                className="ui-row px-5"
              >
                <User className="w-4 h-4 text-[var(--room-dim)] shrink-0" />
                <span className="truncate">Go to {a.name}</span>
              </button>
            ))}
          {(() => {
            const albumId = contextMenu.track?.album?.id || idFromUri(contextMenu.track?.album?.uri, 'album');
            if (!albumId) return null;
            return (
              <button
                onClick={() => { closeMenu(); setNowPlayingOpen(false); navigateToAlbum(albumId); }}
                className="ui-row px-5"
              >
                <Disc3 className="w-4 h-4 text-[var(--room-dim)] shrink-0" />
                <span className="truncate">Go to album{contextMenu.track?.album?.name ? `: ${contextMenu.track.album.name}` : ''}</span>
              </button>
            );
          })()}

          {canRemove && (
            <button
              onClick={handleRemoveFromPlaylist}
              className="ui-row ui-row-danger px-5"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from this playlist</span>
            </button>
          )}

          {addToPlaylistMenu}
          {trackId && !manyTracks && <MenuItem icon={Share2} label="Share" onClick={() => share('track', trackId, contextMenu.track?.name)} />}
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
              className="ui-row ui-row-danger px-5"
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
              className="ui-row ui-row-danger px-5"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          {moveRow('Move to folder', { currentParentId: contextMenu?.parentFolderId ?? null, onPick: (folderId) => { addPlaylistToFolder(folderId, contextMenu.playlistId); closeMenu(); }, onOut: () => { removeFromFolderWithUndo(contextMenu.parentFolderId, contextMenu.playlistId, playlists.find((p) => p.id === contextMenu.playlistId)?.name); setContextMenu(null); }, footer: newFolderEntry(contextMenu.playlistId) })}
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
              className="ui-row ui-row-danger px-5"
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
              className="ui-row ui-row-danger px-5"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Remove from folder</span>
            </button>
          )}

          {moveRow('Move to folder', { currentParentId: contextMenu?.parentFolderId ?? null, onPick: (folderId) => { addPlaylistToFolder(folderId, contextMenu.albumId); closeMenu(); }, onOut: () => { removeFromFolderWithUndo(contextMenu.parentFolderId, contextMenu.albumId, albums.find((a) => a.id === contextMenu.albumId)?.name); setContextMenu(null); }, footer: newFolderEntry(contextMenu.albumId) })}
        </>
      )}

      {contextMenu?.type === 'artist' && menuArtistId && (
        <>
          <MenuItem icon={Play} label="Play" onClick={() => handlePlayContext(`spotify:artist:${menuArtistId}`)} />
          <MenuItem icon={artistFollowed ? UserCheck : UserPlus} label={artistFollowed ? 'Unfollow' : 'Follow'} onClick={handleFollowArtist} iconClass={artistFollowed ? 'text-[var(--room-paper)]' : ''} />
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
            className="ui-row px-5"
          >
            <Pencil className="w-4 h-4 text-[var(--room-dim)]" />
            <span>Rename folder</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFolderDialog({ mode: 'create', parentId: folder.id });
              setContextMenu(null);
            }}
            className="ui-row px-5"
          >
            <FolderPlus className="w-4 h-4 text-[var(--room-dim)]" />
            <span>New subfolder</span>
          </button>
          {moveRow('Move folder to', { currentParentId: folder.parentId ?? null, excludeIds: new Set([folder.id, ...descendantIds(customFolders, folder.id)]), allowRoot: true, onPick: (targetId) => { moveFolder(folder.id, targetId); closeMenu(); } })}
          <button
            onClick={handleDeleteFolder}
            className="ui-row ui-row-danger px-5"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Delete folder</span>
          </button>
        </>
      )}

      {dialogs}
      </>)}
    </div>
    </>,
    document.body
  );
}