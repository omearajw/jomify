import { useUserStore } from '../../store/userStore';
import { ensureFreshToken, isTokenStale } from './session';
import { timeoutSignal, REQUEST_TIMEOUT_MS } from './http';
import { log } from '../debugLog';
import { toSpotifyDescription } from '../../utils/strings';
import {
  API, withFallback, newEndpointRefused, markNewEndpointRefused, playlistItemsUrl, swapItemsPath, isPlaylistItemsUrl, bothPlaylistFields, bothPageFields,
  normalizePage, normalizePlaylist,
  LIBRARY_BATCH, trackUri, albumUri, userUri, playlistUri, artistUri, libraryUrl, libraryContainsUrl
} from './compat';

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const statusError = (message, response) => {
  const err = new Error(`${message} (${response.status})`);
  err.status = response.status;
  return err;
};
const authJson = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

// A few things at a time: enough to be quick, not enough to trip the rate limit
async function inBatches(items, size, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(worker))));
  }
  return out;
}

// The library: one endpoint for liked songs, saved albums, followed people and playlists, in
// place of the four it replaced. Each takes URIs, 40 at a time.
const libraryWrite = (token, method, uris) => spotifyFetch(libraryUrl(uris), { method, headers: auth(token) });

// "GET /v1/me/player" for the log: the path names the endpoint, and the query string adds nothing
const describeRequest = (url, options) => {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* keep it as given */ }
  return `${(options?.method || 'GET').toUpperCase()} ${path}`;
};

// THE NETWORK INTERCEPTOR
// Exported so that every Spotify call in the app goes through it. Calls that bypassed it kept
// hammering the API during a 429 cooldown and never read Retry-After, deepening the ban.
// It also owns the access token: renewing it here, in one place, is what lets a page that has
// been open for hours keep working without every call site having to think about expiry.

// Callers pass an Authorization header built from the token they held when they rendered, which
// on a long-lived page can be hours old. The store always has the newest one, so use that.
function withCurrentToken(options) {
  const headers = options?.headers;
  if (!headers || !(headers.Authorization || headers.authorization)) return options;
  const current = useUserStore.getState().token;
  if (!current) return options;
  const next = { ...headers };
  delete next.authorization; // a lower-case copy would otherwise shadow the one we set
  next.Authorization = `Bearer ${current}`;
  return { ...options, headers: next };
}

export async function spotifyFetch(url, options) {
  const store = useUserStore.getState();
  
  // 1. If we are in timeout, block the request before it even leaves the browser
  if (store.apiCooldownUntil && Date.now() < store.apiCooldownUntil) {
    throw new Error("RATE_LIMITED");
  }

  // 2. Renew a token that has already expired before spending a request on it. Launching the app
  // an hour after last using it now costs one refresh, which every concurrent caller shares,
  // instead of a page full of failures. App.jsx used to react to this by signing out and
  // reloading, which is what made the first half-minute after launch unusable.
  if (isTokenStale()) await ensureFreshToken().catch(() => {});

  const send = async () => {
    try {
      return await fetch(url, {
        ...withCurrentToken(options),
        signal: options?.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS)
      });
    } catch (err) {
      log('api', err?.name === 'TimeoutError' ? 'timed out' : 'no response', `${describeRequest(url, options)} (${err?.name || err})`);
      throw err;
    }
  };

  let response = await send();

  // 3. Spotify rejected the token even though the app believed it was good: a clock that drifted,
  // or a token revoked elsewhere. Renew once and try again rather than failing the call.
  if (response.status === 401) {
    log('api', 'token rejected; renewing and retrying', describeRequest(url, options));
    const renewed = await ensureFreshToken({ force: true }).catch(() => null);
    if (renewed) response = await send();
  }

  // 4. If Spotify tells us to back off, read the exact wait time and trigger the global lock
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10; // Default to 10s if missing
    store.setApiCooldown(Date.now() + (waitSeconds * 1000));
    log('api', 'rate limited by Spotify', `${describeRequest(url, options)}, backing off ${waitSeconds}s`);
    throw new Error("RATE_LIMITED");
  }

  if (!response.ok) log('api', `failed with ${response.status}`, describeRequest(url, options));
  return response;
}

// Player endpoints accept a device_id to target a specific device; without one Spotify uses
// whatever is active. Callers pass null for "the active device".
const deviceQuery = (deviceId, prefix = '?') => (deviceId ? `${prefix}device_id=${encodeURIComponent(deviceId)}` : '');

