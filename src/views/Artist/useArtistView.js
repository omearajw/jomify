import { useState, useEffect, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import { playUris, checkTracksLiked, spotifyFetch, fetchArtistAlbums, followArtists, unfollowArtists, checkFollowingArtists, playContext, fetchAlbumTrackUris, fetchArtistTopTracks } from '../../services/spotify/api';
import { loadAllLikedSongs, likedSongsLoaded, likedSongsByArtist } from '../../services/likedLibrary';
import { toast } from '../../store/toastStore';
import { shareSpotifyLink } from '../../services/share';

const randomIndex = (count) => Math.floor(Math.random() * count);

// What went wrong, in words rather than the error's own text ("RATE_LIMITED", "Failed to fetch")
const describeFailure = (err, status) => {
  if (status === 404) return "Spotify doesn't have this artist.";
  if (err?.message === 'RATE_LIMITED' || status === 429) return 'Spotify is rate-limiting requests right now. Try again in a moment.';
  if (status) return `Couldn't load this artist (Spotify answered ${status}).`;
  return "Couldn't reach Spotify. Check your connection and try again.";
};

// Everything the artist page does, with no markup: the artist, popular songs, the discography
// groups, following, your liked songs by them, and playing. The old page (Artist.jsx) and the
// room's surface (src/room/RoomArtist.jsx) are two faces on it.
export function useArtistView() {
  const { token, setLikedTracks, currentArtistId, setContextMenu, navigateToAlbum, followedArtists, addFollowedArtist, removeFollowedArtist, profile, setDraggedItem } = useSlice(useUserStore, ['token', 'setLikedTracks', 'currentArtistId', 'setContextMenu', 'navigateToAlbum', 'followedArtists', 'addFollowedArtist', 'removeFollowedArtist', 'profile', 'setDraggedItem']);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [artist, setArtist] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  // Spotify's four discography groups; albums and singles load with the page, the other two
  // when their tab is chosen
  const [groups, setGroups] = useState({ appears_on: null, compilation: null });
  const [tab, setTab] = useState('album');
  // Your liked songs by this artist: every liked song has to be read once for that, so it
  // waits for a tap, shows progress, and is instant afterwards
  const [likedHere, setLikedHere] = useState(() => {
    const all = likedSongsLoaded(profile?.id || '');
    return all ? likedSongsByArtist(all, currentArtistId) : null;
  });
  const [likedProgress, setLikedProgress] = useState(null); // { have, total }
  // Each part lands on its own, so the header is up while the discography pages in
  const [loading, setLoading] = useState({ artist: true, tracks: true, albums: true });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setError(''); setAttempt((n) => n + 1); };
  const shownId = useRef(null);


  useEffect(() => {
    if (!token || !currentArtistId) return;
    let cancelled = false;

    const fetchArtistData = async () => {
      try {
        setError('');
        // A different artist starts from skeletons; a token renewal on the same page keeps
        // what is already shown while it refetches
        if (shownId.current !== currentArtistId) {
          setLoading({ artist: true, tracks: true, albums: true });
          setArtist(null);
          setTopTracks([]);
          setAlbums([]);
          setGroups({ appears_on: null, compilation: null });
          setTab('album');
          setLikedHere(null);
        }
        shownId.current = currentArtistId;
        const headers = { Authorization: `Bearer ${token}` };

        // Artist details. An error payload is truthy, so without this check a 404 rendered a
        // header full of `undefined` instead of "not found".
        const artistRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${currentArtistId}`, { headers });
        if (!artistRes.ok) {
          const err = new Error(`Spotify returned ${artistRes.status}`);
          err.status = artistRes.status;
          throw err;
        }
        const artistData = await artistRes.json();
        if (cancelled) return;
        setArtist(artistData);
        setLoading((l) => ({ ...l, artist: false }));

        // Popular tracks, or what stands in for them once Spotify withdraws the endpoint
        const tracksData = { tracks: await fetchArtistTopTracks(token, currentArtistId, artistData.name) };
        if (cancelled) return;
        setTopTracks(tracksData.tracks || []);
        setLoading((l) => ({ ...l, tracks: false }));

        // Check liked status
        if (tracksData.tracks) {
          const ids = tracksData.tracks.map(track => track.id).filter(Boolean);
          if (ids.length > 0) {
            checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
          }
        }

        // Albums and singles, every page. Without include_groups the single page of 20 filled
        // up with compilations and "appears on" entries, so prolific artists showed a
        // near-random subset of their own records.
        const collected = [];
        let nextUrl = `https://api.spotify.com/v1/artists/${currentArtistId}/albums?include_groups=album,single&limit=50&market=from_token`;
        let pages = 0;
        while (nextUrl && pages < 6) {
          const res = await spotifyFetch(nextUrl, { headers });
          if (!res.ok) break;
          const data = await res.json();
          collected.push(...(data.items || []));
          nextUrl = data.next;
          pages += 1;
        }
        if (cancelled) return;
        setAlbums(collected);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch artist data:', err);
        setArtist(null);
        setError(describeFailure(err, err?.status));
      } finally {
        if (!cancelled) setLoading({ artist: false, tracks: false, albums: false });
      }
    };

    fetchArtistData();
    return () => { cancelled = true; };
  }, [token, currentArtistId, setLikedTracks, attempt]);

  const loadGroup = (group) => {
    if (!token || !currentArtistId || groups[group] !== null) return;
    setGroups((g) => ({ ...g, [group]: 'loading' }));
    fetchArtistAlbums(token, currentArtistId, group)
      .then((list) => setGroups((g) => ({ ...g, [group]: list })))
      .catch(() => setGroups((g) => ({ ...g, [group]: [] })));
  };
  const pickTab = (next) => { setTab(next); if (next === 'appears_on' || next === 'compilation') loadGroup(next); };
  const albumsOnly = albums.filter((a) => a.album_type === 'album' || (!a.album_type && a.total_tracks > 6));
  const singles = albums.filter((a) => a.album_type === 'single' || (!a.album_type && a.total_tracks <= 6));
  const shownAlbums = tab === 'album' ? albumsOnly : tab === 'single' ? singles : (Array.isArray(groups[tab]) ? groups[tab] : []);
  const tabLoading = tab !== 'album' && tab !== 'single' && groups[tab] === 'loading';

  // Following: the library knows; a fresh check when the page opens keeps it honest
  const isFollowed = followedArtists.some((a) => a.id === currentArtistId);
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
    if (!token || !currentArtistId || !artist) return undefined;
    let cancelled = false;
    checkFollowingArtists(token, [currentArtistId]).then(([yes]) => {
      if (cancelled) return;
      if (yes && !useUserStore.getState().followedArtists.some((a) => a.id === currentArtistId)) addFollowedArtist(artist);
      if (!yes && useUserStore.getState().followedArtists.some((a) => a.id === currentArtistId)) removeFollowedArtist(currentArtistId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, currentArtistId, artist, addFollowedArtist, removeFollowedArtist]);
  const toggleFollow = async () => {
    if (!token || !artist || followBusy) return;
    setFollowBusy(true);
    try {
      if (isFollowed) {
        await unfollowArtists(token, [artist.id]);
        removeFollowedArtist(artist.id);
        toast(`Unfollowed ${artist.name}`, { action: { label: 'Undo', onClick: async () => { try { await followArtists(token, [artist.id]); addFollowedArtist(artist); } catch { toast("Couldn't follow again", { tone: 'error' }); } } } });
      } else {
        await followArtists(token, [artist.id]);
        addFollowedArtist(artist);
        toast(`Following ${artist.name}`, { tone: 'success' });
      }
    } catch (err) {
      console.error(err);
      toast(isFollowed ? "Couldn't unfollow" : "Couldn't follow", { tone: 'error' });
    } finally {
      setFollowBusy(false);
    }
  };
  const openArtistMenu = (e) => {
    e.preventDefault();
    setContextMenu({ type: 'artist', x: e.pageX, y: e.pageY, artistId: currentArtistId, artist, onArtistPage: true });
  };
  const openTrackMenu = (e, track) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track });
  const openAlbumMenu = (e, album) => setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id, album });

  const loadLikedHere = async () => {
    if (!token) return;
    setLikedProgress({ have: 0, total: 0 });
    try {
      const all = await loadAllLikedSongs(token, profile?.id || '', (have, total) => setLikedProgress({ have, total }));
      setLikedHere(likedSongsByArtist(all, currentArtistId));
    } catch (err) {
      toast(err?.message === 'RATE_LIMITED' ? 'Spotify is rate-limiting requests; try again in a moment' : "Couldn't read your liked songs", { tone: 'error' });
    } finally {
      setLikedProgress(null);
    }
  };
  const playLikedHere = (index) => {
    const uris = (likedHere || []).map((t) => t.uri).filter(Boolean);
    if (!token || !uris.length) return;
    playOn((deviceId) => playUris(token, deviceId, uris.slice(0, 100), Math.min(index, 99)), { track: likedHere[index] });
  };

  // The clicked row and then the rest of the popular tracks, in the order shown. A single URI
  // used to stop dead after one song.
  // After the ten popular tracks, play on into the artist's albums rather than stopping
  const handleTrackPlay = (trackUri) => {
    if (!token) return;
    const top = topTracks.slice(0, 10).map(t => t.uri).filter(Boolean);
    const index = Math.max(0, top.indexOf(trackUri));
    const track = topTracks.find((t) => t.uri === trackUri) || null;
    playOn(async (deviceId) => {
      const more = [];
      for (const album of albumsOnly.slice(0, 3)) {
        if (top.length + more.length >= 100) break;
        try { more.push(...(await fetchAlbumTrackUris(token, album.id)).filter((u) => !top.includes(u))); } catch { /* the popular tracks still play */ }
      }
      return playUris(token, deviceId, [...top, ...more].slice(0, 100), index);
    }, { track });
  };
  const playArtist = () => {
    if (!artist) return;
    playOn((deviceId) => playContext(token, deviceId, `spotify:artist:${artist.id}`));
  };
  const playAlbum = (albumId) => {
    if (!token || !albumId) return;
    playOn((deviceId) => playContext(token, deviceId, `spotify:album:${albumId}`));
  };
  const shufflePlay = () => {
    if (!token || !artist) return;
    playOn(async (deviceId) => {
      await setShuffle(true, deviceId);
      await playContext(token, deviceId, `spotify:artist:${artist.id}`, randomIndex(Math.max(1, topTracks.length)));
    });
  };
  const share = () => { if (artist) shareSpotifyLink('artist', artist.id, artist.name); };

  return {
    token, currentArtistId, setContextMenu, navigateToAlbum, setDraggedItem, currentPlayingTrack, isCurrentTrackPaused,
    artist, topTracks, albums, albumsOnly, singles, shownAlbums, tab, pickTab, tabLoading,
    likedHere, likedProgress, loadLikedHere, playLikedHere,
    loading, error, retry,
    isFollowed, followBusy, toggleFollow, openArtistMenu, openTrackMenu, openAlbumMenu,
    handleTrackPlay, playArtist, playAlbum, shufflePlay, share
  };
}
