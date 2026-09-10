// Which playlists and albums are NOT inside any folder. Sidebar, Library and ContextMenu each
// derived this with their own copy of the same nested .some()/.includes() scan, and the
// ContextMenu copy had quietly drifted. One Set of every foldered id makes it one pass.
export function getUnfolderedItems(playlists = [], albums = [], folders = []) {
  const foldered = new Set(folders.flatMap(f => f.playlistIds || []));
  return {
    playlists: playlists.filter(p => !foldered.has(p.id)),
    albums: (albums || []).filter(a => !foldered.has(a.id))
  };
}
