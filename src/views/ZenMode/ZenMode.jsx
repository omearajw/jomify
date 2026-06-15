import { useEffect, useState, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 1. HORIZONTAL TRACKING PHYSICS
// A clean, side-to-side spatial pan that respects the timeline (Left = Past, Right = Future)
const trackingVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 600 : -600, // Comes from the right if next, left if previous
    opacity: 0,
    scale: 0.85,
    filter: "blur(12px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: { 
      type: "spring", 
      stiffness: 220, 
      damping: 28, 
      mass: 1 
    }
  },
  exit: (direction) => ({
    x: direction > 0 ? -600 : 600, // Pushed to the left if next, right if previous
    opacity: 0,
    scale: 0.85,
    filter: "blur(12px)",
    transition: { duration: 0.45, ease: "easeOut" }
  })
};

// 2. STATIC TEXT FADE
const textVariants = {
  enter: { opacity: 0, filter: "blur(4px)", y: 10 },
  center: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, filter: "blur(4px)", y: -10, transition: { duration: 0.3, ease: "easeIn" } }
};

export default function ZenMode() {
  const { isZenMode, toggleZenMode, savedVolume, setSavedVolume } = useUserStore();
  const { player, playbackState } = usePlayerStore();
  
  const [isMuted, setIsMuted] = useState(false);
  const [direction, setDirection] = useState(1);
  
  const isManualSkip = useRef(false);

  const currentTrack = playbackState?.track_window?.current_track;
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';

  const getFontSizeClass = (text) => {
    if (!text) return 'text-4xl md:text-6xl';
    if (text.length > 32) return 'text-2xl md:text-4xl';
    if (text.length > 18) return 'text-3xl md:text-5xl';
    return 'text-4xl md:text-6xl';
  };

  useEffect(() => {
    if (!isManualSkip.current) {
      setDirection(1);
    }
    isManualSkip.current = false;
  }, [trackId]);

  useEffect(() => {
    if (isZenMode) document.documentElement.requestFullscreen().catch(console.error);
    else if (document.fullscreenElement) document.exitFullscreen().catch(console.error);
  }, [isZenMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isZenMode) toggleZenMode();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isZenMode, toggleZenMode]);

  useEffect(() => {
    if (player && isZenMode) {
      const exponentialVolume = Math.pow(savedVolume / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
  }, [player, isZenMode, savedVolume]);

  const handleNext = () => {
    isManualSkip.current = true;
    setDirection(1);
    player?.nextTrack();
  };

  const handlePrev = () => {
    isManualSkip.current = true;
    setDirection(-1);
    player?.previousTrack();
  };

  const handleVolumeChange = (e) => {
    const uiValue = parseInt(e.target.value, 10);
    setSavedVolume(uiValue); 
    if (player) {
      const exponentialVolume = Math.pow(uiValue / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
    if (uiValue > 0 && isMuted) setIsMuted(false);
  };

  const toggleMute = () => {
    if (!player) return;
    if (isMuted) {
      const exponentialVolume = Math.pow(savedVolume / 100, 3);
      player.setVolume(exponentialVolume).then(() => setIsMuted(false)).catch(console.error);
    } else {
      player.setVolume(0).then(() => setIsMuted(true)).catch(console.error);
    }
  };

  if (!isZenMode) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-hidden flex flex-col items-center justify-center font-sans select-none">
      
      {/* AMBIENT LIGHT BLEED ENGINE */}
      <AnimatePresence mode="popLayout" initial={false}>
        {albumArtUrl && (
          <motion.div 
            key={`bg-${trackId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 1.4 } }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <div className="absolute inset-0 bg-cover bg-center opacity-30 scale-125 blur-[100px] saturate-[1.6] animate-[pulse_10s_ease-in-out_infinite]" style={{ backgroundImage: `url(${albumArtUrl})` }} />
            <div className="absolute inset-0 bg-cover bg-center opacity-25 scale-150 blur-[120px] saturate-[1.8] origin-[45%_55%] animate-[spin_80s_linear_infinite]" style={{ backgroundImage: `url(${albumArtUrl})` }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black" />
            <div className="absolute inset-0 bg-radial-vignette pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={toggleZenMode}
        className="absolute top-8 right-8 z-50 w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:text-white rounded-full backdrop-blur-xl hover:bg-white/10 hover:scale-105 active:scale-95 transition-all shadow-2xl"
      >
        <Minimize2 className="w-5 h-5" />
      </button>

      {/* CORE LAYER PLATFORM */}
      <div className="relative z-10 flex flex-col items-center justify-center max-w-4xl w-full px-8 mt-6">
        
        {/* THE HOLOGRAPHIC TURNTABLE */}
        <div className="relative w-80 h-80 md:w-[420px] md:h-[420px] mb-12 flex items-center justify-center">
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            {currentTrack && (
              <motion.div 
                key={`ui-album-${trackId}`}
                custom={direction}
                variants={trackingVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="absolute inset-0 flex items-center justify-center"
              >
                {/* The spinning vinyl record. 
                  animationPlayState allows us to pause the spin exactly where it is when the music stops. 
                */}
                <div 
                  className="w-full h-full rounded-full shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-white/10 overflow-hidden relative group animate-[spin_20s_linear_infinite]"
                  style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
                >
                  <img src={albumArtUrl} alt="" className="w-full h-full object-cover rounded-full" />
                  
                  {/* Vinyl Record Center Hole */}
                  <div className="absolute inset-0 m-auto w-8 h-8 md:w-12 md:h-12 bg-black rounded-full shadow-inner border border-white/5 flex items-center justify-center">
                    <div className="w-2 h-2 md:w-3 md:h-3 bg-neutral-900 rounded-full" />
                  </div>
                  
                  {/* Subtle Vinyl Shine/Groove overlay */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/5 via-transparent to-black/20 mix-blend-overlay pointer-events-none" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* TYPOGRAPHY DOCK */}
        <div className="h-32 flex flex-col items-center justify-center w-full px-4 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {currentTrack ? (
              <motion.div 
                key={`text-${trackId}`}
                variants={textVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="text-center w-full py-2"
              >
                <h1 className={`font-extrabold text-white tracking-tighter mb-2 max-w-3xl truncate px-4 drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)] mx-auto leading-normal ${getFontSizeClass(currentTrack.name)}`}>
                  {currentTrack.name}
                </h1>
                <h2 className="text-lg md:text-xl font-medium text-neutral-400 max-w-2xl truncate px-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] mx-auto leading-normal">
                  {currentTrack.artists.map(a => a.name).join(', ')}
                </h2>
              </motion.div>
            ) : (
              <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-3xl text-neutral-500 font-bold tracking-tight animate-pulse">
                Awaiting active audio stream...
              </motion.h1>
            )}
          </AnimatePresence>
        </div>

        {/* COMPONENT CONTROL CONTAINER */}
        <div className="flex items-center space-x-8 mt-6 bg-white/[0.02] border border-white/[0.06] backdrop-blur-2xl px-8 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] pointer-events-auto">
          <button onClick={handlePrev} className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300">
            <SkipBack className="w-6 h-6 fill-current" />
          </button>
          
          <button onClick={() => player?.togglePlay()} className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 shadow-xl shadow-black/40">
            {isPaused ? <Play className="w-7 h-7 fill-current ml-1" /> : <Pause className="w-7 h-7 fill-current" />}
          </button>

          <button onClick={handleNext} className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300">
            <SkipForward className="w-6 h-6 fill-current" />
          </button>
        </div>
      </div>

      {/* DETACHED CONTROLLER AUDIO DISPLAY */}
      <div className="absolute bottom-8 right-8 z-50 flex items-center space-x-3 bg-neutral-950/20 border border-white/5 hover:border-white/10 hover:bg-neutral-900/40 backdrop-blur-xl px-4 py-3 rounded-xl opacity-0 hover:opacity-100 transition-all duration-500 group">
        <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
          {isMuted || savedVolume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input 
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : savedVolume}
          onChange={handleVolumeChange}
          className="w-0 group-hover:w-20 accent-white h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer transition-all duration-500 ease-out origin-right"
        />
      </div>
    </div>
  );
}