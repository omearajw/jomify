import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useUserStore } from '../../store/userStore';
import { Mic2, Sparkles, X, Maximize2, Minimize2 } from 'lucide-react';
import { motion } from 'framer-motion';
import TrackArtists from '../../components/TrackArtists';
import { findLyrics } from '../../lib/lrc';
import CinematicLyrics from '../../components/lyrics/CinematicLyrics';
import AmbientWave from '../../components/lyrics/AmbientWave';
import { seek } from '../../services/spotify/playbackController';
import { useSlice } from '../../store/selectors';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';

export default function LyricsView() {
  const { playbackState } = useSlice(usePlayerStore, ['playbackState']);
  const goBack = useUserStore((s) => s.goBack);
  const currentTrack = playbackState?.track_window?.current_track;

  // Full screen on this page alone, without Zen mode; Escape leaves full screen as usual
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current && Boolean(containerRef.current));
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  // The page fits the visible area, so its lyrics scroll inside it and the header stays: sized by
  // its content instead, the whole page scrolled to centre a line and took the header with it
  const [fitHeight, setFitHeight] = useState(null);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    let box = root.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return undefined;
    const measure = () => {
      const top = root.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      setFitHeight(Math.max(320, Math.floor(box.clientHeight - top - 16)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else containerRef.current?.requestFullscreen?.().catch(() => {});
  };
  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    goBack();
  };

  const [plainLyrics, setPlainLyrics] = useState([]);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  

  const albumArt = currentTrack?.album?.images?.[0]?.url || '';

  // The same pre-blurred wash as Zen mode: a 120px CSS blur over the whole page is the most
  // expensive thing to paint here, and WebKit sometimes painted it black
  const [backdrop, setBackdrop] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (albumArt) getBlurredBackdrop(albumArt).then((url) => { if (!cancelled) setBackdrop({ art: albumArt, url }); });
    return () => { cancelled = true; };
  }, [albumArt]);
  const backdropFor = backdrop?.art === albumArt ? backdrop : null;

  // --- 2. PUBLIC FREE API FETCHING (LrcLib) ---
  // Cancellation matters here: skip tracks quickly and a slow response for track A used to
  // land after track B's and paint B with A's lyrics. Every state write is guarded.
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    const stop = new AbortController();
    // Used to pick the right VERSION -- the first search hit is often a live cut or a remix
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;

    const fetchLyrics = async () => {
      setLoading(true);
      setError('');
      setPlainLyrics([]);
      setSyncedLyrics(null);

      try {
        const found = await findLyrics(currentTrack, trackDurationSec, { signal: stop.signal });
        if (cancelled) return;
        if (found.synced) setSyncedLyrics(found.synced);
        else setPlainLyrics(found.plain);
      } catch (err) {
        if (cancelled) return;
        console.error("Lyrics Engine Error:", err);
        setError(err.message || "Failed to load lyrics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLyrics();
    return () => { cancelled = true; stop.abort(); };
  // Deliberately keyed on the track id, not the track object or playbackState.duration: those
  // change on every position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // --- 4. CLICK TO SEEK ---
  const handleSeek = (timeMs) => { seek(timeMs); };

  if (!currentTrack) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center animate-fade-in text-neutral-500 h-full">
        <Mic2 className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-2xl font-bold">No track playing</h2>
      </div>
    );
  }

  // --- SYNCED LYRICS: glass, centred on the line being sung (shared with Zen mode) ---
  // Starts below the title row: the header floats over this page, and lines scrolled up under it
  // sat beside the song's name
  const renderSyncedEngine = () => (
    <div className="relative z-10 flex-1 min-h-0 flex flex-col pt-24">
      <CinematicLyrics key={currentTrack.id} lines={syncedLyrics} onSeek={handleSeek} variant="page" wash={backdropFor?.url} />
    </div>
  );

  // --- PLAIN TEXT EDITORIAL RENDERER ---
  const renderEditorialLayout = () => {
    return (
      <div 
        style={{ 
          maskImage: 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)'
        }}
        className="relative z-10 flex-1 overflow-y-auto custom-scrollbar px-10 pt-28 pb-32 scroll-smooth w-full"
      >
        {loading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="columns-1 md:columns-2 lg:columns-3 gap-12 space-y-8">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-4 bg-white/10 rounded-full animate-pulse" style={{ width: `${Math.random() * 60 + 20}%` }} />
            ))}
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.7, staggerChildren: 0.05 }}
            className="columns-1 md:columns-2 lg:columns-3 gap-12 text-left"
          >
            {/* Every line the same weight: a highlight on every seventh used to read as a chorus marker */}
            {plainLyrics.map((line, i) => (
              <p
                key={i}
                className="break-inside-avoid mb-6 text-xl font-semibold text-neutral-200 leading-relaxed transition-colors hover:text-white"
              >
                {line || '♪'}
              </p>
            ))}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} style={fitHeight ? { height: fitHeight } : undefined} className="relative flex-1 h-full w-full rounded-3xl overflow-hidden bg-black flex flex-col animate-fade-in shadow-2xl">
      
      {/* Immersive Blur Background */}
      {albumArt && backdropFor?.url && (
        <div
          className="absolute -inset-[15%] z-0 opacity-80 pointer-events-none bg-cover bg-center"
          style={{ backgroundImage: `url(${backdropFor.url})` }}
        />
      )}
      {albumArt && backdropFor && !backdropFor.url && (
        <div
          className="absolute inset-0 z-0 opacity-40 pointer-events-none bg-cover bg-center blur-[120px] saturate-[2] scale-110"
          style={{ backgroundImage: `url(${albumArt})` }}
        />
      )}
      {/* An even dimming, not a band: a gradient darkening the lower half made the same lines
          look dim before the first lyric and after the last, and bright in between */}
      <div className="absolute inset-0 bg-black/45 z-0 pointer-events-none" />

      {/* Header Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 px-10 pt-8 pb-12 bg-gradient-to-b from-black/80 to-transparent shrink-0 flex items-center justify-between pointer-events-none">
        <div className="flex items-center space-x-6">
          <div className="w-16 h-16 rounded-xl overflow-hidden shadow-2xl shrink-0 border border-white/10">
             {albumArt ? <img src={albumArt} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-neutral-800" />}
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tighter drop-shadow-lg truncate max-w-xl">
              {currentTrack.name}
            </h1>
            {/* The header container is pointer-events-none so it doesn't block the lyrics; re-enable just the names */}
            <TrackArtists
              artists={currentTrack.artists}
              className="block text-sm text-[var(--brand-mid)] font-bold tracking-widest uppercase mt-1 drop-shadow-md pointer-events-auto"
              linkClassName="hover:underline hover:text-white transition-colors"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2 pointer-events-auto">
          {syncedLyrics && (
            <div className="hidden sm:flex items-center px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md shadow-xl">
               <Sparkles className="w-4 h-4 text-[var(--brand-mid)] mr-2" />
               <span className="text-xs font-bold text-white uppercase tracking-widest">Line Sync Active</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            className="hidden md:flex w-10 h-10 rounded-full bg-white/5 border border-white/10 backdrop-blur-md items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close lyrics"
            title="Close lyrics"
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* RENDER ENGINE DUALITY */}
      {syncedLyrics ? renderSyncedEngine() : !loading && (error || plainLyrics.length === 0) ? (
        // Its own full-height area below the header, so the wave sits in the middle of the card
        <div className="relative z-10 flex-1 min-h-0 flex flex-col pt-24 pb-8">
          <AmbientWave variant="page" />
        </div>
      ) : renderEditorialLayout()}

    </div>
  );
}