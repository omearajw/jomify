import { fetchMoreTracks, addTracksToPlaylist, removeTracksFromPlaylist } from '../services/spotify/api';
import { playlistItemsUrl } from '../services/spotify/compat';
import { cleanString } from './strings';

// The pile is the playlist named "unadded songs": liked songs that are in none of the check
// playlists. These are the check itself (what the pile should gain and lose) and the apply step,
// shared by the room's Unadded mode and the old playlist page.

export const isPile = (playlist) => (playlist?.name || '').toLowerCase() === 'unadded songs';

export async function fetchAllPages(token, initialUrl, label) {
  const items = [];
  let url = initialUrl;
  while (url) {
    let data;
    try { data = await fetchMoreTracks(token, url); }
    catch (err) { throw new Error(`Couldn't load ${label} (${err?.status ? `Spotify returned ${err.status}` : err?.message || 'no answer'}). Nothing was changed.`, { cause: err }); }
    if (!Array.isArray(data.items)) throw new Error(`Unexpected response while loading ${label}. Nothing was changed.`);
    items.push(...data.items);
    url = data.next;
  }
  return items;
}

const keyOf = (track) => `${cleanString(track.name)}_${track.artists?.[0]?.name ? cleanString(track.artists[0].name) : ''}`;

// What the check would change: songs to take out of the pile (unliked, or now in a check
// playlist) and liked songs to add. Nothing is touched here.
export async function planUnaddedCheck({ token, pileId, checkIds, onStatus = () => {} }) {
  onStatus('Fetching all liked songs');
  const liked = await fetchAllPages(token, 'https://api.spotify.com/v1/me/tracks?limit=50', 'your liked songs');
  onStatus('Scanning the check playlists');
  const inChecks = new Set();
  for (const id of checkIds) {
    for (const item of await fetchAllPages(token, playlistItemsUrl(id, 'limit=100'), 'a check playlist')) {
      if (item.track?.id) { inChecks.add(item.track.id); inChecks.add(keyOf(item.track)); }
    }
  }
  onStatus('Scanning the pile');
  const pile = await fetchAllPages(token, playlistItemsUrl(pileId, 'limit=100'), 'the pile');
  const likedIds = new Set(liked.map((i) => i.track?.id).filter(Boolean));
  const pileIds = new Set(pile.map((i) => i.track?.id).filter(Boolean));
  const remove = [];
  for (const item of pile) {
    const tr = item.track;
    if (!tr?.id) continue;
    const isLiked = likedIds.has(tr.id);
    const present = inChecks.has(tr.id) || inChecks.has(keyOf(tr));
    if (!isLiked || present) remove.push({ uri: tr.uri, name: tr.name, artist: tr.artists?.[0]?.name || '', reason: !isLiked ? 'unliked' : 'sorted' });
  }
  const add = [];
  for (const item of liked) {
    const tr = item.track;
    if (!tr?.id) continue;
    if (!(inChecks.has(tr.id) || inChecks.has(keyOf(tr))) && !pileIds.has(tr.id)) add.push({ uri: `spotify:track:${tr.id}`, name: tr.name, artist: tr.artists?.[0]?.name || '' });
  }
  return { remove, add };
}

export async function applyUnaddedPlan({ token, pileId, plan, onStatus = () => {} }) {
  if (plan.remove.length) {
    onStatus(`Removing ${plan.remove.length} song${plan.remove.length === 1 ? '' : 's'}`);
    for (let i = 0; i < plan.remove.length; i += 100) {
      try { await removeTracksFromPlaylist(token, pileId, plan.remove.slice(i, i + 100).map((t) => t.uri)); }
      catch (err) { throw new Error(`Removing songs failed partway (Spotify returned ${err?.status || '?'}). Run the check again to finish.`, { cause: err }); }
    }
  }
  if (plan.add.length) {
    onStatus(`Adding ${plan.add.length} song${plan.add.length === 1 ? '' : 's'}`);
    for (let i = 0; i < plan.add.length; i += 100) {
      try { await addTracksToPlaylist(token, pileId, plan.add.slice(i, i + 100).map((t) => t.uri)); }
      catch (err) { throw new Error(`Adding songs failed partway (${err?.message || 'Spotify refused'}). Run the check again to finish.`, { cause: err }); }
    }
  }
}
