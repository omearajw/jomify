import { useUserStore } from '../../store/userStore';

// THE NETWORK INTERCEPTOR
// Exported so that every Spotify call in the app goes through it. Calls that bypassed it kept
// hammering the API during a 429 cooldown and never read Retry-After, deepening the ban.
export async function spotifyFetch(url, options) {
  const store = useUserStore.getState();
  
  // 1. If we are in timeout, block the request before it even leaves the browser
  if (store.apiCooldownUntil && Date.now() < store.apiCooldownUntil) {
    throw new Error("RATE_LIMITED");
  }

  const response = await fetch(url, options);

  // 2. If Spotify tells us to back off, read the exact wait time and trigger the global lock
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10; // Default to 10s if missing
    store.setApiCooldown(Date.now() + (waitSeconds * 1000));
    throw new Error("RATE_LIMITED");
  }

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

export async function fetchAlbumsByIds(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const response = await spotifyFetch(`https://api.spotify.com/v1/albums?ids=${ids.slice(i, i + 20).join(',')}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to fetch albums');
    out.push(...((await response.json()).albums || []));
  }
  return out;
}

export async function fetchArtistsByIds(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const response = await spotifyFetch(`https://api.spotify.com/v1/artists?ids=${ids.slice(i, i + 50).join(',')}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to fetch artists');
    out.push(...((await response.json()).artists || []));
  }
  return out;
}

// Name, art and owner only; enough for a card without paying for the whole track list
export async function fetchPlaylistSummary(token, playlistId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,images,owner(id,display_name)`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) { const err = new Error(`Failed to fetch playlist (${response.status})`); err.status = response.status; throw err; }
  return await response.json();
}

// Moves the track at rangeStart so it sits before insertBefore (Spotify's own semantics)
export async function reorderPlaylistTracks(token, playlistId, rangeStart, insertBefore) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range_start: rangeStart, insert_before: insertBefore, range_length: 1 })
  });
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
    allPlaylists = [...allPlaylists, ...data.items];
    
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
  return await response.json();
}

export async function unfollowPlaylist(token, playlistId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) throw new Error("Failed to delete playlist");
}

export async function createPlaylist(token, userId, { name, description = '', public: isPublic = false, collaborative = false } = {}) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, description, public: isPublic, collaborative })
  });

  if (!response.ok) throw new Error("Failed to create playlist");
  return await response.json();
}

export async function updatePlaylist(token, playlistId, { name, description = undefined, public: isPublic = undefined, collaborative = undefined } = {}) {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;
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
  return { name, description, public: isPublic, collaborative };
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

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

export async function uploadPlaylistCoverImage(token, playlistId, imageFile) {
  if (!imageFile) return;
  
  // 1. Get the base64 string
  let base64Image = await blobToBase64(imageFile);
  
  // 2. CRITICAL FIX: Strip the "data:image/...;base64," prefix from the string
  base64Image = base64Image.replace(/^data:image\/(jpeg|png|jpg|webp);base64,/, '');

  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "image/jpeg" // CRITICAL FIX: Hardcode this, do not use imageFile.type
    },
    body: base64Image // Send the raw, prefix-less string
  });

  if (response.status !== 202) throw new Error("Failed to upload playlist cover image");
}

// NEW: A dedicated function to grab the next chunks
export async function fetchMoreTracks(token, nextUrl) {
  const response = await spotifyFetch(nextUrl, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  
  if (!response.ok) throw new Error("Failed to fetch more tracks");
  return await response.json();
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
  const url = "https://" + "api.spotify.com/v1/search?q=" + encodedQuery + "&type=track,album,artist,playlist&limit=20";

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

export async function checkTracksLiked(token, trackIds) {
  if (!trackIds || trackIds.length === 0) return {};
  const results = {};

  // Check in batches of 50 to respect API limits
  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50);
    const url = "https://" + "api.spotify.com/v1/me/tracks/contains?ids=" + chunk.join(",");
    
    const res = await spotifyFetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.ok) {
      const booleans = await res.json();
      chunk.forEach((id, index) => {
        results[id] = booleans[index]; // Maps the ID to true/false
      });
    }
  }
  return results;
}

export async function toggleTrackLike(token, trackId, isCurrentlyLiked) {
  const url = "https://" + "api.spotify.com/v1/me/tracks?ids=" + trackId;
  const response = await spotifyFetch(url, {
    method: isCurrentlyLiked ? "DELETE" : "PUT",
    headers: { Authorization: "Bearer " + token }
  });

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

export async function addTracksToPlaylist(token, playlistId, uris) {
  // Fixed the missing $ and using the direct secure API endpoint
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  
  const response = await spotifyFetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ uris })
  });

  if (!response.ok) throw new Error("Failed to add tracks to playlist");
  return await response.json();
}

export async function removeTrackFromPlaylist(token, playlistId, trackUri) {
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  
  const response = await spotifyFetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tracks: [{ uri: trackUri }]
    })
  });

  if (!response.ok) throw new Error("Failed to remove track from playlist");
  return await response.json();
}

export async function saveAlbumToLibrary(token, albumId) {
  const url = `https://api.spotify.com/v1/me/albums?ids=${encodeURIComponent(albumId)}`;
  const response = await spotifyFetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Failed to save album to library');
}

