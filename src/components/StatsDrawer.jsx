import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUserStore } from '../store/userStore';
import { useSlice } from '../store/selectors';
import { spotifyFetch, playUris } from '../services/spotify/api';
import { playOn } from '../services/spotify/playbackController';
import { artUrl } from '../utils/images';
import { rowButtonProps } from '../utils/a11y';
import MoreButton from './MoreButton';
import { Skeleton } from './Skeleton';

// Spotify's three windows for top tracks and artists
const RANGES = [
  { id: 'short_term', label: '4 weeks' },
  { id: 'medium_term', label: '6 months' },
  { id: 'long_term', label: 'All time' }
];

// Kept for the session, per account and range, so reopening the drawer or switching back is
// instant. Keyed by account rather than token: a token renews every hour and must not look
// like a different person.
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

function RowSkeletons() {
  return (
    <div className="space-y-4" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center space-x-4">
          <Skeleton className="w-6 h-6" />
          <Skeleton className="w-12 h-12 rounded-md" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
        </div>
      ))}
    </div>
  );
}

export default function StatsDrawer({ open }) {
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
    if (!open || !token || cache.has(key)) return undefined;
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
  }, [open, Boolean(token), range, key, attempt]);

  const retry = () => {
    setErrors((prev) => ({ ...prev, [key]: '' }));
    setAttempt((n) => n + 1);
  };
  const loading = open && !data && !error;
  const tracks = data?.tracks || [];
  const artists = data?.artists || [];
  const rangeLabel = RANGES.find((r) => r.id === range)?.label;

  // A top track plays, followed by the rest of the list
  const playTrack = (index) => {
    const uris = tracks.map((t) => t.uri).filter(Boolean);
    if (!token || !uris.length) return;
    playOn((deviceId) => playUris(token, deviceId, uris, index), { track: tracks[index] });
  };
  const openTrackMenu = (e, track) => {
    e.preventDefault();
    setContextMenu({ type: 'track', x: e.pageX, y: e.pageY, track });
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
          className="w-full overflow-hidden"
        >
          <div className="pb-12 pt-2">
            <div className="p-6 md:p-8 rounded-3xl bg-neutral-900/60 backdrop-blur-xl border border-white/10 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">Your top music</p>
                <div role="radiogroup" aria-label="Time range" className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={range === r.id}
                      onClick={() => setRange(r.id)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${range === r.id ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <p className="text-red-400 text-sm font-medium flex flex-wrap items-center gap-3">
                  {error}
                  <button type="button" onClick={retry} className="text-white underline underline-offset-2 hover:text-neutral-200">
                    Try again
                  </button>
                </p>
              ) : (
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-white mb-6 flex items-center border-b border-white/10 pb-4">
                      Top Tracks <span className="text-xs text-neutral-400 ml-3 font-medium uppercase tracking-wider">{rangeLabel}</span>
                    </h3>
                    {loading ? <RowSkeletons /> : tracks.length === 0 ? (
                      <p className="text-neutral-500 text-sm">Nothing yet. Spotify needs a little listening before it ranks anything.</p>
                    ) : (
                      <div className="space-y-2">
                        {tracks.map((track, idx) => (
                          <div
                            key={track.id}
                            onClick={() => playTrack(idx)}
                            {...rowButtonProps(() => playTrack(idx))}
                            onContextMenu={(e) => openTrackMenu(e, track)}
                            className="flex items-center space-x-4 group cursor-pointer rounded-xl px-2 py-1.5 -mx-2 hover:bg-white/5 transition-colors"
                          >
                            <span className="text-xl font-extrabold text-neutral-700 w-6 group-hover:text-brand-gradient transition-colors">{idx + 1}</span>
                            <img src={artUrl(track.album?.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-12 h-12 rounded-md shadow-md group-hover:scale-105 transition-transform" />
                            <div className="truncate flex-1">
                              <p className="text-white font-bold text-sm truncate">{track.name}</p>
                              <p className="text-neutral-400 text-xs truncate">{track.artists?.map((a) => a.name).join(', ')}</p>
                            </div>
                            <MoreButton onOpen={(e) => openTrackMenu(e, track)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-white mb-6 flex items-center border-b border-white/10 pb-4">
                      Top Artists <span className="text-xs text-neutral-400 ml-3 font-medium uppercase tracking-wider">{rangeLabel}</span>
                    </h3>
                    {loading ? <RowSkeletons /> : artists.length === 0 ? (
                      <p className="text-neutral-500 text-sm">Nothing yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {artists.map((artist, idx) => (
                          <div
                            key={artist.id}
                            onClick={() => navigateToArtist(artist.id)}
                            {...rowButtonProps(() => navigateToArtist(artist.id))}
                            className="flex items-center space-x-4 group cursor-pointer rounded-xl px-2 py-1.5 -mx-2 hover:bg-white/5 transition-colors"
                          >
                            <span className="text-xl font-extrabold text-neutral-700 w-6 group-hover:text-brand-gradient transition-colors">{idx + 1}</span>
                            {artist.images?.[0]?.url ? (
                              <img src={artUrl(artist.images, 48)} alt="" width="48" height="48" loading="lazy" decoding="async" className="w-12 h-12 rounded-full shadow-md group-hover:scale-105 transition-transform object-cover" />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-neutral-800 shadow-md" />
                            )}
                            <div className="truncate flex-1">
                              <p className="text-white font-bold text-sm truncate">{artist.name}</p>
                              {/* Spotify no longer sends genres to apps like Jomify; shown only if present */}
                              <p className="text-neutral-400 text-xs capitalize truncate">{artist.genres?.slice(0, 2).join(', ') || 'Artist'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
