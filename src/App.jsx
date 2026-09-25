import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { redirectToAuthCodeFlow, getAccessToken } from './services/spotify/auth';
import { ensureFreshToken } from './services/spotify/session';
import { fetchUserProfile, fetchUserPlaylists, fetchUserAlbums, spotifyFetch } from './services/spotify/api';
import { useUserStore } from './store/userStore';
import { useSlice } from './store/selectors';
import { artUrl } from './utils/images';
import MainLayout from './layouts/MainLayout';
import JumpBackIn from './components/JumpBackIn';
import { PUSH_STATE, completeEnableNotifications, syncPushStatus } from './pwa/push';
import { toast } from './store/toastStore';
import Library from './views/Library/Library';
import PlaylistView from './views/Library/PlaylistView';
import { startPlaybackController } from './services/spotify/playbackController';
import { installHistorySync, syncSheetWithHistory } from './pwa/historySync';
import { isMobileViewport, useIsMobile } from './hooks/useMediaQuery';
import Artist from './views/Artist/Artist';
import Album from './views/Album/Album';
import LikedSongsView from './views/Library/LikedSongsView';
import * as syncEngine from './sync/engine';

// Views that aren't on the first screen load as their own chunks, so a phone doesn't parse the
// Sevens workspace, the lyrics engines and search before it can show Home
const PlaylistView_2 = lazy(() => import('./views/Library/PlaylistView_2'));
const LyricsView = lazy(() => import('./views/Lyrics/LyricsView'));
const Browse = lazy(() => import('./views/Browse/Browse'));
const SevensSettings = lazy(() => import('./views/Sevens/SevensSettings'));
const Friends = lazy(() => import('./views/Friends/Friends'));
const UserView = lazy(() => import('./views/User/UserView'));

