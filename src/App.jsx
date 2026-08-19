import { useEffect, useRef, useState } from 'react';
import { redirectToAuthCodeFlow, getAccessToken, refreshAccessToken } from './services/spotify/auth';
import { fetchUserProfile, fetchUserPlaylists, fetchUserAlbums } from './services/spotify/api';
import { useUserStore } from './store/userStore';
import MainLayout from './layouts/MainLayout';
import Library from './views/Library/Library';
import PlaylistView from './views/Library/PlaylistView';
import PlaylistView_2 from './views/Library/PlaylistView_2';
import LyricsView from './views/Lyrics/LyricsView';
import { usePlayerStore } from './store/playerStore';
import { initializeSpotifyPlayer } from './services/spotify/playback';
import Browse from './views/Browse/Browse';
import Artist from './views/Artist/Artist';
import Album from './views/Album/Album';
import LikedSongsView from './views/Library/LikedSongsView';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Moved outside the component to prevent useEffect dependency triggers
const SEVEN_PLAYLIST_IDS = ['5kJPA0nczW9zoQs7jcQ5ok', '2KmKTCZFO9wofPRwqJ3y5F'];

function App() {
  const { 
    token, refreshToken, tokenExpiresAt, logout, profile, 
    setToken, setRefreshToken, setProfile, setPlaylists, 
    currentView, setCurrentView,
    pinnedItems, playlists, albums, customFolders, 
    activePlaylistId, setActivePlaylistId, navigateToAlbum, setContextMenu
  } = useUserStore();
  
  const { setPlayer, setDeviceId, setPlaybackState } = usePlayerStore();

  const isAuthenticating = useRef(false); 
  const hydratedPinnedIds = useRef(new Set());

  // --- STATS & SEVENS STATE ---
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState({ tracks: [], artists: [], loading: false });
  const [sevenTurns, setSevenTurns] = useState([]);

  // --- THE INFINITE SESSION HEARTBEAT ---
  useEffect(() => {
    const checkAndRefreshToken = async () => {
      if (!token || !refreshToken || !tokenExpiresAt) return;

      if (Date.now() > tokenExpiresAt - 300000) {
        console.log("Token expiring soon. Silently refreshing in background...");
        try {
          const data = await refreshAccessToken(refreshToken);
          setToken(data.access_token);
          
          if (data.refresh_token) {
             setRefreshToken(data.refresh_token);
          }
        } catch (err) {
           console.error("Critical session expiration. Forcing re-login.", err);
           logout(); 
        }
      }
    };

    checkAndRefreshToken();
    const interval = setInterval(checkAndRefreshToken, 60000);
    return () => clearInterval(interval);
  }, [token, refreshToken, tokenExpiresAt, setToken, setRefreshToken, logout]);


  useEffect(() => {
    if (token && !window.Spotify) {
      initializeSpotifyPlayer(token, { setPlayer, setDeviceId, setPlaybackState });
    }
  }, [token, setPlayer, setDeviceId, setPlaybackState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code && !token && !isAuthenticating.current) {
      isAuthenticating.current = true; 
      
      getAccessToken(code).then((accessToken) => {
        setToken(accessToken);
        window.history.replaceState({}, document.title, "/");
      }).catch(err => {
        console.error("Login failed:", err);
        isAuthenticating.current = false; 
      });
    }
  }, [token, setToken]);

  // --- INITIAL DATA FETCH (WITH RACE-CONDITION SAFE MERGING) ---
  useEffect(() => {
    if (token && !useUserStore.getState().albums.length) {
      fetchUserAlbums(token)
        .then((albumsData) => {
          const current = useUserStore.getState().albums;
          const fetchedIds = new Set(albumsData.map(a => a.id));
          const preserved = current.filter(a => !fetchedIds.has(a.id)); // Keep hydrated items
          useUserStore.getState().setAlbums([...albumsData, ...preserved]);
        })
        .catch((error) => console.error("Unable to preload albums:", error));
    }
  }, [token]);

  useEffect(() => {
    if (token && !profile) {
      fetchUserProfile(token).then((data) => {
        setProfile(data);
      });
    }
  }, [token, profile, setProfile]);

  useEffect(() => {
    if (token && !useUserStore.getState().playlists.length) {
      fetchUserPlaylists(token)
        .then((data) => {
          const current = useUserStore.getState().playlists;
          const fetchedIds = new Set(data.items.map(p => p.id));
          const preserved = current.filter(p => !fetchedIds.has(p.id)); // Keep hydrated items
          setPlaylists([...data.items, ...preserved]);
        })
        .catch((error) => console.error("Unable to preload playlists:", error));
    }
  }, [token, setPlaylists]);

  useEffect(() => {
    if (token) {
      if (!tokenExpiresAt || Date.now() > tokenExpiresAt) {
        console.log("Token expired. Logging out.");
        logout();
        window.location.href = "/"; 
      }
    }
  }, [token, tokenExpiresAt, logout]);

  // --- PINNED ITEMS HYDRATION ENGINE (RACE-CONDITION SAFE) ---
  useEffect(() => {
    if (!token || pinnedItems.length === 0) return;

    const hydratePinnedItems = async () => {
      const currentPlaylists = useUserStore.getState().playlists;
      const currentAlbums = useUserStore.getState().albums;

      const missingPlaylists = pinnedItems.filter(p => p.type === 'playlist' && !currentPlaylists.some(pl => pl.id === p.id) && !hydratedPinnedIds.current.has(p.id));
      const missingAlbums = pinnedItems.filter(p => p.type === 'album' && !currentAlbums.some(a => a.id === p.id) && !hydratedPinnedIds.current.has(p.id));

      if (missingPlaylists.length === 0 && missingAlbums.length === 0) return;

      missingPlaylists.forEach(p => hydratedPinnedIds.current.add(p.id));
      missingAlbums.forEach(p => hydratedPinnedIds.current.add(p.id));

      let newPlaylists = [];
      if (missingPlaylists.length > 0) {
        try {
          const res = await Promise.all(
            missingPlaylists.map(p => fetch(`https://api.spotify.com/v1/playlists/${p.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()))
          );
          newPlaylists = res.filter(p => p && !p.error && p.id);
        } catch (e) { 
          console.error("Hydration failed for playlists", e); 
        }
      }

      let newAlbums = [];
      if (missingAlbums.length > 0) {
        try {
          const albumIds = missingAlbums.map(a => a.id).join(',');
          const res = await fetch(`https://api.spotify.com/v1/albums?ids=${albumIds}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
          if (res.albums) newAlbums = res.albums.filter(Boolean);
        } catch (e) { 
          console.error("Hydration failed for albums", e); 
        }
      }

      // Merge hydrated data securely without overwriting the main load
      if (newPlaylists.length > 0) {
        const current = useUserStore.getState().playlists;
        const newIds = new Set(newPlaylists.map(p => p.id));
        const filtered = current.filter(p => !newIds.has(p.id));
        setPlaylists([...filtered, ...newPlaylists]);
      }
      if (newAlbums.length > 0) {
        const current = useUserStore.getState().albums;
        const newIds = new Set(newAlbums.map(a => a.id));
        const filtered = current.filter(a => !newIds.has(a.id));
        useUserStore.getState().setAlbums([...filtered, ...newAlbums]);
      }
    };

    hydratePinnedItems();
  }, [token, pinnedItems, setPlaylists]);

  // --- SEVENS TURN CHECKER (HIGH-SPEED OFFSET METHOD) ---
  useEffect(() => {
    if (!token || !profile) return;
    
    const checkSevens = async () => {
      const turns = [];
      for (const id of SEVEN_PLAYLIST_IDS) {
        try {
          // 1. Fetch only metadata and total track count (super lightweight)
          const res = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=id,name,images,tracks.total`, { 
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          
          if (data.tracks && data.tracks.total > 0) {
            // 2. Fetch EXACTLY the last track to check who added it
            const offset = data.tracks.total - 1;
            const trackRes = await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=1&offset=${offset}`, { 
              headers: { Authorization: `Bearer ${token}` }
            });
            const trackData = await trackRes.json();
            const lastAdderId = trackData.items[0]?.added_by?.id;
            
            // If the last person to add a track WAS NOT you, it's your turn!
            if (lastAdderId && lastAdderId !== profile.id) {
              turns.push(data);
            }
          } else if (data.tracks && data.tracks.total === 0) {
            // Empty playlist - ready for the first drop
            turns.push(data);
          }
        } catch (e) {
          console.error(`Failed to check sevens status for ${id}`, e);
        }
      }
      setSevenTurns(turns);
    };

    checkSevens();
  }, [token, profile]);

  // --- FETCH STATS ON DEMAND ---
  const toggleAndLoadStats = async () => {
    if (showStats) {
      setShowStats(false);
      return;
    }
    
    setShowStats(true);
    
    if (statsData.tracks.length > 0) return;

    setStatsData(prev => ({ ...prev, loading: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [tracksRes, artistsRes] = await Promise.all([
        fetch('https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=5', { headers }),
        fetch('https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=5', { headers })
      ]);
      
      const tracks = await tracksRes.json();
      const artists = await artistsRes.json();

      setStatsData({
        tracks: tracks.items || [],
        artists: artists.items || [],
        loading: false
      });
    } catch (e) {
      console.error("Failed to fetch top stats", e);
      setStatsData(prev => ({ ...prev, loading: false }));
    }
  };
  
  if (!token) {
    return (
      <div className="relative flex items-center justify-center h-screen bg-black text-white overflow-hidden">
        <div className="fixed inset-0 z-[1] bg-aurora opacity-20"></div>
        <div className="fixed inset-0 z-[2] bg-noise opacity-[0.03] pointer-events-none"></div>
        
        <div className="text-center z-10 relative">
          <h1 className="text-6xl font-extrabold mb-8 text-brand-gradient tracking-tighter pb-3 pt-1">Jomify</h1>
          <button 
            onClick={redirectToAuthCodeFlow}
            className="px-8 py-3 bg-brand-gradient text-white font-bold rounded-full shadow-brand-glow hover:scale-105 transition-all"
          >
            Connect to Spotify
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <>
      <div className="fixed inset-0 z-[-2] bg-aurora opacity-20"></div>
      <div className="fixed inset-0 z-[-1] bg-noise opacity-[0.03] pointer-events-none"></div>
      
      <MainLayout>
        {profile ? (
          <>
            {currentView === 'home' && (
              <div className="flex flex-col items-start relative z-10 w-full max-w-[1600px] pb-12 animate-fade-in">
                
                {/* 1. Header & Stats Drawer Toggle */}
                <div className="flex items-center space-x-6 mb-12 w-full">
                  {profile.images?.length > 0 ? (
                    <img 
                      src={profile.images[0].url} 
                      alt="Profile Avatar" 
                      className="w-32 h-32 md:w-48 md:h-48 rounded-full shadow-2xl shadow-black/50"
                    />
                  ) : (
                    <div className="w-32 h-32 md:w-48 md:h-48 rounded-full bg-neutral-800 flex items-center justify-center text-4xl md:text-6xl shadow-2xl">
                      🎧
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-1">Profile</p>
                    <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter mb-4">{profile.display_name}</h1>
                    <div className="flex items-center space-x-4">
                      <p className="text-neutral-400 font-medium">
                        {profile.followers?.total} Followers • {profile.product} tier
                      </p>
                      <span className="w-1.5 h-1.5 bg-neutral-600 rounded-full"></span>
                      <button 
                        onClick={toggleAndLoadStats}
                        className="flex items-center px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:text-[#f91362] text-sm font-bold text-white transition-all group"
                      >
                        <BarChart3 className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform text-brand-gradient" />
                        {showStats ? 'Hide Stats' : 'View Stats'}
                        {showStats ? <ChevronUp className="w-4 h-4 ml-1 opacity-50" /> : <ChevronDown className="w-4 h-4 ml-1 opacity-50" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. The Expandable Stats Drawer */}
                <AnimatePresence initial={false}>
                  {showStats && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
                      className="w-full overflow-hidden"
                    >
                      <div className="pb-12 pt-2"> 
                        <div className="p-8 rounded-3xl bg-neutral-900/60 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col md:flex-row gap-8">
                          
                          {/* Top Tracks Column */}
                          <div className="flex-1">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center border-b border-white/10 pb-4">
                              Top Tracks <span className="text-xs text-neutral-400 ml-3 font-medium uppercase tracking-wider">(Last 4 Weeks)</span>
                            </h3>
                            {statsData.loading ? (
                              <p className="text-neutral-500 animate-pulse font-medium">Crunching your audio data...</p>
                            ) : (
                              <div className="space-y-4">
                                {statsData.tracks.map((track, idx) => (
                                  <div key={track.id} className="flex items-center space-x-4 group cursor-default">
                                    <span className="text-xl font-extrabold text-neutral-700 w-6 group-hover:text-brand-gradient transition-colors">{idx + 1}</span>
                                    <img src={track.album.images[0]?.url} className="w-12 h-12 rounded-md shadow-md group-hover:scale-105 transition-transform" />
                                    <div className="truncate flex-1">
                                      <p className="text-white font-bold text-sm truncate">{track.name}</p>
                                      <p className="text-neutral-400 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Top Artists Column */}
                          <div className="flex-1">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center border-b border-white/10 pb-4">
                              Top Artists <span className="text-xs text-neutral-400 ml-3 font-medium uppercase tracking-wider">(Last 4 Weeks)</span>
                            </h3>
                            {statsData.loading ? (
                              <p className="text-neutral-500 animate-pulse font-medium">Crunching your audio data...</p>
                            ) : (
                              <div className="space-y-4">
                                {statsData.artists.map((artist, idx) => (
                                  <div key={artist.id} className="flex items-center space-x-4 group cursor-default">
                                    <span className="text-xl font-extrabold text-neutral-700 w-6 group-hover:text-brand-gradient transition-colors">{idx + 1}</span>
                                    <img src={artist.images[0]?.url} className="w-12 h-12 rounded-full shadow-md group-hover:scale-105 transition-transform object-cover" />
                                    <div className="truncate flex-1">
                                      <p className="text-white font-bold text-sm truncate">{artist.name}</p>
                                      <p className="text-neutral-400 text-xs capitalize truncate">{artist.genres.slice(0,2).join(', ') || 'Artist'}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 3. Sevens Turn Alerts */}
                {sevenTurns.length > 0 && (
                  <div className="w-full flex flex-col gap-4 mb-10 mt-2">
                    {sevenTurns.map(playlist => (
                      <div 
                        key={playlist.id}
                        onClick={() => { setActivePlaylistId(playlist.id); setCurrentView('playlist'); }}
                        className="w-full bg-brand-gradient/10 border border-[var(--brand-mid)]/30 rounded-2xl p-4 flex items-center justify-between shadow-[0_0_30px_rgba(249,19,98,0.15)] cursor-pointer hover:bg-brand-gradient/20 transition-all group"
                      >
                        <div className="flex items-center gap-5">
                          {playlist.images?.[0]?.url ? (
                            <img src={playlist.images[0].url} className="w-14 h-14 rounded shadow-md object-cover" alt="" />
                          ) : (
                            <div className="w-14 h-14 rounded bg-black/40 flex items-center justify-center text-xl">🎵</div>
                          )}
                          <div>
                            <h3 className="text-white font-bold text-lg md:text-xl">It's your turn in {playlist.name}!</h3>
                            <p className="text-[var(--brand-light)] font-medium text-xs md:text-sm">Your collaborator just finished their drop. Click to open the workspace.</p>
                          </div>
                        </div>
                        <button className="bg-brand-gradient text-white px-5 py-2 rounded-full text-sm font-bold shadow-brand-glow group-hover:scale-105 transition-transform hidden sm:block">
                          Open Workspace
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 4. The Custom Floating Pinned Sandbox (Dynamically Scaled) */}
                <div className="w-full pt-4">
                  {pinnedItems.length === 0 ? (
                    <div className="w-full border-2 border-dashed border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-neutral-500 bg-neutral-900/20 backdrop-blur-sm">
                      <span className="text-4xl mb-4">📌</span>
                      <p className="font-medium text-lg text-white text-center">Right-click playlists or albums to pin them to your home page.</p>
                    </div>
                  ) : (
                    <motion.div layout className="flex flex-wrap justify-center items-center gap-8 md:gap-14 py-8 px-4">
                      <AnimatePresence mode="popLayout">
                        {pinnedItems.map((pinned, i) => {
                          let item, onClick, imageNode, title, subtitle;
                          const count = pinnedItems.length;

                          let cardSizeClass = "w-48 p-4";
                          let titleSizeClass = "text-sm";
                          let subtitleSizeClass = "text-xs mt-1";
                          let iconSizeClass = "text-4xl";
                          let folderIconSizeClass = "text-6xl";

                          if (count === 1) {
                            cardSizeClass = "w-72 md:w-80 p-6";
                            titleSizeClass = "text-xl md:text-2xl font-bold";
                            subtitleSizeClass = "text-sm md:text-base mt-2";
                            iconSizeClass = "text-8xl";
                            folderIconSizeClass = "text-[120px]";
                          } else if (count === 2) {
                            cardSizeClass = "w-56 md:w-64 p-5";
                            titleSizeClass = "text-lg md:text-xl font-bold";
                            subtitleSizeClass = "text-xs md:text-sm mt-1.5";
                            iconSizeClass = "text-6xl";
                            folderIconSizeClass = "text-[80px]";
                          }
                          
                          if (pinned.type === 'playlist') {
                            item = playlists.find(p => p.id === pinned.id);
                            if (!item) return null;
                            onClick = () => { setActivePlaylistId(item.id); setCurrentView('playlist'); };
                            imageNode = item.images?.[0]?.url ? <img src={item.images[0].url} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <span className={`${iconSizeClass} transition-transform duration-500 group-hover:scale-110`}>💿</span>;
                            title = item.name;
                            subtitle = `Playlist • ${item.owner?.display_name || 'Spotify'}`;
                          } else if (pinned.type === 'album') {
                            item = albums.find(a => a.id === pinned.id);
                            if (!item) return null;
                            onClick = () => navigateToAlbum(item.id);
                            imageNode = item.images?.[0]?.url ? <img src={item.images[0].url} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <span className={`${iconSizeClass} transition-transform duration-500 group-hover:scale-110`}>💿</span>;
                            title = item.name;
                            subtitle = `Album • ${item.artists?.map(a => a.name).join(', ')}`;
                          } else if (pinned.type === 'folder') {
                            item = customFolders.find(f => f.id === pinned.id);
                            if (!item) return null;
                            onClick = () => setCurrentView('library');
                            imageNode = <span className={`${folderIconSizeClass} transition-transform duration-500 group-hover:scale-110`}>📁</span>;
                            title = item.name;
                            subtitle = `Folder • ${item.playlistIds.length} items`;
                          }

                          const yOffset = count > 2 ? (i % 2 === 0 ? -15 : 15) : 0; 

                          return (
                            <motion.div 
                              layout
                              key={`${pinned.type}-${pinned.id}`} 
                              initial={{ opacity: 0, scale: 0.8, y: 0 }}
                              animate={{ opacity: 1, scale: 1, y: yOffset }}
                              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                              transition={{
                                layout: { type: "spring", stiffness: 300, damping: 25 },
                                opacity: { duration: 0.4 }
                              }}
                              whileHover={{ scale: 1.03, y: yOffset - 5 }}
                              onClick={onClick} 
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({
                                  type: pinned.type,
                                  playlistId: pinned.type === 'playlist' ? pinned.id : null,
                                  albumId: pinned.type === 'album' ? pinned.id : null,
                                  folderId: pinned.type === 'folder' ? pinned.id : null,
                                  x: e.pageX,
                                  y: e.pageY
                                });
                              }}
                              className={`${cardSizeClass} rounded-[2rem] bg-white/[0.02] border border-white/[0.05] hover:border-white/20 hover:bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)] cursor-pointer group flex flex-col relative transition-colors`}
                            >
                              <div className="relative aspect-square w-full mb-5 rounded-2xl overflow-hidden bg-black/40 flex items-center justify-center shadow-inner border border-white/5">
                                {imageNode}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-50 pointer-events-none" />
                              </div>
                              <div className="flex-1 flex flex-col justify-center items-center">
                                <h3 className={`text-white text-center px-2 ${titleSizeClass} line-clamp-2 leading-tight break-words`}>
                                  {title}
                                </h3>
                                <p className={`text-neutral-400 text-center px-2 ${subtitleSizeClass} truncate w-full`}>
                                  {subtitle}
                                </p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </div>

              </div>
            )}

            {currentView === 'library' && <Library />}
            {currentView === 'playlist' && (
              SEVEN_PLAYLIST_IDS.includes(activePlaylistId) 
                ? <PlaylistView_2 /> 
                : <PlaylistView />
            )}
            {currentView === 'browse' && <Browse />}
            {currentView === 'artist' && <Artist />}
            {currentView === 'album' && <Album />}
            {currentView === 'liked-songs' && <LikedSongsView />}
            {currentView === 'lyrics' && <LyricsView />}
          </>
        ) : (
          <div className="flex items-center justify-center h-full relative z-10">
            <p className="text-neutral-400 animate-pulse text-lg">Loading Jomify core...</p>
          </div>
        )}
      </MainLayout>
    </>
  );
}

export default App;