// Player calls fail in two ways worth telling the user apart: nothing is playing anywhere
// (404 NO_ACTIVE_DEVICE, fixed by picking a device) and the account can't be controlled at all
// (403 PREMIUM_REQUIRED). Both carry a `code` so call sites can react without parsing text.
export async function playbackError(response, message = 'Playback request failed') {
  let reason = '';
  try { reason = (await response.json())?.error?.reason || ''; } catch { /* no body */ }
  const err = new Error(reason ? `${message} (${reason})` : `${message} (${response.status})`);
  err.status = response.status;
  if (response.status === 404 || reason === 'NO_ACTIVE_DEVICE') err.code = 'NO_ACTIVE_DEVICE';
  else if (reason === 'PREMIUM_REQUIRED') err.code = 'PREMIUM_REQUIRED';
  else err.code = reason || 'PLAYBACK_FAILED';
  return err;
}

async function playerRequest(token, method, path, { body, deviceId, message } = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player${path}${deviceQuery(deviceId, separator)}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw await playbackError(response, message);
  return response;
}

// --- Spotify Connect: state and transport for whichever device is playing ---------------------

// null when nothing is active anywhere (Spotify answers 204)
export async function fetchPlayerState(token) {
  const response = await spotifyFetch('https://api.spotify.com/v1/me/player?additional_types=track,episode', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 204) return null;
  if (!response.ok) throw await playbackError(response, 'Failed to read playback state');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function fetchDevices(token) {
  const response = await spotifyFetch('https://api.spotify.com/v1/me/player/devices', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw await playbackError(response, 'Failed to list devices');
  return (await response.json()).devices || [];
}

export const transferPlayback = (token, deviceId, play = false) =>
  playerRequest(token, 'PUT', '', { body: { device_ids: [deviceId], play }, message: 'Failed to transfer playback' });
export const pausePlayback = (token, deviceId = null) =>
  playerRequest(token, 'PUT', '/pause', { deviceId, message: 'Failed to pause' });
export const resumePlayback = (token, deviceId = null) =>
  playerRequest(token, 'PUT', '/play', { deviceId, message: 'Failed to resume' });
export const skipToNext = (token, deviceId = null) =>
  playerRequest(token, 'POST', '/next', { deviceId, message: 'Failed to skip' });
export const skipToPrevious = (token, deviceId = null) =>
  playerRequest(token, 'POST', '/previous', { deviceId, message: 'Failed to go back' });
export const seekPlayback = (token, positionMs, deviceId = null) =>
  playerRequest(token, 'PUT', `/seek?position_ms=${Math.max(0, Math.round(positionMs))}`, { deviceId, message: 'Failed to seek' });
export const setPlaybackVolume = (token, percent, deviceId = null) =>
  playerRequest(token, 'PUT', `/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(percent)))}`, { deviceId, message: 'Failed to set volume' });
export const setRepeatMode = (token, state, deviceId = null) =>
  playerRequest(token, 'PUT', `/repeat?state=${state}`, { deviceId, message: 'Failed to set repeat' });

export async function fetchRecentlyPlayed(token, limit = 50) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player/recently-played?limit=${Math.min(50, limit)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) { const err = new Error(`Failed to fetch recently played (${response.status})`); err.status = response.status; throw err; }
  return (await response.json()).items || [];
}

// The batch endpoints (/albums?ids=, /artists?ids=) are deprecated with no batch replacement;
// one request per item, a few at a time. An item Spotify cannot find is left out, as the batch
// endpoints left it null.
async function fetchEach(token, path, ids, label) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const results = await inBatches(unique, 6, async (id) => {
    const response = await spotifyFetch(`${API}/${path}/${encodeURIComponent(id)}`, { headers: auth(token) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to fetch ${label} (${response.status})`);
    return response.json();
  });
  return results.filter(Boolean);
}
export const fetchAlbumsByIds = (token, ids) => fetchEach(token, 'albums', ids, 'albums');
export const fetchArtistsByIds = (token, ids) => fetchEach(token, 'artists', ids, 'artists');

// Name, art and owner only; enough for a card without paying for the whole track list
export async function fetchPlaylistSummary(token, playlistId) {
  const response = await spotifyFetch(`${API}/playlists/${playlistId}?fields=${bothPlaylistFields('id,name,images,owner(id,display_name),tracks.total')}`, {
    method: 'GET',
    headers: auth(token)
  });
  if (!response.ok) { const err = new Error(`Failed to fetch playlist (${response.status})`); err.status = response.status; throw err; }
  return normalizePlaylist(await response.json());
}

// A page of a playlist's songs by URL: one Spotify handed back as `next`, or one built with
// playlistItemsUrl. Tries the URL under the new name first, the old name if that is refused.
export async function fetchPlaylistItemsPage(token, url) {
  const request = (u) => spotifyFetch(u, { method: 'GET', headers: auth(token) });
  const response = isPlaylistItemsUrl(url)
    ? await withFallback('playlist items', () => request(swapItemsPath(url, false)), () => request(swapItemsPath(url, true)))
    : await request(url);
  if (!response.ok) { const err = new Error(`Failed to fetch playlist songs (${response.status})`); err.status = response.status; throw err; }
  return normalizePage(await response.json());
}

// Moves the track at rangeStart so it sits before insertBefore (Spotify's own semantics)
export async function reorderPlaylistTracks(token, playlistId, rangeStart, insertBefore) {
  const body = JSON.stringify({ range_start: rangeStart, insert_before: insertBefore, range_length: 1 });
  const request = (legacy) => spotifyFetch(playlistItemsUrl(playlistId, '', { legacy }), { method: 'PUT', headers: authJson(token), body });
  const response = await withFallback('reorder playlist items', () => request(false), () => request(true));
  if (!response.ok) throw new Error(`Failed to reorder tracks (${response.status})`);
  return await response.json();
}

export async function fetchUserProfile(token) {
  // Use the REAL Spotify API endpoint here:
  const response = await spotifyFetch("https://api.spotify.com/v1/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!response.ok) {
    throw new Error("Failed to fetch profile");
  }
  
  return await response.json();
}

export async function fetchUserPlaylists(token) {
  let allPlaylists = [];
  let nextUrl = "https://api.spotify.com/v1/me/playlists?limit=50";

  // Keep fetching as long as Spotify tells us there is another page
  while (nextUrl) {
    const response = await spotifyFetch(nextUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch playlists");
    }

    const data = await response.json();
    
    // Combine the new batch of playlists with the ones we already found
    allPlaylists = [...allPlaylists, ...data.items.map(normalizePlaylist)];
    
    // Update the URL to the next page (Spotify sets this to null on the last page)
    nextUrl = data.next;
  }

  // Return the complete list in the exact same format our UI expects
  return { items: allPlaylists };
}

export async function fetchPlaylistDetails(token, playlistId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  
  if (!response.ok) throw new Error("Failed to fetch playlist details");
  return normalizePlaylist(await response.json());
}

// Saving someone else's playlist is adding it to the library (following it, in the old words)
export async function followPlaylist(token, playlistId) {
  const response = await withFallback('follow playlist',
    () => libraryWrite(token, 'PUT', [playlistUri(playlistId)]),
    () => spotifyFetch(`${API}/playlists/${playlistId}/followers`, { method: 'PUT', headers: authJson(token), body: JSON.stringify({ public: false }) }));
  if (!response.ok) throw statusError('Failed to save the playlist', response);
}

// Unfollowing is removing the playlist from the library now; deleting your own is the same call
export async function unfollowPlaylist(token, playlistId) {
  const response = await withFallback('unfollow playlist',
    () => libraryWrite(token, 'DELETE', [playlistUri(playlistId)]),
    () => spotifyFetch(`${API}/playlists/${playlistId}/followers`, { method: 'DELETE', headers: auth(token) }));
  if (!response.ok) throw new Error("Failed to delete playlist");
}

export async function createPlaylist(token, userId, { name, description = '', public: isPublic = false, collaborative = false } = {}) {
  // An empty description is left out rather than sent: Spotify answers an empty one with a 400
  const body = JSON.stringify({ name, public: isPublic, collaborative, ...(toSpotifyDescription(description) ? { description: toSpotifyDescription(description) } : {}) });
  const response = await withFallback('create playlist',
    () => spotifyFetch(`${API}/me/playlists`, { method: 'POST', headers: authJson(token), body }),
    () => spotifyFetch(`${API}/users/${encodeURIComponent(userId)}/playlists`, { method: 'POST', headers: authJson(token), body }));
  if (!response.ok) throw new Error("Failed to create playlist");
  return normalizePlaylist(await response.json());
}

export async function updatePlaylist(token, playlistId, { name, description = undefined, public: isPublic = undefined, collaborative = undefined } = {}) {
  const payload = {};
  if (name !== undefined) payload.name = name;
  // Spotify refuses an empty description ("Attribute description is empty"), so clearing one
  // sends a single space, which shows as nothing
  if (description !== undefined) payload.description = toSpotifyDescription(description) || ' ';
  if (isPublic !== undefined) payload.public = isPublic;
  if (collaborative !== undefined) payload.collaborative = collaborative;

  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error("Failed to update playlist");
  return { name, description: payload.description?.trim(), public: isPublic, collaborative };
}

export async function fetchUserAlbums(token) {
  // Paginate like fetchUserPlaylists does. A single unpaginated call returns Spotify's default
  // page of 20, and because folder rendering drops any id it can't resolve, every saved album
  // past the 20th that lived in a folder simply vanished from the sidebar and library.
  let allAlbums = [];
  let nextUrl = 'https://api.spotify.com/v1/me/albums?limit=50';

  while (nextUrl) {
    const response = await spotifyFetch(nextUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) throw new Error('Failed to fetch saved albums');

    const data = await response.json();
    allAlbums = [...allAlbums, ...(data.items || [])];
    nextUrl = data.next;
  }

  // Map them to match a consistent structure (id, name, images, type)
  return allAlbums
    .filter(item => item?.album?.id)
    .map(item => ({
      id: item.album.id,
      name: item.album.name,
      images: item.album.images,
      artists: item.album.artists,
      type: 'album',
      total_tracks: item.album.total_tracks
    }));
}

// Spotify takes a cover only as JPEG, at most 256 KB once base64-encoded. Any image the user
// picks is redrawn as a square JPEG here, shrinking until it fits; sending a PNG labelled as
// JPEG, as this used to, was refused without a word.
const COVER_MAX_BASE64 = 256 * 1024;
const COVER_SIZES = [640, 512, 400, 320, 256];

async function toCoverJpeg(imageFile) {
  const url = URL.createObjectURL(imageFile);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't an image Jomify can read"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    for (const size of COVER_SIZES) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
      for (const quality of [0.9, 0.8, 0.7]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        if (base64.length <= COVER_MAX_BASE64) return base64;
      }
    }
    throw new Error('That image is too detailed to fit Spotify\'s 256 KB cover limit');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPlaylistCoverImage(token, playlistId, imageFile) {
  if (!imageFile) return;
  const base64Image = await toCoverJpeg(imageFile);

  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "image/jpeg"
    },
    body: base64Image
  });

  if (!response.ok) throw new Error(`Spotify refused the cover (${response.status})`);
}

// NEW: A dedicated function to grab the next chunks
// The next page of anything paginated: liked songs, an album's tracks, a playlist's songs
export async function fetchMoreTracks(token, nextUrl) {
  if (isPlaylistItemsUrl(nextUrl)) return fetchPlaylistItemsPage(token, nextUrl);
  const response = await spotifyFetch(nextUrl, {
    method: "GET",
    headers: auth(token)
  });
  
  if (!response.ok) throw new Error("Failed to fetch more tracks");
  return normalizePage(await response.json());
}

export async function playPlaylistTrack(token, deviceId, playlistId, trackIndex) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player/play${deviceQuery(deviceId)}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      context_uri: `spotify:playlist:${playlistId}`,
      offset: { position: trackIndex }
    })
  });

  if (!response.ok) throw await playbackError(response, "Failed to trigger track playback");
}

export async function searchSpotify(token, query) {
  if (!query) return null;
  
  const encodedQuery = encodeURIComponent(query);
  // Spotify cut the most an app like Jomify may ask for from 50 to 10 in 2026; 20 now risks a
  // refusal. The "See more" lists page on from here anyway.
  const url = "https://" + "api.spotify.com/v1/search?q=" + encodedQuery + "&type=track,album,artist,playlist&limit=10";

  const response = await spotifyFetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });

  if (!response.ok) {
    throw new Error("Failed to execute search");
  }

  return await response.json();
}

export async function fetchSearchPage(token, nextUrl) {
  if (!nextUrl) return null;

  const response = await spotifyFetch(nextUrl, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });

  if (!response.ok) {
    throw new Error("Failed to fetch search page");
  }

  return await response.json();
}

export async function playSingleTrack(token, deviceId, trackUri) {
  const url = "https://api.spotify.com/v1/me/player/play" + deviceQuery(deviceId);

  const response = await spotifyFetch(url, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uris: [trackUri]
    })
  });

  if (!response.ok) throw await playbackError(response, "Failed to play track");
}

// Plays an explicit list of URIs in the given order, starting at `offsetIndex`. Spotify caps
// the list (around 100), so callers pass a window. Used when a view's on-screen order differs
// from the playlist's stored order.
export async function playUris(token, deviceId, uris, offsetIndex = 0) {
  const window = (uris || []).filter(Boolean).slice(0, 100);
  if (window.length === 0) return;

  const url = "https://api.spotify.com/v1/me/player/play" + deviceQuery(deviceId);
  const response = await spotifyFetch(url, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ uris: window, offset: { position: Math.max(0, Math.min(offsetIndex, window.length - 1)) } })
  });

  if (!response.ok) throw await playbackError(response, "Failed to play tracks");
}

// Plays any context (album, artist, playlist) from a position, so playback continues through it
export async function playContext(token, deviceId, contextUri, offsetIndex = 0) {
  const url = "https://api.spotify.com/v1/me/player/play" + deviceQuery(deviceId);
  const response = await spotifyFetch(url, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ context_uri: contextUri, offset: { position: Math.max(0, offsetIndex) } })
  });

  if (!response.ok) throw await playbackError(response, "Failed to start playback");
}

// Which of these songs are liked: { id: true|false }. The library endpoint first; the old
// per-type one when refused. A failed batch leaves its ids out rather than guessing.
export async function checkTracksLiked(token, trackIds) {
  const ids = [...new Set((trackIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const results = {};
  for (let i = 0; i < ids.length; i += LIBRARY_BATCH) {
    const chunk = ids.slice(i, i + LIBRARY_BATCH);
    const response = await withFallback('library contains',
      () => spotifyFetch(libraryContainsUrl(chunk.map(trackUri)), { headers: auth(token) }),
      () => spotifyFetch(`${API}/me/tracks/contains?ids=${chunk.join(',')}`, { headers: auth(token) }));
    if (!response.ok) continue;
    const booleans = await response.json();
    chunk.forEach((id, index) => { results[id] = Boolean(booleans[index]); });
  }
  return results;
}

export async function toggleTrackLike(token, trackId, isCurrentlyLiked) {
  const method = isCurrentlyLiked ? 'DELETE' : 'PUT';
  const response = await withFallback('library write',
    () => libraryWrite(token, method, [trackUri(trackId)]),
    () => spotifyFetch(`${API}/me/tracks?ids=${trackId}`, { method, headers: auth(token) }));
  if (!response.ok) throw new Error("Failed to toggle like status");
}

export async function fetchInitialLikedSongs(token) {
  const url = "https://" + "api.spotify.com/v1/me/tracks?limit=50";
  const response = await spotifyFetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  
  if (!response.ok) throw new Error("Failed to fetch initial liked songs");
  return await response.json();
}

export async function toggleShuffleState(token, deviceId, state) {
  const url = "https://api.spotify.com/v1/me/player/shuffle?state=" + state + deviceQuery(deviceId, '&');
  const response = await spotifyFetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token }
  });
  if (!response.ok) throw await playbackError(response, "Failed to set shuffle");
}

export async function playLikedSongsQueue(token, deviceId, allUris, startIndex, userId) {
  const url = "https://api.spotify.com/v1/me/player/play" + deviceQuery(deviceId);
  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  };

  // Preferred: play Liked Songs as a CONTEXT, the way Spotify's own clients do. That gives
  // playback over the whole library and shuffle across all of it, instead of a 100-track
  // window that stops dead. The collection URI isn't formally documented, so if Spotify
  // rejects it we fall through to the old behaviour rather than failing.
  if (userId && allUris[startIndex]) {
    const response = await spotifyFetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        context_uri: `spotify:user:${userId}:collection`,
        offset: { uri: allUris[startIndex] }
      })
    });
    if (response.ok) return;
    console.warn(`Liked Songs context rejected (${response.status}); falling back to a 100-track window.`);
  }

  // Fallback: up to 100 tracks starting from the clicked song
  const uriChunk = allUris.slice(startIndex, startIndex + 100);

  const response = await spotifyFetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      uris: uriChunk,
      offset: { position: 0 } // Start at the beginning of our sliced chunk
    })
  });

  if (!response.ok) throw await playbackError(response, "Failed to play Liked Songs");
}

// Fetches the entire upcoming queue
export async function fetchQueue(token) {
  const url = "https://api.spotify.com/v1/me/player/queue";
  const response = await spotifyFetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  
  if (!response.ok) throw new Error("Failed to fetch queue");
  return await response.json();
}

// Pushes a track to the very top of the "Up Next" queue
export async function addToQueue(token, deviceId, trackUri) {
  const url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}${deviceQuery(deviceId, '&')}`;
  const response = await spotifyFetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  });

  if (!response.ok) throw await playbackError(response, "Failed to add to queue");
}

// Up to 100 at a time; the caller chunks
export async function addTracksToPlaylist(token, playlistId, uris) {
  const body = JSON.stringify({ uris });
  const request = (legacy) => spotifyFetch(playlistItemsUrl(playlistId, '', { legacy }), { method: 'POST', headers: authJson(token), body });
  const response = await withFallback('add playlist items', () => request(false), () => request(true));
  if (!response.ok) throw new Error("Failed to add tracks to playlist");
  return await response.json();
}

// The new endpoint names the list `items`, the old one `tracks`; both take { uri } entries
export async function removeTracksFromPlaylist(token, playlistId, uris) {
  const entries = uris.map((uri) => ({ uri }));
  const request = (legacy) => spotifyFetch(playlistItemsUrl(playlistId, '', { legacy }), {
    method: 'DELETE',
    headers: authJson(token),
    body: JSON.stringify(legacy ? { tracks: entries } : { items: entries })
  });
  const response = await withFallback('remove playlist items', () => request(false), () => request(true));
  if (!response.ok) { const err = new Error(`Failed to remove tracks from playlist (${response.status})`); err.status = response.status; throw err; }
  return await response.json();
}
export const removeTrackFromPlaylist = (token, playlistId, uri) => removeTracksFromPlaylist(token, playlistId, [uri]);

export async function saveAlbumToLibrary(token, albumId) {
  const response = await withFallback('library write',
    () => libraryWrite(token, 'PUT', [albumUri(albumId)]),
    () => spotifyFetch(`${API}/me/albums?ids=${encodeURIComponent(albumId)}`, { method: 'PUT', headers: auth(token) }));
  if (!response.ok) throw new Error('Failed to save album to library');
}

export async function unsaveAlbum(token, albumId) {
  const response = await withFallback('library write',
    () => libraryWrite(token, 'DELETE', [albumUri(albumId)]),
    () => spotifyFetch(`${API}/me/albums?ids=${encodeURIComponent(albumId)}`, { method: 'DELETE', headers: auth(token) }));
  if (!response.ok) throw new Error('Failed to remove album from library');
}
// ==========================================
// THE SEVENS ENGINE
// ==========================================

// Pulls every track of a Seven with just the fields the Sevens engine needs.
// Using `fields` keeps these payloads tiny, which matters because we cross-reference
// several playlists at once whenever the workspace opens.
export async function fetchSevenTrackMeta(token, playlistId) {
  const fields = bothPageFields("next,items(added_by(id),track(uri,name,artists(name)))");
  let url = playlistItemsUrl(playlistId, `limit=100&fields=${encodeURIComponent(fields)}`);
  const items = [];

  while (url) {
    let data;
    try { data = await fetchPlaylistItemsPage(token, url); }
    catch { throw new Error("Failed to fetch Seven track metadata"); }

    (data.items || []).forEach((item) => {
      if (!item?.track?.uri) return;
      items.push({
        uri: item.track.uri,
        name: item.track.name,
        artists: (item.track.artists || []).map(a => a.name),
        addedById: item.added_by?.id || null
      });
    });

    url = data.next;
  }

  return items;
}

// Another person's profile. Deprecated with nothing in its place; when it goes, what the app
// already knows about them (a friend's saved name and picture, a collaborator's profile in the
// cache, the owner on one of their playlists) stands in, marked `partial`.
export async function fetchSpotifyUser(token, userId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.ok) return await response.json();
  if (response.status === 404 || response.status === 410 || response.status === 403) {
    const known = knownUser(userId);
    if (known) return known;
  }
  const err = new Error("Failed to fetch Spotify user");
  err.status = response.status;
  throw err;
}

function knownUser(userId) {
  const { friends, playlists } = useUserStore.getState();
  const friend = (friends || []).find((f) => f.id === userId);
  if (friend) return { id: userId, display_name: friend.name, images: friend.image ? [{ url: friend.image }] : [], partial: true };
  const owned = (playlists || []).find((p) => p.owner?.id === userId);
  if (owned) return { id: userId, display_name: owned.owner.display_name || userId, images: [], partial: true };
  return null;
}

// --- Other people: public playlists and following --------------------------------------------
// Spotify has no endpoint that lists the users you follow and no user search, so a friends list
// is built by hand from profile links; these are the calls a friend's page needs.

// Someone's public playlists. Deprecated with nothing in its place; when it goes, the ones of
// theirs already in your library are shown, with `partial` so the page can say so.
export async function fetchUserPublicPlaylists(token, userId) {
  const items = [];
  let url = `https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists?limit=50`;
  while (url) {
    const response = await spotifyFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      if ([403, 404, 410].includes(response.status) && items.length === 0) {
        const mine = useUserStore.getState().playlists.filter((p) => p.owner?.id === userId);
        const list = mine.map(normalizePlaylist);
        list.partial = true;
        return list;
      }
      throw statusError("Failed to fetch the user's playlists", response);
    }
    const page = await response.json();
    items.push(...(page.items || []).filter(Boolean).map(normalizePlaylist));
    url = page.next;
  }
  return items;
}

