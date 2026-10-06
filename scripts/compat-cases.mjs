// The 2026 endpoint migration layer: shapes are normalised and the fallback behaves.
import { normalizeEntry, normalizePage, normalizePlaylist, bothPlaylistFields, bothPageFields, swapItemsPath, isPlaylistItemsUrl, playlistItemsUrl, withFallback, newEndpointRefused } from '../src/services/spotify/compat.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };

check('an entry with item gains track', normalizeEntry({ item: { id: 'a' } }).track?.id === 'a');
check('an entry with track is left alone', normalizeEntry({ track: { id: 'a' } }).item === undefined);
check('a null entry survives', normalizeEntry(null) === null);
check('a page maps its entries', normalizePage({ items: [{ item: { id: 'x' } }], next: null }).items[0].track.id === 'x');
check('a playlist with items gets tracks', normalizePlaylist({ id: 'p', items: { total: 1, items: [{ item: { id: 'x' } }] } }).tracks.items[0].track.id === 'x');
check('a playlist with tracks keeps them, entries normalised', normalizePlaylist({ id: 'p', tracks: { total: 1, items: [{ item: { id: 'y' } }] } }).tracks.items[0].track.id === 'y');
check('a summary with only a total keeps it', normalizePlaylist({ id: 'p', items: { total: 7 } }).tracks.total === 7);
check('a playlist with neither is left alone', normalizePlaylist({ id: 'p', name: 'n' }).tracks === undefined);

const f = bothPlaylistFields('id,name,images,owner(id,display_name),tracks.total');
check('fields names both tracks.total and items.total', f === 'id,name,images,owner(id,display_name),tracks.total,items.total');
const g = bothPageFields('next,items(added_by(id),track(uri,name,artists(name)))');
check('nested track becomes item and keeps track', g === 'next,items(added_by(id),track(uri,name,artists(name)),item(uri,name,artists(name)))');
check('snapshot fields keep both names', bothPlaylistFields('id,name,snapshot_id,tracks(total)') === 'id,name,snapshot_id,tracks(total),items(total)');

check('items url', playlistItemsUrl('p1', 'limit=1') === 'https://api.spotify.com/v1/playlists/p1/items?limit=1');
check('legacy url', playlistItemsUrl('p1', '', { legacy: true }).endsWith('/playlists/p1/tracks'));
check('swap to legacy', swapItemsPath('https://api.spotify.com/v1/playlists/p1/items?offset=100&limit=100', true) === 'https://api.spotify.com/v1/playlists/p1/tracks?offset=100&limit=100');
check('swap to new', swapItemsPath('https://api.spotify.com/v1/playlists/p1/tracks?offset=1', false).includes('/items?offset=1'));
check('me/tracks is not a playlist items url', !isPlaylistItemsUrl('https://api.spotify.com/v1/me/tracks?limit=50'));
check('an album page is not either', !isPlaylistItemsUrl('https://api.spotify.com/v1/albums/al1/tracks?offset=50'));
check('a playlist page is', isPlaylistItemsUrl('https://api.spotify.com/v1/playlists/p1/tracks?offset=50'));

// Fallback: refused new → old, remembered; rate-limited new → returned as is
const res = (status) => ({ ok: status < 400, status });
{
  let calls = [];
  const r1 = await withFallback('t1', async () => { calls.push('new'); return res(404); }, async () => { calls.push('old'); return res(200); });
  check('refused new falls back to old', r1.status === 200 && calls.join() === 'new,old');
  calls = [];
  const r2 = await withFallback('t1', async () => { calls.push('new'); return res(200); }, async () => { calls.push('old'); return res(200); });
  check('the refusal is remembered: old goes first next time', r2.status === 200 && calls.join() === 'old' && newEndpointRefused('t1'));
  calls = [];
  const r3 = await withFallback('t2', async () => { calls.push('new'); return res(429); }, async () => { calls.push('old'); return res(200); });
  check('a rate limit on the new one is not a refusal', r3.status === 429 && calls.join() === 'new' && !newEndpointRefused('t2'));
  const r4 = await withFallback('t3', async () => res(200), async () => res(200));
  check('a working new endpoint is used alone', r4.status === 200 && !newEndpointRefused('t3'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
