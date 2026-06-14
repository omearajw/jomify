import { useEffect, useRef } from 'react';
import { redirectToAuthCodeFlow, getAccessToken } from './services/spotify/auth';
import { fetchUserProfile } from './services/spotify/api';
import { useUserStore } from './store/userStore';
import MainLayout from './layouts/MainLayout';
import Library from './views/Library/Library';
import PlaylistView from './views/Library/PlaylistView';
import { usePlayerStore } from './store/playerStore';
import { initializeSpotifyPlayer } from './services/spotify/playback';
import Browse from './views/Browse/Browse';
import LikedSongsView from './views/Library/LikedSongsView';

function App() {
  const { token, tokenExpiresAt, logout, profile, setToken, setProfile, currentView } = useUserStore();
  const { setPlayer, setDeviceId, setPlaybackState } = usePlayerStore();

  // This is our lock to prevent React from double-fetching the token
  const isAuthenticating = useRef(false); 

  useEffect(() => {
    // Only initialize if we have a token and haven't already loaded the player
    if (token && !window.Spotify) {
      initializeSpotifyPlayer(token, { setPlayer, setDeviceId, setPlaybackState });
    }
  }, [token, setPlayer, setDeviceId, setPlaybackState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code && !token && !isAuthenticating.current) {
      isAuthenticating.current = true; // Lock the door!
      
      getAccessToken(code).then((accessToken) => {
        setToken(accessToken);
        window.history.replaceState({}, document.title, "/");
      }).catch(err => {
        console.error("Login failed:", err);
        isAuthenticating.current = false; // Unlock if it fails
      });
    }
  }, [token, setToken]);

  useEffect(() => {
    if (token && !profile) {
      fetchUserProfile(token).then((data) => {
        setProfile(data);
      });
    }
  }, [token, profile, setProfile]);

  useEffect(() => {
    if (token) {
      // If the timer is up, OR if there's no timer (from the old bugged state)
      if (!tokenExpiresAt || Date.now() > tokenExpiresAt) {
        console.log("Token expired. Logging out.");
        logout();
        window.location.href = "/"; // Force a hard reload to clear the browser cache
      }
    }
  }, [token, tokenExpiresAt, logout]);
  
  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-900 text-white">
        <div className="text-center">
          <h1 className="text-6xl font-extrabold mb-8 text-green-500 tracking-tighter">Jomify</h1>
          <button 
            onClick={redirectToAuthCodeFlow}
            className="px-8 py-3 bg-green-500 text-black font-bold rounded-full hover:bg-green-400 hover:scale-105 transition-all"
          >
            Connect to Spotify
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <MainLayout>
      {profile ? (
        <>
          {currentView === 'home' && (
            <div className="flex flex-col items-start">
              <div className="flex items-center space-x-6 mb-8">
                {profile.images?.length > 0 ? (
                  <img 
                    src={profile.images[0].url} 
                    alt="Profile Avatar" 
                    className="w-48 h-48 rounded-full shadow-2xl shadow-black/50"
                  />
                ) : (
                  <div className="w-48 h-48 rounded-full bg-neutral-800 flex items-center justify-center text-6xl shadow-2xl">
                    🎧
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-1">Profile</p>
                  <h1 className="text-7xl font-extrabold text-white tracking-tighter mb-4">{profile.display_name}</h1>
                  <p className="text-neutral-400 font-medium">
                    {profile.followers?.total} Followers • {profile.product} tier
                  </p>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-4">Ready to play.</h2>
              <p className="text-neutral-400">Select your library to see your un-bloated music collection.</p>
            </div>
          )}

          {currentView === 'library' && <Library />}
          {currentView === 'playlist' && <PlaylistView />}
          {currentView === 'browse' && <Browse />}
          {currentView === 'liked-songs' && <LikedSongsView />}
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-neutral-400 animate-pulse text-lg">Loading Jomify core...</p>
        </div>
      )}
    </MainLayout>
  );
}

export default App;