// Following someone is saving them to the library now
export async function checkFollowingUsers(token, ids) {
  if (!ids?.length) return [];
  const response = await withFallback('library contains users',
    () => spotifyFetch(libraryContainsUrl(ids.map(userUri)), { headers: auth(token) }),
    () => spotifyFetch(`${API}/me/following/contains?type=user&ids=${ids.map(encodeURIComponent).join(',')}`, { headers: auth(token) }));
  if (!response.ok) throw statusError('Failed to check following', response);
  return await response.json();
}

async function setFollowingUsers(token, ids, method) {
  const response = await withFallback('library write users',
    () => libraryWrite(token, method, ids.map(userUri)),
    () => spotifyFetch(`${API}/me/following?type=user&ids=${ids.map(encodeURIComponent).join(',')}`, { method, headers: auth(token) }));
  if (!response.ok) throw statusError(method === 'PUT' ? 'Failed to follow' : 'Failed to unfollow', response);
}
export const followUsers = (token, ids) => setFollowingUsers(token, ids, 'PUT');
export const unfollowUsers = (token, ids) => setFollowingUsers(token, ids, 'DELETE');

// --- Artists you follow ----------------------------------------------------------------------
// Listing them is the one follow endpoint Spotify kept as it was (cursor paged); following and
// checking go through the library like everything else.
export async function fetchFollowedArtists(token) {
  const artists = [];
  let url = `${API}/me/following?type=artist&limit=50`;
  while (url) {
    const response = await spotifyFetch(url, { method: 'GET', headers: auth(token) });
    if (!response.ok) throw statusError('Failed to fetch followed artists', response);
    const page = (await response.json()).artists || {};
    artists.push(...(page.items || []).filter(Boolean));
    url = page.cursors?.after ? `${API}/me/following?type=artist&limit=50&after=${encodeURIComponent(page.cursors.after)}` : null;
  }
  return artists;
}

