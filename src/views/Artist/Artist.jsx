import { useState, useEffect, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { artUrl } from '../../utils/images';
import { playOn, setShuffle } from '../../services/spotify/playbackController';
import MoreButton, { CardMoreButton } from '../../components/MoreButton';
import { playUris, checkTracksLiked, spotifyFetch, fetchArtistAlbums, followArtists, unfollowArtists, checkFollowingArtists, playContext, fetchAlbumTrackUris } from '../../services/spotify/api';
import { loadAllLikedSongs, likedSongsLoaded, likedSongsByArtist } from '../../services/likedLibrary';
import { toast } from '../../store/toastStore';
import { shareSpotifyLink } from '../../services/share';
import { formatTime } from '../../utils/formatTime';
import { Play, UserPlus, UserCheck, Loader2, Share2, Heart, Shuffle } from 'lucide-react';

const randomIndex = (count) => Math.floor(Math.random() * count);
import LikeButton from '../../components/LikeButton';
import { SkeletonHeader, SkeletonRows, SkeletonCards } from '../../components/Skeleton';
import { rowButtonProps } from '../../utils/a11y';
import { isSameTrack } from '../../utils/spotifyUri';

// What went wrong, in words rather than the error's own text ("RATE_LIMITED", "Failed to fetch")
const describeFailure = (err, status) => {
  if (status === 404) return "Spotify doesn't have this artist.";
  if (err?.message === 'RATE_LIMITED' || status === 429) return 'Spotify is rate-limiting requests right now. Try again in a moment.';
  if (status) return `Couldn't load this artist (Spotify answered ${status}).`;
  return "Couldn't reach Spotify. Check your connection and try again.";
};

export default function Artist() {
  const { token, setLikedTracks, currentArtistId, setContextMenu, navigateToAlbum, followedArtists, addFollowedArtist, removeFollowedArtist, profile } = useSlice(useUserStore, ['token', 'setLikedTracks', 'currentArtistId', 'setContextMenu', 'navigateToAlbum', 'followedArtists', 'addFollowedArtist', 'removeFollowedArtist', 'profile']);
  const { currentPlayingTrack } = usePlaybackSummary();
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

        // Top tracks in the listener's own market, not a hardcoded US one
        const tracksRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${currentArtistId}/top-tracks?market=from_token`, { headers });
        const tracksData = tracksRes.ok ? await tracksRes.json() : { tracks: [] };
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
  const shufflePlay = () => {
    if (!token || !artist) return;
    playOn(async (deviceId) => {
      await setShuffle(true, deviceId);
      await playContext(token, deviceId, `spotify:artist:${artist.id}`, randomIndex(Math.max(1, topTracks.length)));
    });
  };

  // Back navigation is the global button in MainLayout; this view used to render a second one
  // 64px below it doing the identical thing.
  if (!artist) {
    return (
      <div className="flex flex-col pb-8">
        {loading.artist ? (
          <>
            <SkeletonHeader round />
            <SkeletonRows count={6} />
          </>
        ) : (
          <div className="mt-8 max-w-xl rounded-3xl border border-white/10 bg-neutral-900/60 p-8 animate-fade-in">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Artist</p>
            <p className="text-neutral-300 text-sm">{error || "Couldn't load this artist."}</p>
            <button type="button" onClick={retry} className="mt-4 inline-flex items-center rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-white hover:bg-white/5 transition-colors">
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Artist Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-6 md:mb-12">
        <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-700 rounded-full overflow-hidden shadow-2xl flex-shrink-0">
          {artist.images?.[0]?.url && (
            <img src={artist.images[0].url} alt={artist.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Artist</p>
          <h1 className="text-2xl md:text-6xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{artist.name}</h1>
          {/* Spotify no longer sends follower counts to apps like Jomify; shown only if present */}
          {artist.followers?.total != null && (
            <p className="text-sm md:text-base text-neutral-400 font-medium mb-2 md:mb-4">
              {artist.followers.total.toLocaleString()} followers
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <button
              type="button"
              onClick={() => playOn((deviceId) => playContext(token, deviceId, `spotify:artist:${artist.id}`))}
              aria-label={`Play ${artist.name}`}
              className="w-11 h-11 md:w-12 md:h-12 bg-brand-gradient text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-xl shrink-0"
            >
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </button>
            <button type="button" onClick={shufflePlay} aria-label="Shuffle play" title="Shuffle play" className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors">
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleFollow}
              disabled={followBusy}
              aria-pressed={isFollowed}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all disabled:opacity-60 ${isFollowed ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'border border-white/20 text-white hover:bg-white/10'}`}
            >
              {followBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowed ? <UserCheck className="w-4 h-4 text-[var(--brand-mid)]" /> : <UserPlus className="w-4 h-4" />}
              {isFollowed ? 'Following' : 'Follow'}
            </button>
            <button type="button" onClick={() => shareSpotifyLink('artist', artist.id, artist.name)} aria-label="Share" title="Share" className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
            <MoreButton onOpen={openArtistMenu} label={`Options for ${artist.name}`} className="!flex" />
          </div>
          {artist.genres?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {artist.genres.slice(0, 5).map((genre) => (
                <span key={genre} className="px-2.5 py-0.5 md:px-3 md:py-1 rounded-full bg-white/5 border border-white/10 text-brand-gradient text-xs md:text-sm font-semibold">
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Tracks */}
      {loading.tracks && <div className="mb-12"><SkeletonRows count={5} /></div>}
      {topTracks.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Popular Tracks</h2>
          <div className="flex flex-col space-y-1">
            {topTracks.slice(0, 10).map((track) => {
              const isCurrentTrack = isSameTrack(track, currentPlayingTrack);

                return (
                  <div
                    key={track.id}
                    onClick={() => handleTrackPlay(track.uri)}
                    {...rowButtonProps(() => handleTrackPlay(track.uri))}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                  >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <div className="relative w-12 h-12 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center">
                      <img src={artUrl(track.album.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-full h-full object-cover rounded" />
                      <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded">
                        <Play className="w-4 h-4 text-white fill-current" />
                      </div>
                    </div>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                        {track.name}
                      </p>
                      <p className="text-neutral-400 text-xs truncate">
                        {track.album.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your liked songs by this artist: Spotify doesn't offer it, so it is Jomify's own */}
      {!loading.tracks && (
        <div className="mb-12">
          <div className="flex items-center justify-between gap-4 mb-3 md:mb-6">
            <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2"><Heart className="w-5 h-5 fill-[var(--brand-mid)] text-[var(--brand-mid)]" /> Your liked songs by {artist.name}</h2>
            {likedHere && likedHere.length > 0 && (
              <button type="button" onClick={() => playLikedHere(0)} className="text-sm font-bold text-neutral-300 hover:text-white">Play all {likedHere.length}</button>
            )}
          </div>
          {likedHere === null ? (
            likedProgress ? (
              <p className="text-sm text-neutral-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading your liked songs… {likedProgress.total ? `${likedProgress.have.toLocaleString()} of ${likedProgress.total.toLocaleString()}` : ''}</p>
            ) : (
              <button type="button" onClick={loadLikedHere} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">
                Find them
                <span className="block text-xs font-normal text-neutral-500">Reads your whole Liked Songs once this session</span>
              </button>
            )
          ) : likedHere.length === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <div className="flex flex-col space-y-1">
              {likedHere.slice(0, 50).map((track, index) => (
                <div
                  key={track.id}
                  onClick={() => playLikedHere(index)}
                  {...rowButtonProps(() => playLikedHere(index))}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track }); }}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 overflow-hidden">
                      {track.album?.images?.[0]?.url && <img src={artUrl(track.album.images, 48)} alt="" width="40" height="40" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                    </div>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isSameTrack(track, currentPlayingTrack) ? 'text-brand-gradient' : 'text-white'}`}>{track.name}</p>
                      <p className="text-neutral-400 text-xs truncate">{track.album?.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track })} />
                  </div>
                </div>
              ))}
              {likedHere.length > 50 && <p className="px-4 py-2 text-xs text-neutral-500">{likedHere.length - 50} more</p>}
            </div>
          )}
        </div>
      )}

      {/* Discography */}
      {loading.albums && !loading.tracks && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Albums</h2>
          <SkeletonCards count={5} gridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" />
        </div>
      )}
      {albums.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <h2 className="text-2xl font-bold text-white mr-2">Discography</h2>
            {[['album', 'Albums', albumsOnly.length], ['single', 'Singles and EPs', singles.length], ['appears_on', 'Appears on', null], ['compilation', 'Compilations', null]].map(([id, label, count]) => (
              (count === null || count > 0) && (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => pickTab(id)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === id ? 'bg-white text-black' : 'bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10'}`}
                >
                  {label}{count ? ` ${count}` : ''}
                </button>
              )
            ))}
          </div>
          {tabLoading && <SkeletonCards count={5} gridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" />}
          {!tabLoading && shownAlbums.length === 0 && <p className="text-sm text-neutral-500">Nothing in this group.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {shownAlbums.map((album) => (
              <div 
                key={album.id}
                onClick={() => navigateToAlbum(album.id)}
                {...rowButtonProps(() => navigateToAlbum(album.id))}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id, album }); }}
                className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
              >
                <div className="relative aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                  {album.images?.[0]?.url && (
                    <img src={artUrl(album.images, 300)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
                  <CardMoreButton label={`Options for ${album.name}`} onOpen={(e) => setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id, album })} />
                </div>
                <p className="text-white text-sm font-bold truncate w-full">{album.name}</p>
                <p className="text-neutral-400 text-xs truncate w-full mt-0.5">{album.release_date?.split('-')[0]}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
