export function initializeSpotifyPlayer(token, storeActions) {
  const { setPlayer, setDeviceId, setPlaybackState } = storeActions;

  // 1. Define the callback BEFORE we inject the script so it never misses the event
  window.onSpotifyWebPlaybackSDKReady = () => {
    const player = new window.Spotify.Player({
      name: 'Jomify Web Player',
      getOAuthToken: cb => { cb(token); },
      volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
      console.log('🎧 Jomify Audio Engine Ready! Device ID:', device_id);
      setDeviceId(device_id);
      
      // Auto-transfer playback to this browser
      transferPlayback(device_id, token).catch(console.error);
    });

    player.addListener('not_ready', ({ device_id }) => {
      console.log('Device ID has gone offline', device_id);
    });

    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      setPlaybackState(state);
    });

    player.connect();
    setPlayer(player);
  };

  // 2. Only inject the script if it isn't already on the page
  if (!document.getElementById("spotify-player-script")) {
    const script = document.createElement("script");
    script.id = "spotify-player-script";
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
  }
}

// Utility function to hijack the playback
async function transferPlayback(deviceId, token) {
  const url = "https://" + "api.spotify.com/v1/me/player";
  
  await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': "Bearer " + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play: false, 
    }),
  });
}