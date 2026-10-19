import { useEffect, useState } from 'react';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { spotifyFetch, playUris } from '../services/spotify/api';
import { startPlaying } from '../queue/play';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import Artists from './Artists';

// Your top songs and artists on the room's language, for the room's Home: the three windows as
// words, then two lists of rows on hairlines. The old page's StatsDrawer stays as it is for the
// old layout; the fetch is the same, written again here because that file keeps it private.

const RANGES = [
  { id: 'short_term', label: '4 weeks' },
  { id: 'medium_term', label: '6 months' },
  { id: 'long_term', label: 'All time' }
];

// Kept for the session, per account and range. Keyed by account rather than token: a token
// renews every hour and must not look like a different person.
const cache = new Map(); // `${userId}:${range}` -> { tracks, artists }

async function loadStats(token, range) {
  const headers = { Authorization: `Bearer ${token}` };
  const [tracksRes, artistsRes] = await Promise.all([
    spotifyFetch(`https://api.spotify.com/v1/me/top/tracks?time_range=${range}&limit=5`, { headers }),
    spotifyFetch(`https://api.spotify.com/v1/me/top/artists?time_range=${range}&limit=5`, { headers })
  ]);
  if (!tracksRes.ok || !artistsRes.ok) {
    const status = !tracksRes.ok ? tracksRes.status : artistsRes.status;
    const err = new Error(`Spotify answered ${status}`);
    err.status = status;
    throw err;
  }
  const tracks = await tracksRes.json();
  const artists = await artistsRes.json();
  return { tracks: tracks.items || [], artists: artists.items || [] };
}

const describeFailure = (err) => {
  if (err?.message === 'RATE_LIMITED' || err?.status === 429) return 'Spotify is rate-limiting requests right now.';
  if (err?.status === 403) return "Spotify won't share listening stats with this sign-in. Disconnect and sign in again.";
  if (err?.status) return `Couldn't load your stats (Spotify answered ${err.status}).`;
  return "Couldn't reach Spotify.";
};

const Mono = ({ children, className = '' }) => <p className={`room-mono ${className}`}>{children}</p>;
const Head = ({ children }) => <div className="mb-1 border-b border-[var(--room-hair)] pb-2"><Mono className="truncate text-[var(--room-faint)]">{children}</Mono></div>;

export default function RoomStats() {
  const { token, navigateToArtist, setContextMenu } = useSlice(useUserStore, ['token', 'navigateToArtist', 'setContextMenu']);
  const userId = useUserStore((s) => s.profile?.id || '');
  const [range, setRange] = useState('short_term');
  // Failures by range; successes go to the session cache. A retry bumps the attempt count,
  // which is what the effect watches, so an error on screen never triggers a refetch by itself.
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  const key = `${userId}:${range}`;
  const data = cache.get(key) || null;
  const error = errors[key] || '';

  useEffect(() => {
    if (!token || cache.has(key)) return undefined;
    let cancelled = false;
    // The token is read inside, not listed as a dependency: a renewal mid-fetch must not restart it
    loadStats(useUserStore.getState().token, range)
      .then((result) => {
        cache.set(key, result);
        if (!cancelled) setErrors((prev) => ({ ...prev, [key]: '' }));
      })
      .catch((err) => {
        console.error('Failed to fetch top stats', err);
        if (!cancelled) setErrors((prev) => ({ ...prev, [key]: describeFailure(err) }));
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(token), range, key, attempt]);

  const retry = () => {
    setErrors((prev) => ({ ...prev, [key]: '' }));
    setAttempt((n) => n + 1);
  };
  const loading = !data && !error;
  const tracks = data?.tracks || [];
  const artists = data?.artists || [];
  const rangeLabel = RANGES.find((r) => r.id === range)?.label;

  // A top song plays, followed by the rest of the list
  const playTrack = (index) => {
    const uris = tracks.map((t) => t.uri).filter(Boolean);
    if (!token || !uris.length) return;
    startPlaying({ kind: 'list', name: `Your top songs${rangeLabel ? `, ${rangeLabel.toLowerCase()}` : ''}`, tracks, start: index, track: tracks[index] }, (deviceId) => playUris(token, deviceId, uris, index));
  };
  const openTrackMenu = (e, track) => {
    e.preventDefault();
    setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track });
  };

  const rowClass = 'group grid cursor-pointer grid-cols-[22px_34px_minmax(0,1fr)] items-center gap-3 py-[9px] text-[13px] transition-colors hover:bg-white/[0.03]';
  const rowStyle = (n) => ({ borderTop: n ? '1px solid var(--room-hair)' : undefined, transitionDuration: 'var(--room-mid)' });

  return (
    <section className="mt-8" style={{ animation: 'room-fade-in var(--room-mid) var(--room-ease) both' }}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--room-hair)] pb-2">
        <Mono className="text-[var(--room-faint)]">Your top music</Mono>
        <span className="flex items-center gap-4" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" onClick={() => setRange(r.id)} aria-pressed={range === r.id} className="ui-word">{r.label}</button>
          ))}
        </span>
      </div>

      {error ? (
        <div className="py-4">
          <p className="text-[13px] text-[var(--room-dim)]">{error}</p>
          <p className="mt-3"><button type="button" onClick={retry} className="ui-word">Try again</button></p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-10 gap-y-8 @max-md:grid-cols-1">
          <div className="min-w-0">
            <Head>Top songs · {rangeLabel}</Head>
            {loading ? <Mono className="py-4 text-[var(--room-faint)]">Loading</Mono> : tracks.length === 0 ? (
              <p className="py-4 text-[13px] text-[var(--room-faint)]">Nothing yet. Spotify needs a little listening before it ranks anything.</p>
            ) : tracks.map((track, n) => (
              <div key={track.id} onClick={() => playTrack(n)} {...rowButtonProps(() => playTrack(n))} onContextMenu={(e) => openTrackMenu(e, track)} className={rowClass} style={rowStyle(n)}>
                <Mono className="text-center text-[var(--room-faint)]">{n + 1}</Mono>
                <span className="h-[34px] w-[34px] overflow-hidden rounded-[3px] bg-white/5">{track.album?.images?.length > 0 && <img src={artUrl(track.album.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--room-paper)]/90">{track.name}</span>
                  <Artists artists={track.artists} inRow className="block truncate text-[11.5px] text-[var(--room-dim)]" />
                </span>
              </div>
            ))}
          </div>

          <div className="min-w-0">
            <Head>Top artists · {rangeLabel}</Head>
            {loading ? <Mono className="py-4 text-[var(--room-faint)]">Loading</Mono> : artists.length === 0 ? (
              <p className="py-4 text-[13px] text-[var(--room-faint)]">Nothing yet.</p>
            ) : artists.map((artist, n) => (
              <div key={artist.id} onClick={() => navigateToArtist(artist.id)} {...rowButtonProps(() => navigateToArtist(artist.id))} className={rowClass} style={rowStyle(n)}>
                <Mono className="text-center text-[var(--room-faint)]">{n + 1}</Mono>
                <span className="h-[34px] w-[34px] overflow-hidden rounded-full bg-white/5">{artist.images?.length > 0 && <img src={artUrl(artist.images, 34)} alt="" width="34" height="34" loading="lazy" decoding="async" draggable="false" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--room-paper)]/90">{artist.name}</span>
                  {/* Spotify no longer sends genres to apps like Jomify; shown only if present */}
                  <span className="block truncate text-[11.5px] text-[var(--room-dim)]">{artist.genres?.slice(0, 2).join(', ') || 'Artist'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