export async function checkFollowingArtists(token, ids) {
  if (!ids?.length) return [];
  const response = await withFallback('library contains artists',
    () => spotifyFetch(libraryContainsUrl(ids.map(artistUri)), { headers: auth(token) }),
    () => spotifyFetch(`${API}/me/following/contains?type=artist&ids=${ids.map(encodeURIComponent).join(',')}`, { headers: auth(token) }));
  if (!response.ok) throw statusError('Failed to check following', response);
  return await response.json();
}

async function setFollowingArtists(token, ids, method) {
  const response = await withFallback('library write artists',
    () => libraryWrite(token, method, ids.map(artistUri)),
    () => spotifyFetch(`${API}/me/following?type=artist&ids=${ids.map(encodeURIComponent).join(',')}`, { method, headers: auth(token) }));
  if (!response.ok) throw statusError(method === 'PUT' ? 'Failed to follow' : 'Failed to unfollow', response);
}
export const followArtists = (token, ids) => setFollowingArtists(token, ids, 'PUT');
export const unfollowArtists = (token, ids) => setFollowingArtists(token, ids, 'DELETE');

// An artist's popular tracks. Deprecated with nothing in its place; when it goes, search stands
// in: results come back most popular first, so a search for the artist's own songs is the
// nearest thing to the list Spotify used to give (ten at most, the search page size).
export async function fetchArtistTopTracks(token, artistId, artistName = '') {
  if (!newEndpointRefused('artist top tracks')) {
    const response = await spotifyFetch(`${API}/artists/${encodeURIComponent(artistId)}/top-tracks?market=from_token`, { method: 'GET', headers: auth(token) });
    if (response.ok) return (await response.json()).tracks || [];
    if (![400, 403, 404, 410, 501].includes(response.status)) return [];
    markNewEndpointRefused('artist top tracks', response.status);
  }
  if (!artistName) return [];
  const response = await spotifyFetch(`${API}/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=10`, { method: 'GET', headers: auth(token) });
  if (!response.ok) return [];
  const tracks = (await response.json()).tracks?.items || [];
  return tracks.filter((t) => (t?.artists || []).some((a) => a.id === artistId));
}

