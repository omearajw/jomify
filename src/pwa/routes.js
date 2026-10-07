// Jomify's addresses. The store stays the source of truth for the page shown; these two
// functions translate a view frame to a path and a path back to a frame, so the browser's
// address bar, Back and Forward, reloads and shared links all agree with the store.

const VIEW_PATHS = { home: '/', browse: '/search', library: '/library', sevens: '/sevens', friends: '/friends', 'liked-songs': '/liked', lyrics: '/lyrics', party: '/party' };
const PATH_VIEWS = Object.fromEntries(Object.entries(VIEW_PATHS).map(([v, p]) => [p, v]));

export function frameToPath(frame, extras = {}) {
  const enc = encodeURIComponent;
  switch (frame?.view) {
    case 'playlist': return frame.playlistId ? `/playlist/${enc(frame.playlistId)}` : '/library';
    case 'album': return frame.albumId ? `/album/${enc(frame.albumId)}` : '/';
    case 'artist': return frame.artistId ? `/artist/${enc(frame.artistId)}` : '/';
    case 'user': return frame.userId ? `/user/${enc(frame.userId)}` : '/friends';
    case 'library': return frame.folderId ? `/library/folder/${enc(frame.folderId)}` : '/library';
    case 'browse': return extras.query ? `/search?q=${enc(extras.query)}` : '/search';
    default: return VIEW_PATHS[frame?.view] || '/';
  }
}

// null when the path isn't one of ours (the app then opens as it would have anyway)
export function pathToFrame(pathname, search = '') {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (PATH_VIEWS[path]) {
    const frame = { view: PATH_VIEWS[path], playlistId: null, artistId: null, albumId: null, folderId: null, userId: null };
    if (frame.view === 'browse') frame.query = new URLSearchParams(search).get('q') || '';
    return frame;
  }
  const m = path.match(/^\/(playlist|album|artist|user|library\/folder)\/([^/]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[2]);
  const base = { view: null, playlistId: null, artistId: null, albumId: null, folderId: null, userId: null };
  switch (m[1]) {
    case 'playlist': return { ...base, view: 'playlist', playlistId: id };
    case 'album': return { ...base, view: 'album', albumId: id };
    case 'artist': return { ...base, view: 'artist', artistId: id };
    case 'user': return { ...base, view: 'user', userId: id };
    case 'library/folder': return { ...base, view: 'library', folderId: id };
    default: return null;
  }
}

export const frameOf = (state) => ({
  view: state.currentView,
  playlistId: state.activePlaylistId,
  artistId: state.currentArtistId,
  albumId: state.currentAlbumId,
  folderId: state.activeFolderId,
  userId: state.currentUserId
});

export const sameFrame = (a, b) => Boolean(a && b) && ['view', 'playlistId', 'artistId', 'albumId', 'folderId', 'userId'].every((k) => (a[k] ?? null) === (b[k] ?? null));
