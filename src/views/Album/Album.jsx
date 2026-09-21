import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { playOn } from '../../services/spotify/playbackController';
import MoreButton from '../../components/MoreButton';
import { SkeletonHeader, SkeletonRows } from '../../components/Skeleton';
import { playContext, checkTracksLiked, fetchMoreTracks, spotifyFetch, saveAlbumToLibrary, unsaveAlbum } from '../../services/spotify/api';
import { formatTime } from '../../utils/formatTime';
import { Plus, Check, Loader2 } from 'lucide-react';
import LikeButton from '../../components/LikeButton';
import TrackArtists from '../../components/TrackArtists';
import { cleanString } from '../../utils/strings';
import { rowButtonProps } from '../../utils/a11y';

export default function Album() {
  const { token, setLikedTracks, currentAlbumId, setContextMenu, albums, setAlbums, removeAlbumFromLibrary } = useSlice(useUserStore, ['token', 'setLikedTracks', 'currentAlbumId', 'setContextMenu', 'albums', 'setAlbums', 'removeAlbumFromLibrary']);
  const { currentPlayingTrack } = usePlaybackSummary();
  const [album, setAlbum] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  // A saved album's header is known before Spotify answers
  const summary = albums.find((a) => a.id === currentAlbumId) || null;
  const shown = album || (loading ? summary : null);
  const [error, setError] = useState('');


  useEffect(() => {
    if (!token || !currentAlbumId) return;
    let cancelled = false;

    const fetchAlbumData = async () => {
      try {
        setLoading(true);
        setError('');

        // An error payload is truthy, so without this check a 404 rendered a header full of
        // `undefined` instead of "not found".
        const albumRes = await spotifyFetch(`https://api.spotify.com/v1/albums/${currentAlbumId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!albumRes.ok) {
          throw new Error(albumRes.status === 404 ? 'Album not found' : `Spotify returned ${albumRes.status}`);
        }
        const albumData = await albumRes.json();
        if (cancelled) return;
        setAlbum(albumData);

        // The album object carries the first 50 tracks; long compilations and deluxe editions
        // have more, and used to be silently truncated.
        const allTracks = [...(albumData.tracks?.items || [])];
        let nextUrl = albumData.tracks?.next;
        while (nextUrl) {
          const page = await fetchMoreTracks(token, nextUrl);
          allTracks.push(...(page.items || []));
          nextUrl = page.next;
        }
        if (cancelled) return;
        setTracks(allTracks);

        // Check liked status
        const ids = allTracks.map(track => track.id).filter(Boolean);
        if (ids.length > 0) {
          checkTracksLiked(token, ids).then(setLikedTracks).catch(console.error);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch album data:', err);
        setAlbum(null);
        setError(err.message || 'Failed to load album');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAlbumData();
    return () => { cancelled = true; };
  }, [token, currentAlbumId, setLikedTracks]);

  // Album context, offset at the clicked row: playback carries on through the album and Spotify
  // shows "playing from <album>"
  const handleTrackPlay = (trackUri) => {
    if (!token) return;
    const index = Math.max(0, tracks.findIndex(t => t.uri === trackUri));
    playOn((deviceId) => playContext(token, deviceId, `spotify:album:${currentAlbumId}`, index));
  };

  // --- SAVE / UNSAVE ---
  // The helper existed in api.js from the start but nothing ever called it; there was no way to
  // save an album from its own page.
  const [saving, setSaving] = useState(false);
  const isSaved = Boolean(album) && (albums || []).some(a => a.id === album.id);

  const handleToggleSave = async () => {
    if (!token || !album || saving) return;
    setSaving(true);
    try {
      if (isSaved) {
        await unsaveAlbum(token, album.id);
        removeAlbumFromLibrary(album.id);
      } else {
        await saveAlbumToLibrary(token, album.id);
        setAlbums([...(albums || []), {
          id: album.id,
          name: album.name,
          images: album.images,
          artists: album.artists,
          type: 'album',
          total_tracks: album.total_tracks
        }]);
      }
    } catch (err) {
      console.error('Failed to update saved album:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !shown) {
    return (
      <div className="flex flex-col pb-8">
        <SkeletonHeader />
        <SkeletonRows count={8} art={false} />
      </div>
    );
  }

  // Back navigation is the global button in MainLayout; this view used to render a second one
  // 64px below it doing the identical thing.
  if (!shown) {
    return (
      <div className="flex flex-col pb-8">
        <p className="text-neutral-400">{error || 'Album not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Album Header */}
      <div className="flex flex-row items-center md:items-end gap-4 md:gap-6 mb-6 md:mb-12">
        <div className="w-24 h-24 md:w-48 md:h-48 bg-neutral-700 rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
          {shown.images?.[0]?.url && (
            <img src={shown.images[0].url} alt={shown.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="hidden md:block text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Album</p>
          <h1 className="text-2xl md:text-6xl font-extrabold text-white tracking-tighter mb-1 md:mb-4 break-words line-clamp-2 md:line-clamp-none">{shown.name}</h1>
          <div className="text-sm md:text-base text-neutral-400 font-medium md:mb-4">
            <p>
              By{' '}
              <TrackArtists artists={shown.artists} className="text-white" linkClassName="hover:underline" />
            </p>
            <p className="mt-0.5 md:mt-2">
              {shown.release_date ? `${shown.release_date.split('-')[0]} • ` : ''}{shown.total_tracks} tracks
            </p>
            <button
              type="button"
              onClick={handleToggleSave}
              disabled={saving}
              aria-pressed={isSaved}
              className={`mt-3 md:mt-4 inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-bold transition-all disabled:opacity-60 ${
                isSaved
                  ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15'
                  : 'bg-brand-gradient text-white shadow-brand-glow hover:scale-105'
              }`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isSaved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isSaved ? 'In your library' : 'Save to library'}
            </button>
          </div>
        </div>
      </div>

      {/* Album Tracks */}
      {loading && (
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Tracks</h2>
          <SkeletonRows count={8} art={false} />
        </div>
      )}
      {tracks.length > 0 && (
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3 md:mb-6">Tracks</h2>
          <div className="flex flex-col space-y-1">
            {tracks.map((track, index) => {
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
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track, sourceAlbumId: currentAlbumId }); }}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 rounded-md group text-sm cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-4 truncate pr-4">
                    <span className="text-neutral-400 w-8 text-right">{index + 1}</span>
                    <div className="truncate">
                      <p className={`font-medium truncate ${isCurrentTrack ? 'text-brand-gradient' : 'text-white'}`}>
                        {track.name}
                      </p>
                      <TrackArtists
                        artists={track.artists}
                        className="block text-neutral-400 text-xs truncate"
                        linkClassName="hover:underline hover:text-white pointer-coarse:pointer-events-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <LikeButton trackId={track.id} />
                    <span className="hidden md:inline text-neutral-400 text-xs w-8 text-right">{formatTime(track.duration_ms)}</span>
                    <MoreButton onOpen={(e) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track, sourceAlbumId: currentAlbumId })} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
