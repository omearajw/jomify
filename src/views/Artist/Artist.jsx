import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { artUrl } from '../../utils/images';
import { playOn } from '../../services/spotify/playbackController';
import MoreButton, { CardMoreButton } from '../../components/MoreButton';
import { playUris, checkTracksLiked, spotifyFetch } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Play } from 'lucide-react';
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
  const { token, setLikedTracks, currentArtistId, setContextMenu, navigateToAlbum } = useSlice(useUserStore, ['token', 'setLikedTracks', 'currentArtistId', 'setContextMenu', 'navigateToAlbum']);
  const { currentPlayingTrack } = usePlaybackSummary();
  const [artist, setArtist] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  // Each part lands on its own, so the header is up while the discography pages in
  const [loading, setLoading] = useState({ artist: true, tracks: true, albums: true });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setError(''); setAttempt((n) => n + 1); };


  useEffect(() => {
    if (!token || !currentArtistId) return;
    let cancelled = false;

    const fetchArtistData = async () => {
      try {
        setLoading({ artist: true, tracks: true, albums: true });
        setError('');
        setArtist(null);
        setTopTracks([]);
        setAlbums([]);
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

  // The clicked row and then the rest of the popular tracks, in the order shown. A single URI
  // used to stop dead after one song.
  const handleTrackPlay = (trackUri) => {
    if (!token) return;
    const uris = topTracks.slice(0, 10).map(t => t.uri).filter(Boolean);
    const index = Math.max(0, uris.indexOf(trackUri));
    playOn((deviceId) => playUris(token, deviceId, uris, index));
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

      {/* Albums */}
      {loading.albums && !loading.tracks && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Albums</h2>
          <SkeletonCards count={5} gridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" />
        </div>
      )}
      {albums.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Albums</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {albums.map((album) => (
              <div 
                key={album.id}
                onClick={() => navigateToAlbum(album.id)}
                {...rowButtonProps(() => navigateToAlbum(album.id))}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id }); }}
                className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
              >
                <div className="relative aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                  {album.images?.[0]?.url && (
                    <img src={artUrl(album.images, 300)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
                  <CardMoreButton label={`Options for ${album.name}`} onOpen={(e) => setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id })} />
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