export async function unsaveAlbum(token, albumId) {
  const url = `https://api.spotify.com/v1/me/albums?ids=${encodeURIComponent(albumId)}`;
  const response = await spotifyFetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) throw new Error('Failed to remove album from library');
}
// ==========================================
// THE SEVENS ENGINE
// ==========================================

// Pulls every track of a Seven with just the fields the Sevens engine needs.
// Using `fields` keeps these payloads tiny, which matters because we cross-reference
// several playlists at once whenever the workspace opens.
export async function fetchSevenTrackMeta(token, playlistId) {
  const fields = "next,items(added_by(id),track(uri,name,artists(name)))";
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const items = [];

  while (url) {
    const response = await spotifyFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error("Failed to fetch Seven track metadata");
    const data = await response.json();

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

export async function fetchSpotifyUser(token, userId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) throw new Error("Failed to fetch Spotify user");
  return await response.json();
}

// --- Other people: public playlists and following --------------------------------------------
// Spotify has no endpoint that lists the users you follow and no user search, so a friends list
// is built by hand from profile links; these are the calls a friend's page needs.

const statusError = (message, response) => {
  const err = new Error(`${message} (${response.status})`);
  err.status = response.status;
  return err;
};

export async function fetchUserPublicPlaylists(token, userId) {
  const items = [];
  let url = `https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists?limit=50`;
  while (url) {
    const response = await spotifyFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw statusError("Failed to fetch the user's playlists", response);
    const page = await response.json();
    items.push(...(page.items || []).filter(Boolean));
    url = page.next;
  }
  return items;
}

export async function checkFollowingUsers(token, ids) {
  if (!ids?.length) return [];
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/following/contains?type=user&ids=${ids.map(encodeURIComponent).join(',')}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw statusError('Failed to check following', response);
  return await response.json();
}

async function setFollowingUsers(token, ids, method) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/following?type=user&ids=${ids.map(encodeURIComponent).join(',')}`, {
    method,
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw statusError(method === 'PUT' ? 'Failed to follow' : 'Failed to unfollow', response);
}
export const followUsers = (token, ids) => setFollowingUsers(token, ids, 'PUT');
export const unfollowUsers = (token, ids) => setFollowingUsers(token, ids, 'DELETE');

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
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,snapshot_id,tracks(total)`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) { const err = new Error(`Failed to fetch playlist (${response.status})`); err.status = response.status; throw err; }
  return await response.json();
}

// Just enough of every track to profile a playlist's taste: ids and artists
export async function fetchPlaylistTrackArtists(token, playlistId) {
  const fields = 'next,items(track(id,name,artists(id,name)))';
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;
  const tracks = [];
  while (url) {
    const response = await spotifyFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { const err = new Error(`Failed to fetch playlist tracks (${response.status})`); err.status = response.status; throw err; }
    const data = await response.json();
    for (const item of data.items || []) {
      if (item?.track?.id) tracks.push({ id: item.track.id, name: item.track.name, artists: (item.track.artists || []).filter((a) => a?.id) });
    }
    url = data.next;
  }
  return tracks;
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
