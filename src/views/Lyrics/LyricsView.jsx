import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { Mic2, AlertCircle, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import TrackArtists from '../../components/TrackArtists';
import AudioWaveform from '../../components/AudioWaveform';
import { parseLrc, pickClosestByDuration, LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import { seek } from '../../services/spotify/playbackController';

export default function LyricsView() {
  const { playbackState, player, isLocalActive, positionAt } = usePlayerStore();
  const currentTrack = playbackState?.track_window?.current_track;

  const [plainLyrics, setPlainLyrics] = useState([]);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [activeIndex, setActiveIndex] = useState(-1);

  const lineRefs = useRef([]);
  const progressRef = useRef(0);
  const syncedLyricsRef = useRef(null);

  const albumArt = currentTrack?.album?.images?.[0]?.url || '';

  // Keep ref in sync for RAF loop access
  useEffect(() => {
    syncedLyricsRef.current = syncedLyrics;
  }, [syncedLyrics]);

  // --- 1. HIGH-PERFORMANCE CLOCK & LINE-MATCH ENGINE ---
  useEffect(() => {
    let animationFrameId;
    let lastTime = performance.now();
    let currentPos = playbackState?.position || 0;
    
    progressRef.current = currentPos;

    const startClock = async () => {
      if (isLocalActive && player) {
        const state = await player.getCurrentState();
        if (state) {
          currentPos = state.position;
          progressRef.current = currentPos;
        }
      } else if (playbackState && !playbackState.paused) {
        // Remote playback: the last poll is a little old by now, so advance it to the present
        currentPos = playbackState.position + (Date.now() - positionAt);
        progressRef.current = currentPos;
      }

      const checkLineIndex = (pos) => {
        const lyrics = syncedLyricsRef.current;
        if (!lyrics || lyrics.length === 0) return;
        const idx = lyrics.findLastIndex(l => l.timeMs <= pos + LYRIC_LEAD_IN_MS);
        setActiveIndex(prev => (prev !== idx ? idx : prev));
      };

      if (playbackState && !playbackState.paused) {
        const loop = (now) => {
          const delta = now - lastTime;
          lastTime = now;
          currentPos += delta;
          progressRef.current = currentPos;
          
          checkLineIndex(currentPos);
          animationFrameId = requestAnimationFrame(loop);
        };
        animationFrameId = requestAnimationFrame(loop);
      } else {
        progressRef.current = playbackState?.position || 0;
        checkLineIndex(progressRef.current);
      }
    };

    startClock();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  // positionAt changes with every playbackState, so listing it adds nothing but keeps the
  // dependency list honest for the remote branch above
  }, [playbackState, player, isLocalActive, positionAt]);

  // --- 2. PUBLIC FREE API FETCHING (LrcLib) ---
  // Cancellation matters here: skip tracks quickly and a slow response for track A used to
  // land after track B's and paint B with A's lyrics. Every state write is guarded.
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    // Used to pick the right VERSION -- the first search hit is often a live cut or a remix
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;

    const fetchLyrics = async () => {
      setLoading(true);
      setError('');
      setPlainLyrics([]);
      setSyncedLyrics(null);
      setActiveIndex(-1);

      try {
        const artist = currentTrack.artists[0].name;
        const title = currentTrack.name.split(/[-()]/)[0].trim();
        const query = encodeURIComponent(`${artist} ${title}`);

        const res = await fetch(`https://lrclib.net/api/search?q=${query}`);
        if (cancelled) return;

        if (!res.ok) throw new Error('Could not connect to the public lyrics database.');

        const data = await res.json();
        if (cancelled) return;

        if (!data || data.length === 0) {
           throw new Error("We couldn't find lyrics for this specific track in the open database.");
        }

        const bestMatch = pickClosestByDuration(data, trackDurationSec);

        if (bestMatch.syncedLyrics) {
          setSyncedLyrics(parseLrc(bestMatch.syncedLyrics));
        } else if (bestMatch.plainLyrics) {
          setPlainLyrics(bestMatch.plainLyrics.split('\n'));
        } else {
          throw new Error("No lyrics data available for this match.");
        }

      } catch (err) {
        if (cancelled) return;
        console.error("Lyrics Engine Error:", err);
        setError(err.message || "Failed to load lyrics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLyrics();
    return () => { cancelled = true; };
  // Deliberately keyed on the track id, not the track object or playbackState.duration: those
  // change on every position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // --- 3. AUTO-SCROLL ON LINE CHANGE ---
  useEffect(() => {
    const targetLine = lineRefs.current[activeIndex];
    if (activeIndex >= 0 && targetLine) {
      targetLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [activeIndex]);

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

  // --- SYNCED ENGINE RENDERER (LINE-BY-LINE) ---
  const renderSyncedEngine = () => {
    return (
      <div 
        style={{ 
          maskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)'
        }}
        className="relative z-10 flex-1 overflow-y-auto custom-scrollbar px-6 md:px-20 w-full flex flex-col items-center"
      >
        <div className="max-w-5xl w-full text-center space-y-4 md:space-y-6 pt-[45vh] pb-[45vh]">
          {syncedLyrics.map((line, i) => {
            const isActive = i === activeIndex;
            const isPast = i < activeIndex;
            
            // Check if the line is an instrumental break
            const isInstrumental = !line.text || line.text.trim() === '♪' || line.text.toLowerCase().includes('instrumental');

            return (
              <div 
                key={i} 
                ref={el => lineRefs.current[i] = el} 
                onClick={() => handleSeek(line.timeMs)}
                className="flex flex-col items-center justify-center min-h-[4rem] cursor-pointer group px-4 py-2"
              >
                {isInstrumental ? (
                  <AudioWaveform isActive={isActive} />
                ) : (
                  <motion.p
                    initial={false}
                    animate={{
                      opacity: isActive ? 1 : (isPast ? 0.3 : 0.4),
                      scale: isActive ? 1.05 : 0.95,
                      filter: isActive ? "blur(0px)" : (isPast ? "blur(1px)" : "blur(2px)"),
                    }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className={`text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-normal pb-2 transition-colors duration-300 origin-center group-hover:scale-105 group-hover:opacity-100 group-hover:blur-none ${
                      isActive 
                        ? 'text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.7)]' 
                        : 'text-neutral-400'
                    }`}
                  >
                    {line.text}
                  </motion.p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // --- PLAIN TEXT EDITORIAL RENDERER ---
  const renderEditorialLayout = () => {
    return (
      <div 
        style={{ 
          maskImage: 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)'
        }}
        className="relative z-10 flex-1 overflow-y-auto custom-scrollbar px-10 pt-12 pb-32 scroll-smooth w-full"
      >
        {loading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="columns-1 md:columns-2 lg:columns-3 gap-12 space-y-8">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-4 bg-white/10 rounded-full animate-pulse" style={{ width: `${Math.random() * 60 + 20}%` }} />
            ))}
          </motion.div>
        ) : error ? (
          <div className="flex items-center justify-center h-full pb-32">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center text-neutral-400 bg-black/40 p-12 rounded-3xl border border-white/5 backdrop-blur-md">
              <AlertCircle className="w-12 h-12 mb-4 text-[#f91362] opacity-80" />
              <p className="font-bold text-xl text-white mb-2">Lyrics Unavailable</p>
              <p className="max-w-md">{error}</p>
            </motion.div>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.7, staggerChildren: 0.05 }}
            className="columns-1 md:columns-2 lg:columns-3 gap-12 text-left"
          >
            {plainLyrics.map((line, i) => {
              const isHighlight = i % 7 === 0;
              return (
                <p 
                  key={i} 
                  className={`break-inside-avoid mb-6 transition-all duration-500 hover:text-white ${isHighlight ? 'text-3xl font-extrabold text-white tracking-tighter border-l-4 border-[var(--brand-mid)] pl-4 py-1 drop-shadow-md' : 'text-xl font-medium text-neutral-400 hover:scale-[1.02] origin-left'}`}
                >
                  {line || '♪'}
                </p>
              );
            })}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex-1 h-full w-full rounded-3xl overflow-hidden bg-black flex flex-col animate-fade-in shadow-2xl">
      
      {/* Immersive Blur Background */}
      {albumArt && (
        <div 
          className="absolute inset-0 z-0 opacity-40 pointer-events-none bg-cover bg-center blur-[120px] saturate-[2] scale-110" 
          style={{ backgroundImage: `url(${albumArt})` }} 
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent z-0 pointer-events-none" />

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
        
        {syncedLyrics && (
          <div className="hidden sm:flex items-center px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md shadow-xl">
             <Sparkles className="w-4 h-4 text-[var(--brand-mid)] mr-2" />
             <span className="text-xs font-bold text-white uppercase tracking-widest">Line Sync Active</span>
          </div>
        )}
      </div>

      {/* RENDER ENGINE DUALITY */}
      {syncedLyrics ? renderSyncedEngine() : renderEditorialLayout()}

    </div>
  );
}