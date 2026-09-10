import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { playSingleTrack, checkTracksLiked, spotifyFetch } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Play } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import { cleanString } from '../../utils/strings';
import { rowButtonProps } from '../../utils/a11y';

export default function Artist() {
  const { token, setLikedTracks, currentArtistId, setContextMenu, navigateToAlbum } = useUserStore();
  const { deviceId, playbackState } = usePlayerStore();
  const [artist, setArtist] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currentPlayingTrack = playbackState?.track_window?.current_track;

  useEffect(() => {
    if (!token || !currentArtistId) return;
    let cancelled = false;

    const fetchArtistData = async () => {
      try {
        setLoading(true);
        setError('');
        const headers = { Authorization: `Bearer ${token}` };

        // Artist details. An error payload is truthy, so without this check a 404 rendered a
        // header full of `undefined` instead of "not found".
        const artistRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${currentArtistId}`, { headers });
        if (!artistRes.ok) {
          throw new Error(artistRes.status === 404 ? 'Artist not found' : `Spotify returned ${artistRes.status}`);
        }
        const artistData = await artistRes.json();
        if (cancelled) return;
        setArtist(artistData);

        // Top tracks in the listener's own market, not a hardcoded US one
        const tracksRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${currentArtistId}/top-tracks?market=from_token`, { headers });
        const tracksData = tracksRes.ok ? await tracksRes.json() : { tracks: [] };
        if (cancelled) return;
        setTopTracks(tracksData.tracks || []);

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
        setError(err.message || 'Failed to load artist');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchArtistData();
    return () => { cancelled = true; };
  }, [token, currentArtistId, setLikedTracks]);

  const handleTrackPlay = (trackUri) => {
    if (!token || !deviceId) return;
    playSingleTrack(token, deviceId, trackUri).catch(console.error);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <p className="text-lg">Loading artist...</p>
      </div>
    );
  }

  // Back navigation is the global button in MainLayout; this view used to render a second one
  // 64px below it doing the identical thing.
  if (!artist) {
    return (
      <div className="flex flex-col pb-8">
        <p className="text-neutral-400">{error || 'Artist not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Artist Header */}
      <div className="flex items-end gap-6 mb-12">
        <div className="w-48 h-48 bg-neutral-700 rounded-full overflow-hidden shadow-2xl flex-shrink-0">
          {artist.images?.[0]?.url && (
            <img src={artist.images[0].url} alt={artist.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Artist</p>
          <h1 className="text-6xl font-extrabold text-white tracking-tighter mb-4">{artist.name}</h1>
          <p className="text-neutral-400 font-medium mb-4">
            {artist.followers?.total?.toLocaleString()} followers
          </p>
          {artist.genres?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {artist.genres.slice(0, 5).map((genre) => (
                <span key={genre} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-brand-gradient text-sm font-semibold">
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Tracks */}
      {topTracks.length > 0 && (
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-6">Popular Tracks</h2>
          <div className="flex flex-col space-y-1">
            {topTracks.slice(0, 10).map((track) => {
              const isCurrentTrack = currentPlayingTrack && (
                track.id === currentPlayingTrack.id || 
                track.uri === currentPlayingTrack.uri ||
                (cleanString(track.name) === cleanString(currentPlayingTrack.name) && 
                 track.artists?.[0]?.name === currentPlayingTrack.artists?.[0]?.name)
              );

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
                      <img src={track.album.images?.[0]?.url} alt="" className="w-full h-full object-cover rounded" />
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
                    <span className="text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Albums */}
      {albums.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">Albums</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {albums.map((album) => (
              <div 
                key={album.id}
                onClick={() => navigateToAlbum(album.id)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'album', x: e.pageX, y: e.pageY, albumId: album.id }); }}
                className="bg-neutral-800/30 p-4 rounded-xl cursor-pointer hover:bg-neutral-800/60 transition-colors group"
              >
                <div className="aspect-square bg-neutral-700 rounded-md mb-3 overflow-hidden shadow-md">
                  {album.images?.[0]?.url && (
                    <img src={album.images[0].url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
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
