import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { Mic2, AlertCircle, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- LRC TIME PARSER ---
const parseLrc = (lrcString) => {
  const lines = lrcString.split('\n');
  const synced = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  
  lines.forEach(line => {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const msRaw = match[3];
      const ms = msRaw.length === 2 ? parseInt(msRaw, 10) * 10 : parseInt(msRaw, 10);
      
      const timeMs = (min * 60000) + (sec * 1000) + ms;
      const text = line.replace(timeRegex, '').trim();
      
      synced.push({ timeMs, text });
    }
  });
  
  return synced;
};

// --- AESTHETIC INSTRUMENTAL WAVEFORM ---
const AudioWaveform = ({ isActive }) => (
  <motion.div 
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: isActive ? 1 : 0.3, scale: isActive ? 1 : 0.9 }}
    className="flex items-end justify-center space-x-2 h-12 my-2"
  >
    <motion.div animate={isActive ? { height: ["30%", "80%", "40%", "100%", "30%"] } : { height: ["15%", "25%", "15%"] }} transition={{ repeat: Infinity, duration: isActive ? 1.2 : 3.5, ease: "easeInOut" }} className="w-2 rounded-full bg-white/40" />
    <motion.div animate={isActive ? { height: ["50%", "100%", "30%", "90%", "50%"] } : { height: ["25%", "35%", "25%"] }} transition={{ repeat: Infinity, duration: isActive ? 1.5 : 4.0, ease: "easeInOut" }} className={`w-2 rounded-full transition-colors duration-700 ${isActive ? 'bg-[var(--brand-mid)] shadow-[0_0_15px_var(--brand-mid)]' : 'bg-white/30'}`} />
    <motion.div animate={isActive ? { height: ["70%", "40%", "100%", "50%", "70%"] } : { height: ["35%", "45%", "35%"] }} transition={{ repeat: Infinity, duration: isActive ? 1.0 : 3.2, ease: "easeInOut" }} className={`w-2 rounded-full transition-colors duration-700 ${isActive ? 'bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]' : 'bg-white/40'}`} />
    <motion.div animate={isActive ? { height: ["100%", "50%", "80%", "30%", "100%"] } : { height: ["20%", "30%", "20%"] }} transition={{ repeat: Infinity, duration: isActive ? 1.4 : 3.8, ease: "easeInOut" }} className={`w-2 rounded-full transition-colors duration-700 ${isActive ? 'bg-[var(--brand-mid)] shadow-[0_0_15px_var(--brand-mid)]' : 'bg-white/30'}`} />
    <motion.div animate={isActive ? { height: ["40%", "90%", "50%", "100%", "40%"] } : { height: ["15%", "20%", "15%"] }} transition={{ repeat: Infinity, duration: isActive ? 1.1 : 4.2, ease: "easeInOut" }} className="w-2 rounded-full bg-white/40" />
  </motion.div>
);

export default function LyricsView() {
  const { playbackState, player } = usePlayerStore();
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
      if (player) {
        const state = await player.getCurrentState();
        if (state) {
          currentPos = state.position;
          progressRef.current = currentPos;
        }
      }

      const checkLineIndex = (pos) => {
        const lyrics = syncedLyricsRef.current;
        if (!lyrics || lyrics.length === 0) return;
        const idx = lyrics.findLastIndex(l => l.timeMs <= pos + 300);
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
  }, [playbackState, player]);

  // --- 2. PUBLIC FREE API FETCHING (LrcLib) ---
  useEffect(() => {
    if (!currentTrack) return;

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

        if (!res.ok) throw new Error('Could not connect to the public lyrics database.');
        
        const data = await res.json();

        if (!data || data.length === 0) {
           throw new Error("We couldn't find lyrics for this specific track in the open database.");
        }

        const bestMatch = data[0];

        if (bestMatch.syncedLyrics) {
          setSyncedLyrics(parseLrc(bestMatch.syncedLyrics));
        } else if (bestMatch.plainLyrics) {
          setPlainLyrics(bestMatch.plainLyrics.split('\n'));
        } else {
          throw new Error("No lyrics data available for this match.");
        }

      } catch (err) {
        console.error("Lyrics Engine Error:", err);
        setError(err.message || "Failed to load lyrics.");
      } finally {
        setLoading(false);
      }
    };

    fetchLyrics();
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
  const handleSeek = (timeMs) => {
    if (player) {
      player.seek(timeMs).catch(console.error);
    }
  };

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
            <p className="text-sm text-[var(--brand-mid)] font-bold tracking-widest uppercase mt-1 drop-shadow-md">
              {currentTrack.artists.map(a => a.name).join(', ')}
            </p>
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