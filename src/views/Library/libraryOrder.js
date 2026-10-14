// How the library page orders and filters its things; shared by the old page and the room's
export const SORT_OPTIONS = [
  { id: 'recent', label: 'Recently played' },
  { id: 'spotify', label: 'Spotify order' },
  { id: 'az', label: 'A to Z' },
  { id: 'za', label: 'Z to A' },
  { id: 'owner', label: 'By owner' }
];
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'folders', label: 'Folders' }
];
export const ownerOf = (item) => (item.type === 'album' ? (item.artists?.map(a => a.name).join(', ') || '') : (item.owner?.display_name || ''));
// `lastPlayed` maps a context uri to the time it was last played, from Spotify's recently-played
// feed: only the last 50 plays, so most things fall back to Spotify's order behind them
export function sortItems(items, mode, lastPlayed = null) {
  if (mode === 'spotify') return items;
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  const sorted = [...items];
  if (mode === 'recent') {
    const at = (item) => lastPlayed?.get(`spotify:${item.type === 'album' ? 'album' : item.type === 'artist' ? 'artist' : 'playlist'}:${item.id}`) || 0;
    return sorted.map((item, i) => ({ item, i, t: at(item) })).sort((a, b) => (b.t - a.t) || (a.i - b.i)).map((x) => x.item);
  }
  if (mode === 'az') sorted.sort(byName);
  else if (mode === 'za') sorted.sort((a, b) => byName(b, a));
  else if (mode === 'owner') sorted.sort((a, b) => ownerOf(a).localeCompare(ownerOf(b), undefined, { sensitivity: 'base' }) || byName(a, b));
  return sorted;
}
