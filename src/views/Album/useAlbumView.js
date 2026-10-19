import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { setShuffle } from '../../services/spotify/playbackController';
import { startPlaying } from '../../queue/play';
import { playContext, checkTracksLiked, fetchMoreTracks, spotifyFetch, saveAlbumToLibrary, unsaveAlbum } from '../../services/spotify/api';
import { formatDuration } from '../../utils/formatTime';
import { isUnplayable, unplayableWhy } from '../../utils/spotifyUri';
import { toast } from '../../store/toastStore';

export const ALBUM_KIND = { album: 'Album', single: 'Single', compilation: 'Compilation' };

// Spotify sends the date at the precision it has ("2015", "2015-07" or "2015-07-17")
export const formatReleaseDate = (date, precision) => {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const p = precision || (d ? 'day' : m ? 'month' : 'year');
  if (p === 'year' || !m) return String(y);
  const dt = new Date(Date.UTC(y, m - 1, d || 1));
  return dt.toLocaleDateString(undefined, p === 'month' ? { year: 'numeric', month: 'long', timeZone: 'UTC' } : { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

const randomIndex = (count) => Math.floor(Math.random() * count);

// Everything the album page does, with no markup: the album and all its tracks, the liked check,
// save/unsave, play and shuffle. The old page (Album.jsx) and the room's surface
// (src/room/RoomAlbum.jsx) are two faces on it.
export function useAlbumView() {
  const { token, setLikedTracks, currentAlbumId, setContextMenu, albums, setAlbums, removeAlbumFromLibrary } = useSlice(useUserStore, ['token', 'setLikedTracks', 'currentAlbumId', 'setContextMenu', 'albums', 'setAlbums', 'removeAlbumFromLibrary']);
  const { currentPlayingTrack, isCurrentTrackPaused } = usePlaybackSummary();
  const [album, setAlbum] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  // A saved album's header is known before Spotify answers
  const summary = albums.find((a) => a.id === currentAlbumId) || null;
  const shown = album || (loading ? summary : null);
  const [error, setError] = useState('');
  // Set when a later page of tracks fails: what loaded stays up, with a way to fetch the rest
  const [restError, setRestError] = useState('');

  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    if (!token || !currentAlbumId) return;
    let cancelled = false;

    const fetchAlbumData = async () => {
      try {
        setLoading(true);
        setError('');

        // An error payload is truthy, so without this check a 404 rendered a header full of
        // `undefined` instead of "not found".
        const albumRes = await spotifyFetch(`https://api.spotify.com/v1/albums/${currentAlbumId}?market=from_token`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!albumRes.ok) {
          throw new Error(albumRes.status === 404 ? 'Album not found' : `Spotify returned ${albumRes.status}`);
        }
        const albumData = await albumRes.json();
        if (cancelled) return;
        setAlbum(albumData);

        // The album object carries the first 50 tracks; long compilations and deluxe editions
        // have more, and used to be silently truncated. A later page failing used to replace the
        // whole album, header included, with an error; now what arrived stays up.
        const allTracks = [...(albumData.tracks?.items || [])];
        setTracks(allTracks);
        setRestError('');
        let nextUrl = albumData.tracks?.next;
        while (nextUrl) {
          let page;
          try { page = await fetchMoreTracks(token, nextUrl); }
          catch (err) {
            if (cancelled) return;
            console.error('Album tracks stopped loading partway:', err);
            setRestError(err?.message === 'RATE_LIMITED' ? 'Spotify rate-limited the rest of the tracks.' : "Couldn't load the rest of the tracks.");
            break;
          }
          allTracks.push(...(page.items || []));
          nextUrl = page.next;
        }
        if (cancelled) return;
        setTracks([...allTracks]);

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
  }, [token, currentAlbumId, setLikedTracks, reloadNonce]);
  const retry = () => setReloadNonce((n) => n + 1);

  const country = useUserStore((s) => s.profile?.country);
  // Only once every track is in, so a long compilation never shows half its length
  const totalLength = !loading && !restError && tracks.length > 0 && tracks.length >= (album?.total_tracks || 0)
    ? formatDuration(tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0))
    : '';
  const discCount = tracks.reduce((max, t) => Math.max(max, t.disc_number || 1), 1);

  // Album context, offset at the clicked row: playback carries on through the album and Spotify
  // shows "playing from <album>"
  const handleTrackPlay = (trackUri) => {
    if (!token) return;
    const index = Math.max(0, tracks.findIndex(t => t.uri === trackUri));
    if (isUnplayable(tracks[index], country)) { toast(`${unplayableWhy(tracks[index], country)}.`); return; }
    // The tapped song shows at once rather than after Spotify's next report
    const track = tracks[index] ? { ...tracks[index], album: tracks[index].album || album } : null;
    startPlaying(albumSource({ start: index, track }), (deviceId) => playContext(token, deviceId, `spotify:album:${currentAlbumId}`, index));
  };
  // For the queue (src/queue): the album's songs from the screen once they have all loaded
  const albumSource = (extra) => {
    const complete = tracks.length > 0 && tracks.length >= (album?.total_tracks || 0);
    return { uri: `spotify:album:${shown?.id || currentAlbumId}`, kind: 'album', name: shown?.name || album?.name || '', ...(complete ? { tracks: tracks.map((t) => ({ ...t, album: t.album || album })) } : {}), ...extra };
  };
  const playAlbum = () => {
    if (!shown) return;
    startPlaying(albumSource({ start: 0 }), (deviceId) => playContext(token, deviceId, `spotify:album:${shown.id}`, 0));
  };
  const shuffleAlbum = () => {
    if (!shown) return;
    startPlaying(albumSource({ shuffle: true }), async (deviceId) => { await setShuffle(true, deviceId); await playContext(token, deviceId, `spotify:album:${shown.id}`, randomIndex(Math.max(1, shown.total_tracks || tracks.length || 1))); });
  };
  const openTrackMenu = (e, track) => setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track, sourceAlbumId: currentAlbumId });

  // The helper existed in api.js from the start but nothing ever called it; there was no way to
  // save an album from its own page.
  const [saving, setSaving] = useState(false);
  // Judged from whatever is on screen, so a saved album reads as saved while its full record
  // is still loading, and the button works in that time too
  const isSaved = Boolean(shown) && (albums || []).some(a => a.id === shown.id);

  const handleToggleSave = async () => {
    if (!token || !shown || saving) return;
    setSaving(true);
    try {
      if (isSaved) {
        await unsaveAlbum(token, shown.id);
        removeAlbumFromLibrary(shown.id);
        toast(`Removed "${shown.name}" from your library`, { tone: 'info' });
      } else {
        await saveAlbumToLibrary(token, shown.id);
        setAlbums([...(albums || []), {
          id: shown.id,
          name: shown.name,
          images: shown.images,
          artists: shown.artists,
          type: 'album',
          total_tracks: shown.total_tracks
        }]);
        toast(`Saved "${shown.name}" to your library`, { tone: 'success' });
      }
    } catch (err) {
      console.error('Failed to update saved album:', err);
      toast(isSaved ? "Couldn't remove it from your library" : "Couldn't save it to your library", { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return {
    token, currentAlbumId, setContextMenu, currentPlayingTrack, isCurrentTrackPaused, country,
    album, shown, tracks, loading, error, restError, retry, totalLength, discCount,
    handleTrackPlay, playAlbum, shuffleAlbum, openTrackMenu, isSaved, saving, handleToggleSave
  };
}