// One of Spotify's discography groups (album, single, appears_on, compilation), every page
export async function fetchArtistAlbums(token, artistId, group, { maxPages = 6 } = {}) {
  const out = [];
  let url = `${API}/artists/${encodeURIComponent(artistId)}/albums?include_groups=${group}&limit=50&market=from_token`;
  let pages = 0;
  while (url && pages < maxPages) {
    const response = await spotifyFetch(url, { method: 'GET', headers: auth(token) });
    if (!response.ok) throw statusError('Failed to fetch the discography', response);
    const data = await response.json();
    out.push(...(data.items || []));
    url = data.next;
    pages += 1;
  }
  return out;
}

// Every track of an album, for queueing or adding the whole record somewhere
export async function fetchAlbumTrackUris(token, albumId) {
  const uris = [];
  let url = `${API}/albums/${encodeURIComponent(albumId)}/tracks?limit=50`;
  while (url) {
    const response = await spotifyFetch(url, { method: 'GET', headers: auth(token) });
    if (!response.ok) throw statusError("Failed to fetch the album's tracks", response);
    const data = await response.json();
    uris.push(...(data.items || []).map((t) => t?.uri).filter(Boolean));
    url = data.next;
  }
  return uris;
}

// Works out who a Seven is *with*: everyone who has ever added a track except you.
// Returns the candidates in order of how many tracks they contributed, so the most
// likely partner is first.
export function detectPartnerCandidates(trackMeta, myUserId) {
  const counts = new Map();
  trackMeta.forEach(({ addedById }) => {
    if (!addedById || addedById === myUserId) return;
    counts.set(addedById, (counts.get(addedById) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count }));
}

// --- Unadded Songs sorting ----------------------------------------------------------------------

export async function fetchPlaylistSnapshot(token, playlistId) {
  const response = await spotifyFetch(`${API}/playlists/${playlistId}?fields=${bothPlaylistFields('id,name,snapshot_id,tracks(total)')}`, {
    method: 'GET',
    headers: auth(token)
  });
  if (!response.ok) { const err = new Error(`Failed to fetch playlist (${response.status})`); err.status = response.status; throw err; }
  return normalizePlaylist(await response.json());
}

// Just enough of every track to profile a playlist's taste: ids and artists
export async function fetchPlaylistTrackArtists(token, playlistId) {
  const fields = bothPageFields('next,items(track(id,name,artists(id,name)))');
  let url = playlistItemsUrl(playlistId, `limit=100&fields=${encodeURIComponent(fields)}`);
  const tracks = [];
  while (url) {
    const data = await fetchPlaylistItemsPage(token, url);
    for (const item of data.items || []) {
      if (item?.track?.id) tracks.push({ id: item.track.id, name: item.track.name, artists: (item.track.artists || []).filter((a) => a?.id) });
    }
    url = data.next;
  }
  return tracks;
}

// Starts any context (playlist, album, artist) at a given song and keeps going through the rest
export async function playContextFromTrack(token, deviceId, contextUri, trackUri) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player/play${deviceQuery(deviceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_uri: contextUri, offset: { uri: trackUri } })
  });
  if (!response.ok) throw await playbackError(response, 'Failed to start playback');
}

// Starts a playlist at a given track and keeps going through the rest of it. Offsetting by uri
// rather than position survives tracks being removed from the playlist meanwhile.
export async function playPlaylistFromTrack(token, deviceId, playlistId, trackUri) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player/play${deviceQuery(deviceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_uri: `spotify:playlist:${playlistId}`, offset: { uri: trackUri } })
  });
  if (!response.ok) throw await playbackError(response, 'Failed to start playback');
}
