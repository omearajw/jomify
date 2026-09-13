import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Mic2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AudioWaveform from '../../components/AudioWaveform';
import { parseLrc, pickClosestByDuration, LYRIC_LEAD_IN_MS } from '../../lib/lrc';
import { useSlice } from '../../store/selectors';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';
import { togglePlay, next as nextTrack, previous as previousTrack, seek } from '../../services/spotify/playbackController';

// Lines this far from the active one get the animated depth-of-field treatment; the rest are
// plain elements with a static style, so a 200-line song doesn't run 200 spring animations
const ANIMATED_LINE_RADIUS = 10;

export default function ZenMode() {
  const { isZenMode, toggleZenMode, savedVolume, setSavedVolume } = useSlice(useUserStore, ['isZenMode', 'toggleZenMode', 'savedVolume', 'setSavedVolume']);
  const { player, playbackState } = useSlice(usePlayerStore, ['player', 'playbackState']);

  const [prevVolume, setPrevVolume] = useState(50);
  const [isActive, setIsActive] = useState(true);
  // The blurred wash is mounted only once the fullscreen transition has settled, so the
  // viewport reflow and the first backdrop paint don't share the same frames
  const [backdropReady, setBackdropReady] = useState(false);
  // { art, url } so a stale blur for the previous track is never shown: derived below by art url
  const [backdrop, setBackdrop] = useState(null);

  // --- LYRICS STATE ---
  const [showLyrics, setShowLyrics] = useState(false);
  const [plainLyrics, setPlainLyrics] = useState([]);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const lineRefs = useRef([]);
  const progressRef = useRef(0);
  const syncedLyricsRef = useRef(null);
  const scrollRef = useRef(null);

  const currentTrack = playbackState?.track_window?.current_track;
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';

  useEffect(() => {
    syncedLyricsRef.current = syncedLyrics;
  }, [syncedLyrics]);

  // Handle auto-hide UI
  useEffect(() => {
    let timeout;
    const resetTimer = () => {
      setIsActive(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsActive(false), 3000);
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('mousedown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    resetTimer(); 

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (isZenMode) document.documentElement.requestFullscreen().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [isZenMode]);

  // The component only exists while ZenMode is open, so this runs once per opening
  useEffect(() => {
    let done = false;
    const ready = () => { if (!done) { done = true; setBackdropReady(true); } };
    document.addEventListener('fullscreenchange', ready, { once: true });
    const timer = setTimeout(ready, 350); // fullscreen refused or already active
    return () => { document.removeEventListener('fullscreenchange', ready); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (albumArtUrl) getBlurredBackdrop(albumArtUrl).then((url) => { if (!cancelled) setBackdrop({ art: albumArtUrl, url }); });
    return () => { cancelled = true; };
  }, [albumArtUrl]);
  const backdropUrl = backdrop?.art === albumArtUrl ? backdrop.url : null;

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isZenMode) toggleZenMode();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isZenMode, toggleZenMode]);

  // Volume Logic
  useEffect(() => {
    if (player && isZenMode) {
      const exponentialVolume = Math.pow(savedVolume / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
  }, [player, isZenMode, savedVolume]);

  const handleVolumeChange = (e) => {
    const uiValue = parseInt(e.target.value, 10);
    setSavedVolume(uiValue); 

    if (uiValue > 0) setPrevVolume(uiValue);

    if (player) {
      const exponentialVolume = Math.pow(uiValue / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
  };

  const toggleMute = () => {
    if (!player) return;
    
    if (savedVolume > 0) {
      setPrevVolume(savedVolume);
      setSavedVolume(0);
      player.setVolume(0).catch(console.error);
    } else {
      const restoredVolume = prevVolume > 0 ? prevVolume : 50;
      setSavedVolume(restoredVolume);
      const exponentialVolume = Math.pow(restoredVolume / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
  };

  // --- LYRICS CLOCK ENGINE ---
  // Recalibrates from the live player position whenever the track changes,
  // playback state updates, or new synced lyrics finish loading — so the
  // highlighted line snaps to the right spot immediately instead of
  // continuing to run off the previous song's accumulated clock. A
  // `cancelled` guard stops a slow-resolving getCurrentState() from a
  // fast track skip landing after the fact and flashing the wrong line.
  useEffect(() => {
    if (!showLyrics) return;

    let animationFrameId;
    let cancelled = false;
    let lastTime = performance.now();
    let currentPos = playbackState?.position || 0;

    progressRef.current = currentPos;

    const checkLineIndex = (pos) => {
      const lyrics = syncedLyricsRef.current;
      if (!lyrics || lyrics.length === 0) return;
      // Same lead-in as LyricsView, so both views highlight the same line at the same moment
      const idx = lyrics.findLastIndex(l => l.timeMs <= pos + LYRIC_LEAD_IN_MS);
      setActiveIndex(prev => (prev !== idx ? idx : prev));
    };

    const startClock = async () => {
      const live = usePlayerStore.getState();
      if (live.isLocalActive && player) {
        const state = await player.getCurrentState();
        if (!cancelled && state) {
          currentPos = state.position;
          progressRef.current = currentPos;
          lastTime = performance.now();
        }
      } else if (live.playbackState && !live.playbackState.paused) {
        // Remote playback: advance the last poll to now instead of asking a player that isn't playing
        currentPos = live.playbackState.position + (Date.now() - live.positionAt);
        progressRef.current = currentPos;
      }

      if (cancelled) return;

      // Snap to the correct line right away instead of waiting for the
      // first animation frame (or the next natural playbackState tick).
      checkLineIndex(currentPos);

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
      }
    };

    startClock();

    return () => {
      cancelled = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [playbackState, player, showLyrics, trackId, syncedLyrics]);

  // --- RESET SCROLL & LINE REFS ON TRACK CHANGE ---
  // Without this, switching songs while the panel is open leaves the
  // lyrics view scrolled to wherever the previous song's line was, and
  // stale DOM refs from the old lyric list can linger until re-render.
  useEffect(() => {
    lineRefs.current = [];
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [trackId]);

  // --- UNIFIED BULLETPROOF LYRICS ENGINE ---
  useEffect(() => {
    // Nothing to clear here: fetchLyrics resets every lyric state on its next run, and the
    // panel is hidden while showLyrics is false, so stale state is never visible
    if (!showLyrics || !currentTrack) return;

    let isMounted = true;
    // Used to pick the right VERSION from lrclib -- the first hit is often a live cut or a remix
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;

    const fetchLyrics = async () => {
      setSyncedLyrics(null);
      setPlainLyrics([]);
      setActiveIndex(-1);
      setLyricsError('');
      setLyricsLoading(true);

      try {
        const artist = currentTrack.artists[0].name;
        const rawTitle = currentTrack.name.split(/[-()]/)[0].trim();
        const title = rawTitle.replace(/feat\..*/i, '').trim();
        const query = encodeURIComponent(`${artist} ${title}`);
        
        let foundLyrics = false;

        // ATTEMPT 1: LrcLib (Synced Database)
        try {
          const lrcRes = await fetch(`https://lrclib.net/api/search?q=${query}`);
          if (lrcRes.ok) {
            const data = await lrcRes.json();
            if (isMounted && data && data.length > 0) {
              const bestMatch = pickClosestByDuration(data, trackDurationSec);
              if (bestMatch.syncedLyrics) {
                setSyncedLyrics(parseLrc(bestMatch.syncedLyrics));
                foundLyrics = true;
              } else if (bestMatch.plainLyrics) {
                setPlainLyrics(bestMatch.plainLyrics.split('\n'));
                foundLyrics = true;
              }
            }
          }
        } catch (err) {
          console.warn("LrcLib fetch blocked or failed. Cascading to fallback...", err);
        }

        // ATTEMPT 2: Lyrics.ovh (Fallback Database)
        if (!foundLyrics) {
          try {
            const ovhRes = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
            if (ovhRes.ok) {
              const data = await ovhRes.json();
              if (data && data.lyrics && isMounted) {
                const cleanLyrics = data.lyrics.replace(/Paroles de la chanson .+\r?\n/i, '');
                setPlainLyrics(cleanLyrics.split('\n'));
                foundLyrics = true;
              }
            }
          } catch (err) {
             console.warn("Lyrics.ovh fetch failed.", err);
          }
        }

        if (!foundLyrics && isMounted) {
           throw new Error("We couldn't find lyrics for this specific track in any open database.");
        }

      } catch (err) {
        console.error("Lyrics Engine Error:", err);
        if (isMounted) setLyricsError(err.message || "Failed to load lyrics.");
      } finally {
        if (isMounted) setLyricsLoading(false);
      }
    };

    fetchLyrics();

    return () => { isMounted = false; };
  // Deliberately keyed on the track id, not the track object or playbackState.duration: those
  // change on every position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, showLyrics]);

  // --- AUTO-SCROLL ON LINE CHANGE ---
  useEffect(() => {
    if (showLyrics && activeIndex >= 0 && lineRefs.current[activeIndex] && scrollRef.current) {
      const container = scrollRef.current;
      const targetLine = lineRefs.current[activeIndex];
      const scrollPos = targetLine.offsetTop - (container.clientHeight / 2) + (targetLine.clientHeight / 2);
      
      container.scrollTo({
        top: scrollPos,
        behavior: 'smooth'
      });
    }
  }, [activeIndex, showLyrics]);

  const handleSeek = (timeMs) => { seek(timeMs); };

  // --- HYPER-CINEMATIC ZEN RENDERERS ---
  const renderSyncedEngine = () => {
    return (
      <div 
        ref={scrollRef}
        style={{ 
          maskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)'
        }}
        className="relative z-10 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] px-4 scroll-smooth w-full flex flex-col items-center"
      >
        <div className="max-w-4xl w-full text-center space-y-6 md:space-y-8 pt-[38vh] pb-[38vh]">
          {syncedLyrics.map((line, i) => {
            const isLineActive = i === activeIndex;
            const isPast = i < activeIndex;
            const isInstrumental = !line.text || line.text.trim() === '♪' || line.text.toLowerCase().includes('instrumental');

            return (
              <div 
                key={i} 
                ref={el => lineRefs.current[i] = el} 
                onClick={() => handleSeek(line.timeMs)}
                className="relative flex flex-col items-center justify-center min-h-[4.5rem] cursor-pointer group px-4 py-2"
              >
                {/* Hyper-Intense Cinematic Spotlight Glow Behind Active Line */}
                {isLineActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--brand-mid)]/40 to-transparent opacity-75 blur-3xl pointer-events-none -z-10 animate-pulse" />
                )}

                {isInstrumental ? (
                  <AudioWaveform size="lg" isActive={isLineActive} />
                ) : (() => {
                  // Depth-of-field: lines further from the active one rack
                  // out of focus, like a camera pulling focus between them.
                  const distance = Math.abs(i - activeIndex);
                  const depthBlur = isLineActive ? 0 : Math.min(1.5 + distance * 0.9, 6);
                  const depthOpacity = isLineActive
                    ? 1
                    : Math.max((isPast ? 0.15 : 0.3) - distance * 0.04, isPast ? 0.08 : 0.12);
                  const lineClass = `text-2xl md:text-4xl lg:text-5xl font-black tracking-tighter leading-relaxed pb-1 transition-colors duration-200 origin-center group-hover:scale-105 group-hover:opacity-100 group-hover:blur-none ${
                    isLineActive
                      ? 'text-white drop-shadow-[0_0_20px_rgba(255,255,255,1)] drop-shadow-[0_0_40px_rgba(255,255,255,0.8)] drop-shadow-[0_0_80px_rgba(249,19,98,0.6)]'
                      : 'text-neutral-400'
                  }`;

                  // Far-off lines are static; only the neighbourhood of the active line animates
                  if (activeIndex >= 0 && distance > ANIMATED_LINE_RADIUS) {
                    return (
                      <p className={lineClass} style={{ opacity: depthOpacity, transform: 'scale(0.92)', filter: `blur(${depthBlur}px)` }}>
                        {line.text}
                      </p>
                    );
                  }

                  return (
                    <motion.p
                      initial={false}
                      animate={{
                        opacity: depthOpacity,
                        scale: isLineActive ? 1.08 : 0.92,
                        filter: `blur(${depthBlur}px)`,
                      }}
                      transition={{ type: "spring", stiffness: 300, damping: 22, mass: 0.5 }}
                      className={lineClass}
                    >
                      {line.text}
                    </motion.p>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderEditorialLayout = () => {
    return (
      <div 
        style={{ 
          maskImage: 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)'
        }}
        className="relative z-10 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] px-10 pt-16 pb-32 scroll-smooth w-full"
      >
        {lyricsLoading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full w-full space-y-8 pb-32">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 bg-white/10 rounded-full animate-pulse" style={{ width: `${Math.random() * 40 + 30}%` }} />
            ))}
          </motion.div>
        ) : lyricsError ? (
          <div className="flex items-center justify-center h-full pb-32">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center text-neutral-400 bg-black/40 p-10 rounded-3xl border border-white/5 backdrop-blur-md">
              <AlertCircle className="w-10 h-10 mb-4 text-[#f91362] opacity-80" />
              <p className="font-bold text-lg text-white mb-2">Lyrics Unavailable</p>
              <p className="max-w-xs text-sm">{lyricsError}</p>
            </motion.div>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.7, staggerChildren: 0.05 }}
            className="flex flex-col text-center pb-32"
          >
            {plainLyrics.map((line, i) => {
              const isHighlight = i % 7 === 0;
              return (
                <p 
                  key={i} 
                  className={`break-inside-avoid mb-8 transition-all duration-500 hover:text-white ${isHighlight ? 'text-2xl font-black text-white tracking-tight border-l-4 border-[var(--brand-mid)] pl-4 py-1 drop-shadow-[0_0_20px_rgba(255,255,255,0.6)]' : 'text-lg font-medium text-neutral-400 hover:scale-[1.02] origin-center'}`}
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

  if (!isZenMode) return null;

  return (
    <div className={`fixed inset-0 z-[100] bg-black overflow-hidden flex items-center justify-center font-sans select-none transition-colors duration-700 ${isActive ? '' : 'cursor-none'}`}>
      
      {/* ATMOSPHERIC CINEMATIC BACKGROUND & HEAVY DIRTY LENS EFFECT */}
      <AnimatePresence>
        {albumArtUrl && backdropReady && (
          <motion.div
            key={`bg-${trackId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeInOut" } }}
            transition={{ duration: 2, ease: "easeInOut" }}
            className="absolute inset-0 overflow-hidden pointer-events-none"
          >
            {backdropUrl ? (
              <>
                {/* A 48px pre-blurred copy of the art, stretched: same wash, no per-frame blur */}
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-40 scale-125 animate-[pulse_12s_ease-in-out_infinite] will-change-transform"
                  style={{ backgroundImage: `url(${backdropUrl})` }}
                />
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-35 scale-150 origin-[45%_55%] animate-[spin_90s_linear_infinite] will-change-transform"
                  style={{ backgroundImage: `url(${backdropUrl})` }}
                />
              </>
            ) : (
              // No CORS on the image: one modest CSS blur on a small box, scaled up, rather than
              // two full-viewport 150px blurs
              <div
                className="absolute left-1/2 top-1/2 w-[60vmax] h-[60vmax] -translate-x-1/2 -translate-y-1/2 scale-[2] bg-cover bg-center opacity-40 blur-[40px] saturate-[2] animate-[pulse_12s_ease-in-out_infinite] will-change-transform"
                style={{ backgroundImage: `url(${albumArtUrl})` }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/90" />
            
            {/* ENHANCED DIRTY LENS / ANAMORPHIC FILM GRAIN & HEAVY VIGNETTE */}
            <div className="absolute inset-0 bg-noise opacity-[0.08] mix-blend-overlay pointer-events-none" />
            <div className="absolute inset-0 bg-radial-vignette opacity-95 pointer-events-none" />
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 100%)' }}
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-[var(--brand-mid)]/10 via-transparent to-blue-500/5 mix-blend-color-dodge pointer-events-none" />

            {/* Film grain — self-contained inline noise, jittering like real 35mm dirt. A CSS
                transform keyframe (compositor only) rather than a blended layer re-composited
                every frame */}
            <div
              className="absolute -inset-[10%] pointer-events-none opacity-[0.07] animate-grain will-change-transform"
              style={{
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
                backgroundSize: '180px 180px',
              }}
            />

            {/* Anamorphic light leak / lens flare sweep: softness from wide gradient stops, not a filter */}
            <motion.div
              className="absolute inset-y-0 -left-1/3 w-2/3 pointer-events-none mix-blend-screen opacity-[0.12] will-change-transform"
              style={{
                background: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.35) 46%, var(--brand-mid) 52%, transparent 72%)',
              }}
              animate={{ x: ['-10%', '160%'] }}
              transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', repeatDelay: 6 }}
            />

            {/* Dust / smudge specks for a lived-in lens */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.08] mix-blend-screen"
              style={{
                backgroundImage: `
                  radial-gradient(circle at 18% 24%, rgba(255,255,255,0.9) 0px, transparent 2px),
                  radial-gradient(circle at 76% 68%, rgba(255,255,255,0.7) 0px, transparent 1.5px),
                  radial-gradient(circle at 62% 15%, rgba(255,255,255,0.6) 0px, transparent 1px),
                  radial-gradient(circle at 32% 82%, rgba(255,255,255,0.8) 0px, transparent 2px),
                  radial-gradient(circle at 88% 40%, rgba(255,255,255,0.5) 0px, transparent 1px)
                `,
              }}
            />

            {/* Chromatic fringe at the extreme edges */}
            <div
              className="absolute inset-0 pointer-events-none mix-blend-screen opacity-[0.35]"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 60%, rgba(255,60,90,0.08) 85%, transparent 100%), radial-gradient(ellipse at center, transparent 62%, rgba(60,180,255,0.08) 88%, transparent 100%)',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={toggleZenMode}
        className={`absolute top-8 right-8 z-20 w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:text-white rounded-full backdrop-blur-xl hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-700 shadow-2xl ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <Minimize2 className="w-5 h-5" />
      </button>

      {/* DYNAMIC CINEMATIC SPLIT-SCREEN LAYOUT */}
      <div className="relative z-10 flex flex-col lg:flex-row items-center justify-center w-full max-w-[1800px] mx-auto h-full px-8 lg:px-16 gap-8 lg:gap-16 pb-20">
        <AnimatePresence mode="wait">
          {currentTrack ? (
            <>
              {/* LEFT COLUMN: ALBUM ART & METADATA */}
              <motion.div
                className={`flex flex-col items-center justify-center transition-all duration-700 ${showLyrics ? 'w-full lg:w-5/12 max-w-xl shrink-0' : 'w-full max-w-4xl shrink-0'}`}
              >
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={trackId}
                    initial={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -16, filter: 'blur(10px)', transition: { duration: 0.4, ease: 'easeIn' } }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center w-full"
                  >
                    <div
                      className={`relative group mb-8 shadow-[0_30px_80px_-15px_rgba(0,0,0,0.95)] rounded-2xl overflow-hidden transition-all duration-700 hover:shadow-[var(--brand-mid)]/20 hover:shadow-[0_35px_90px_-10px_rgba(34,197,94,0.3)] hover:scale-[1.01] ${showLyrics ? 'w-64 h-64 md:w-80 md:h-80' : 'w-72 h-72 md:w-[380px] md:h-[380px]'}`}
                    >
                      <img 
                        src={albumArtUrl} 
                        alt="" 
                        className="w-full h-full object-cover rounded-2xl"
                      />
                      <div className="absolute inset-0 border border-white/10 rounded-2xl pointer-events-none transition-colors group-hover:border-white/20" />
                      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5 shadow-[inset_0_0_60px_rgba(0,0,0,0.6)] pointer-events-none" />
                    </div>
                    
                    <div className="w-full flex flex-col items-center text-center">
                      <h1 className={`font-black text-white tracking-tighter mb-2 w-full break-words [text-wrap:balance] leading-tight px-4 drop-shadow-[0_0_25px_rgba(255,255,255,0.5)] drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)] ${showLyrics ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-3xl md:text-5xl lg:text-6xl'}`}>
                        {currentTrack.name}
                      </h1>
                      <h2 className={`font-semibold text-neutral-300 w-full break-words [text-wrap:balance] leading-snug px-4 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] ${showLyrics ? 'text-base md:text-lg' : 'text-lg md:text-2xl'}`}>
                        {currentTrack.artists.map(a => a.name).join(', ')}
                      </h2>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              {/* RIGHT COLUMN: HYPER-CINEMATIC LYRICS ENGINE */}
              <AnimatePresence>
                {showLyrics && (
                  <motion.div
                    initial={{ opacity: 0, x: 40, filter: "blur(12px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: 20, filter: "blur(12px)" }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="w-full lg:w-7/12 h-full flex flex-col items-center justify-center py-12 lg:py-24"
                  >
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`${trackId}-${syncedLyrics ? 'synced' : 'plain'}`}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12, transition: { duration: 0.3, ease: 'easeIn' } }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="w-full h-full flex flex-col items-center"
                      >
                        {syncedLyrics ? renderSyncedEngine() : renderEditorialLayout()}
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <motion.h1 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="text-3xl text-neutral-500 font-bold tracking-tight animate-pulse"
            >
              Awaiting active audio stream...
            </motion.h1>
          )}
        </AnimatePresence>
      </div>

      {/* FIXED PLAYBACK CONTROLS */}
      <div 
        className={`absolute bottom-[10%] z-20 left-1/2 -translate-x-1/2 flex items-center space-x-8 bg-black/30 border border-white/[0.08] px-8 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all duration-700 ease-in-out ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <button
          onClick={previousTrack}
          className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300"
        >
          <SkipBack className="w-6 h-6 fill-current" />
        </button>
        
        <button
          onClick={togglePlay}
          className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 shadow-xl shadow-black/50"
        >
          {isPaused ? (
            <Play className="w-7 h-7 fill-current ml-1" />
          ) : (
            <Pause className="w-7 h-7 fill-current" />
          )}
        </button>

        <button
          onClick={nextTrack}
          className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300"
        >
          <SkipForward className="w-6 h-6 fill-current" />
        </button>
      </div>

      {/* VOLUME & LYRICS TOGGLE */}
      <div className={`absolute bottom-8 right-8 z-30 flex items-center space-x-3 bg-neutral-950/40 border border-white/5 hover:border-white/10 hover:bg-neutral-900/60 px-4 py-3 rounded-xl transition-all duration-500 group ${isActive ? 'opacity-30 hover:opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <button 
          onClick={() => setShowLyrics(!showLyrics)} 
          className={`transition-colors ${showLyrics ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'text-white/60 hover:text-white'}`}
        >
          <Mic2 className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-white/10 mx-1" />

        <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
          {savedVolume === 0 ? (
            <VolumeX className="w-4 h-4 text-red-400" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
        <input 
          type="range"
          min="0"
          max="100"
          value={savedVolume}
          onChange={handleVolumeChange}
          className="w-0 group-hover:w-20 accent-white h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer transition-all duration-500 ease-out origin-right"
        />
      </div>
    </div>
  );
}