const ViewFallback = () => <p className="text-neutral-400 animate-pulse text-lg mt-8">Loading…</p>;
import { childrenOf } from './utils/library';
import { BarChart3, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// The Sevens these used to be hardcoded as. They are migrated into the configurable
// `sevens` store on first run and are never read again afterwards.
const LEGACY_SEVEN_PLAYLIST_IDS = ['5kJPA0nczW9zoQs7jcQ5ok', '2KmKTCZFO9wofPRwqJ3y5F'];

function App() {
  const {
    token, refreshToken, tokenExpiresAt, logout, profile,
    setToken, setRefreshToken, setProfile, setPlaylists,
    currentView, setCurrentView,
    pinnedItems, playlists, albums, customFolders,
    activePlaylistId, navigateToAlbum, navigateToPlaylist, setContextMenu, setActiveFolderId,
    sevens, seedLegacySevens, friends, navigateToUser
  } = useSlice(useUserStore, [
    'token', 'refreshToken', 'tokenExpiresAt', 'logout', 'profile',
    'setToken', 'setRefreshToken', 'setProfile', 'setPlaylists',
    'currentView', 'setCurrentView',
    'pinnedItems', 'playlists', 'albums', 'customFolders',
    'activePlaylistId', 'navigateToAlbum', 'navigateToPlaylist', 'setContextMenu', 'setActiveFolderId',
    'sevens', 'seedLegacySevens', 'friends', 'navigateToUser'
  ]);
  
  const isAuthenticating = useRef(false);
  const isMobile = useIsMobile();
  const hydratedPinnedIds = useRef(new Set());

  // --- STATS & SEVENS STATE ---
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState({ tracks: [], artists: [], loading: false });
  const [sevenTurns, setSevenTurns] = useState([]);

  // --- CROSS-DEVICE SYNC ---
  // Keyed on profile.id rather than on store hydration: `profile` is not persisted and arrives a
  // round trip after start-up, so there is a window on every launch where folders exist locally
  // but the account they belong to is still unknown. Syncing before then would be anonymous.
  useEffect(() => {
    if (!token || !profile?.id) return;
    let cancelled = false;

    syncEngine.start(profile.id).then((synced) => {
      if (cancelled || !synced) return;

      // The legacy Sevens seed runs only after a SUCCESSFUL first sync. Seeding after a failed
      // one used to stamp the two hardcoded Sevens with a fresh clock on a device that had never
      // seen the server, and they then won the merge against the real configuration.
      const legacyPool = localStorage.getItem('jomify_pool_playlist_id') || '';
      seedLegacySevens(LEGACY_SEVEN_PLAYLIST_IDS, legacyPool);
    });

    return () => { cancelled = true; syncEngine.stop(); };
  }, [token, profile?.id, seedLegacySevens]);

  // --- THE INFINITE SESSION HEARTBEAT ---
  useEffect(() => {
    const checkAndRefreshToken = async () => {
      if (!token || !refreshToken || !tokenExpiresAt) return;

      try {
        // The expiry check lives in ensureFreshToken, which the sync engine shares so a 401
        // there renews the token immediately instead of waiting for this tick
        await ensureFreshToken();
      } catch (err) {
        if (err?.definitive) {
          console.error("Spotify rejected the refresh token. Forcing re-login.", err);
          logout();
        } else {
          // A dropped connection on a phone used to sign the user out here
          console.warn("Token refresh failed; will retry on the next heartbeat.", err?.message || err);
        }
      }
    };

    checkAndRefreshToken();
    const interval = setInterval(checkAndRefreshToken, 60000);
    return () => clearInterval(interval);
  }, [token, refreshToken, tokenExpiresAt, setToken, setRefreshToken, logout]);


  useEffect(() => {
    if (!token) return;
    return startPlaybackController();
  }, [token]);

  // A notification tap opens "/?open=playlist:<id>" (or messages an already-open Jomify)
  useEffect(() => {
    if (!token) return undefined;
    const openTarget = (raw) => {
      const match = /^playlist:([A-Za-z0-9]+)$/.exec(raw || '');
      if (match) navigateToPlaylist(match[1]);
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get('open')) {
      openTarget(params.get('open'));
      window.history.replaceState({}, document.title, '/');
    }
    const onMessage = (event) => {
      if (event.data?.type !== 'open') return;
      try { openTarget(new URL(event.data.url, location.origin).searchParams.get('open')); } catch { /* ignore */ }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    syncPushStatus();
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [token, navigateToPlaylist]);

  // Mirror in-app navigation and open sheets into browser history so a phone's back button
  // walks back through the app instead of leaving it. Installed after the OAuth replaceState
  // above has run, since the token only exists once that is done.
  useEffect(() => {
    if (!token) return;
    const stop = installHistorySync();
    const { setNowPlayingOpen, setQueueOpen, setDevicePickerOpen, setContextMenu } = useUserStore.getState();
    const unsubscribes = [
      syncSheetWithHistory((s) => s.isNowPlayingOpen, () => setNowPlayingOpen(false), { tag: 'now-playing', when: isMobileViewport }),
      syncSheetWithHistory((s) => s.isQueueOpen, () => setQueueOpen(false), { tag: 'queue', when: isMobileViewport }),
      syncSheetWithHistory((s) => s.isDevicePickerOpen, () => setDevicePickerOpen(false), { tag: 'devices' }),
      syncSheetWithHistory((s) => s.isAccountOpen, () => useUserStore.getState().setAccountOpen(false), { tag: 'account' }),
      syncSheetWithHistory((s) => Boolean(s.contextMenu), () => setContextMenu(null), { tag: 'menu', when: isMobileViewport })
    ];
    return () => { unsubscribes.forEach((fn) => fn()); stop(); };
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    // Back from the second Spotify authorization that gives the notification server its own
    // grant. The session is untouched; only the server learns the new refresh token.
    if (code && token && params.get("state") === PUSH_STATE && !isAuthenticating.current) {
      isAuthenticating.current = true;
      window.history.replaceState({}, document.title, "/");
      completeEnableNotifications(code, token)
        .then(() => toast('Sevens notifications are on', { tone: 'success' }))
        .catch((err) => { console.error('Enabling notifications failed:', err); toast(err?.message || "Couldn't turn notifications on", { tone: 'error' }); })
        .finally(() => { isAuthenticating.current = false; });
      return;
    }

    if (code && !token && !isAuthenticating.current) {
      isAuthenticating.current = true; 
      
      getAccessToken(code).then(({ access_token, expires_in }) => {
        setToken(access_token, expires_in);
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

  // Profile load with retry. This used to have no .catch at all: one rate-limited /v1/me left
  // the app on "Loading Jomify core..." until a manual reload. During a cooldown the
  // interceptor rejects locally without a network call, so retrying on a timer is cheap.
  const [profileError, setProfileError] = useState(null);
  const [profileAttempt, setProfileAttempt] = useState(0);

  useEffect(() => {
    if (!token || profile) return;
    let cancelled = false;

    fetchUserProfile(token)
      .then((data) => {
        if (cancelled) return;
        setProfileError(null);
        setProfile(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load profile:', err);
        setProfileError(
          err?.message === 'RATE_LIMITED'
            ? 'Spotify is rate-limiting requests right now.'
            : "Couldn't reach Spotify to load your profile."
        );
        setTimeout(() => { if (!cancelled) setProfileAttempt(n => n + 1); }, 5000);
      });

    return () => { cancelled = true; };
  }, [token, profile, setProfile, profileAttempt]);

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
        logout();
        window.location.href = "/"; 
      }
    }
  }, [token, tokenExpiresAt, logout]);

  // --- PINNED ITEM HYDRATION ENGINE (RACE-CONDITION SAFE) ---
  // Resolves PINNED playlists/albums the main library load didn't return (something you pinned
  // without following). Deliberately NOT folder contents: fetchUserPlaylists and fetchUserAlbums
  // paginate the whole library, so a folder id that isn't in it is one you have since
  // unfollowed or removed. Fetching those by id "resurrects" them -- Spotify still serves the
  // object -- which put unfollowed playlists back into the list next to their re-created
  // namesakes and showed up as duplicates. Stale folder ids simply render nothing.
  useEffect(() => {
    if (!token) return;

    const pinnedTargets = pinnedItems.filter(p => p.type === 'playlist' || p.type === 'album');
    if (pinnedTargets.length === 0) return;

    const hydrate = async () => {
      const currentPlaylists = useUserStore.getState().playlists;
      const currentAlbums = useUserStore.getState().albums;
      const isLoaded = (id) => currentPlaylists.some(pl => pl.id === id) || currentAlbums.some(a => a.id === id);
      const isNew = (id) => !isLoaded(id) && !hydratedPinnedIds.current.has(id);

      const missingPlaylists = pinnedTargets.filter(p => p.type === 'playlist' && isNew(p.id)).map(p => p.id);
      const missingAlbums = pinnedTargets.filter(p => p.type === 'album' && isNew(p.id)).map(p => p.id);

      if (missingPlaylists.length === 0 && missingAlbums.length === 0) return;

      [...missingPlaylists, ...missingAlbums].forEach(id => hydratedPinnedIds.current.add(id));

      const headers = { Authorization: `Bearer ${token}` };

      // /v1/albums?ids= takes up to 20 per call
      let newAlbums = [];
      for (let i = 0; i < missingAlbums.length; i += 20) {
        const chunk = missingAlbums.slice(i, i + 20);
        try {
          const res = await spotifyFetch(`https://api.spotify.com/v1/albums?ids=${chunk.join(',')}`, { headers });
          if (!res.ok) continue;
          const data = await res.json();
          (data.albums || []).forEach((album) => { if (album?.id) newAlbums.push(album); });
        } catch (e) {
          console.error("Hydration failed for albums", e);
        }
      }

      let newPlaylists = [];
      const playlistCandidates = missingPlaylists;
      if (playlistCandidates.length > 0) {
        try {
          const res = await Promise.all(
            playlistCandidates.map(id =>
              spotifyFetch(`https://api.spotify.com/v1/playlists/${id}`, { headers })
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null)
            )
          );
          newPlaylists = res.filter(p => p && !p.error && p.id);
        } catch (e) {
          console.error("Hydration failed for playlists", e);
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

    hydrate();
  }, [token, pinnedItems, setPlaylists]);

  // --- SEVENS TURN CHECKER (HIGH-SPEED OFFSET METHOD) ---
  // Only active Sevens are polled. A finished Seven is still cross-referenced for duplicate
  // tracks inside the workspace, but it must never nag you that it is your turn.
  useEffect(() => {
    if (!token || !profile) return;

    const activeSevens = sevens.filter(s => s.active);
    if (activeSevens.length === 0) return; // stale entries are filtered out at render instead

    const checkSevens = async () => {
      const turns = [];
      for (const seven of activeSevens) {
        const id = seven.playlistId;
        try {
          // 1. Fetch only metadata and total track count (super lightweight)
          const res = await spotifyFetch(`https://api.spotify.com/v1/playlists/${id}?fields=id,name,images,tracks.total`, { 
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          
          if (data.tracks && data.tracks.total > 0) {
            data.partnerName = seven.partnerName || null;
            // 2. Fetch EXACTLY the last track to check who added it
            const offset = data.tracks.total - 1;
            const trackRes = await spotifyFetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=1&offset=${offset}`, { 
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
            data.partnerName = seven.partnerName || null;
            turns.push(data);
          }
        } catch (e) {
          console.error(`Failed to check sevens status for ${id}`, e);
        }
      }
      setSevenTurns(turns);
    };

    checkSevens();
  }, [token, profile, sevens]);

  // A Seven marked finished after its turn was fetched must stop nagging without a refetch
  const activeSevenTurns = sevenTurns.filter(turn => sevens.some(s => s.playlistId === turn.id && s.active));

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
        spotifyFetch('https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=5', { headers }),
        spotifyFetch('https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=5', { headers })
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
      <div className="relative flex items-center justify-center h-dvh bg-black text-white overflow-hidden">
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
              <div className="flex flex-col items-start relative z-10 w-full max-w-[1600px] animate-fade-in">
                
                {/* Phones have no sidebar footer: sync status, backup and disconnect live behind this */}
                <button
                  type="button"
                  onClick={() => useUserStore.getState().setAccountOpen(true)}
                  aria-label="Account and sync"
                  className="md:hidden absolute top-0 right-0 w-11 h-11 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-neutral-300 active:bg-white/10"
                >
                  <Settings className="w-5 h-5" />
                </button>

                {/* 1. Header & Stats Drawer Toggle */}
                <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 md:mb-12 w-full">
                  {profile.images?.length > 0 ? (
                    <img 
                      src={profile.images[0].url} 
                      alt="Profile Avatar" 
                      className="w-24 h-24 md:w-48 md:h-48 rounded-full shadow-2xl shadow-black/50"
                    />
                  ) : (
                    <div className="w-24 h-24 md:w-48 md:h-48 rounded-full bg-neutral-800 flex items-center justify-center text-4xl md:text-6xl shadow-2xl">
                      🎧
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-1">Profile</p>
                    <h1 className="text-3xl md:text-7xl font-extrabold text-white tracking-tighter mb-4 break-words">{profile.display_name}</h1>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <p className="text-neutral-400 font-medium">
                        {profile.followers?.total} Followers • {profile.product} tier
                      </p>
                      <span className="hidden md:block w-1.5 h-1.5 bg-neutral-600 rounded-full"></span>
                      <button
                        onClick={toggleAndLoadStats}
                        className="flex items-center px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:text-[#f91362] text-sm font-bold text-white transition-all group"
                      >
                        <BarChart3 className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform text-[var(--brand-mid)]" />
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
                                    <img src={artUrl(track.album.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-12 h-12 rounded-md shadow-md group-hover:scale-105 transition-transform" />
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
                {activeSevenTurns.length > 0 && (
                  <div className="w-full flex flex-col gap-4 mb-5 mt-2">
                    {activeSevenTurns.map(playlist => (
                      <div 
                        key={playlist.id}
                        onClick={() => { navigateToPlaylist(playlist.id); }}
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
                            <p className="text-[var(--brand-light)] font-medium text-xs md:text-sm">
                              {playlist.partnerName ? `${playlist.partnerName} just finished their drop.` : 'Your collaborator just finished their drop.'} Click to open the workspace.
                            </p>
                          </div>
                        </div>
                        <button className="bg-brand-gradient text-white px-5 py-2 rounded-full text-sm font-bold shadow-brand-glow group-hover:scale-105 transition-transform hidden sm:block">
                          Open Workspace
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <JumpBackIn />

                {/* Friends: the phone's way into the Friends page, since the tab bar has no slot for it */}
                <div className="w-full mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400">Friends</h3>
                    <button type="button" onClick={() => setCurrentView('friends')} className="text-xs font-bold text-white hover:underline">
                      {friends.length ? 'See all' : 'Add friends'}
                    </button>
                  </div>
                  {friends.length > 0 ? (
                    <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {friends.slice(0, 12).map((friend) => (
                        <button
                          key={friend.id}
                          type="button"
                          onClick={() => navigateToUser(friend.id)}
                          className="flex flex-col items-center gap-1.5 shrink-0 w-16 group"
                        >
                          {friend.image ? (
                            <img src={friend.image} alt="" loading="lazy" decoding="async" className="w-14 h-14 rounded-full object-cover shadow-md group-hover:scale-105 transition-transform" />
                          ) : (
                            <div className="w-14 h-14 rounded-full bg-neutral-700 flex items-center justify-center text-lg font-bold text-white shadow-md">
                              {String(friend.name || friend.id).charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-[11px] text-neutral-300 truncate w-full text-center">{friend.name || friend.id}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-500">Add people to see their public playlists and follow them.</p>
                  )}
                </div>

                {/* 4. The Custom Floating Pinned Sandbox (Dynamically Scaled) */}
                <div className="w-full pt-4">
                  {pinnedItems.length === 0 ? (
                    <div className="w-full border-2 border-dashed border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-neutral-500 bg-neutral-900/20 backdrop-blur-sm">
                      <span className="text-4xl mb-4">📌</span>
                      <p className="font-medium text-lg text-white text-center">Right-click (or long-press) playlists and albums to pin them to your home page.</p>
                    </div>
                  ) : (
                    <motion.div layout={!isMobile} className="flex flex-wrap justify-center items-center gap-8 md:gap-14 py-0 px-4">
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
                            onClick = () => { navigateToPlaylist(item.id); };
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
                            // Open THIS folder, not just the library root
                            onClick = () => { setCurrentView('library'); setActiveFolderId(item.id); };
                            imageNode = <span className={`${folderIconSizeClass} transition-transform duration-500 group-hover:scale-110`}>📁</span>;
                            title = item.name;
                            {
                              const subfolders = childrenOf(customFolders, item.id).length;
                              subtitle = `Folder • ${item.playlistIds.length} item${item.playlistIds.length === 1 ? '' : 's'}${subfolders ? ` · ${subfolders} folder${subfolders === 1 ? '' : 's'}` : ''}`;
                            }
                          }

                          const yOffset = count > 2 ? (i % 2 === 0 ? -15 : 15) : 0; 

                          return (
                            <motion.div
                              layout={!isMobile}
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
                              className={`${cardSizeClass} rounded-[2rem] bg-neutral-900/60 md:bg-white/[0.02] border border-white/[0.05] hover:border-white/20 hover:bg-white/[0.04] md:backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)] cursor-pointer group flex flex-col relative transition-colors`}
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

            <Suspense fallback={<ViewFallback />}>
              {currentView === 'library' && <Library />}
              {currentView === 'playlist' && (
                sevens.some(s => s.playlistId === activePlaylistId)
                  ? <PlaylistView_2 />
                  : <PlaylistView />
              )}
              {currentView === 'browse' && <Browse />}
              {currentView === 'artist' && <Artist />}
              {currentView === 'album' && <Album />}
              {currentView === 'liked-songs' && <LikedSongsView />}
              {currentView === 'lyrics' && <LyricsView />}
              {currentView === 'sevens' && <SevensSettings />}
              {currentView === 'friends' && <Friends />}
              {currentView === 'user' && <UserView />}
            </Suspense>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full relative z-10 gap-4">
            {profileError ? (
              <>
                <p className="text-white font-bold text-lg">{profileError}</p>
                <p className="text-neutral-400 text-sm">Retrying automatically…</p>
                <button
                  type="button"
                  onClick={() => setProfileAttempt(n => n + 1)}
                  className="mt-2 px-5 py-2 rounded-full bg-white/10 border border-white/10 text-white text-sm font-bold hover:bg-white/20 transition-colors"
                >
                  Try again now
                </button>
              </>
            ) : (
              <p className="text-neutral-400 animate-pulse text-lg">Loading Jomify core...</p>
            )}
          </div>
        )}
      </MainLayout>
    </>
  );
}

export default App;