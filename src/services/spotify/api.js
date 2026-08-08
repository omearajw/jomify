import { useUserStore } from '../../store/userStore';

// THE NETWORK INTERCEPTOR
async function spotifyFetch(url, options) {
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

export async function followPlaylist(token, playlistId) {
  const response = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) throw new Error("Failed to follow playlist");
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
  const response = await spotifyFetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
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

  if (!response.ok) {
    throw new Error("Failed to trigger track playback");
  }
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
  const url = "https://" + "api.spotify.com/v1/me/player/play?device_id=" + deviceId;

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

  if (!response.ok) {
    throw new Error("Failed to play search track");
  }
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
  const url = "https://" + "api.spotify.com/v1/me/player/shuffle?state=" + state + "&device_id=" + deviceId;
  await spotifyFetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token }
  });
}

export async function playLikedSongsQueue(token, deviceId, allUris, startIndex) {
  const url = "https://" + "api.spotify.com/v1/me/player/play?device_id=" + deviceId;
  
  // Grab up to 100 tracks starting from the clicked song to respect API limits
  const uriChunk = allUris.slice(startIndex, startIndex + 100);

  await spotifyFetch(url, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uris: uriChunk,
      offset: { position: 0 } // Start at the beginning of our sliced chunk
    })
  });
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
  const url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}&device_id=${deviceId}`;
  const response = await spotifyFetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  });
  
  if (!response.ok) throw new Error("Failed to add to queue");
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