import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ZenMode() {
  const { isZenMode, toggleZenMode, savedVolume, setSavedVolume } = useUserStore();
  const { player, playbackState } = usePlayerStore();
  
  const [isMuted, setIsMuted] = useState(false);
  // NEW: Inactivity state
  const [isActive, setIsActive] = useState(true);

  const currentTrack = playbackState?.track_window?.current_track;
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';

  // --- INACTIVITY TIMER ---
  useEffect(() => {
    let timeout;
    const resetTimer = () => {
      setIsActive(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsActive(false), 3000);
    };

    // Listen for any interaction to wake up the UI
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('mousedown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    resetTimer(); // Trigger initially

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('mousedown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      clearTimeout(timeout);
    };
  }, []);

  // --- DYNAMIC FONT SIZER ---
  const getFontSizeClass = (text) => {
    if (!text) return 'text-4xl md:text-6xl';
    if (text.length > 32) return 'text-2xl md:text-4xl';
    if (text.length > 18) return 'text-3xl md:text-5xl';
    return 'text-4xl md:text-6xl';
  };

  // --- AUTO FULLSCREEN LOGIC ---
  useEffect(() => {
    if (isZenMode) document.documentElement.requestFullscreen().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [isZenMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isZenMode) toggleZenMode();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isZenMode, toggleZenMode]);

  // --- PERSISTENT VOLUME ---
  useEffect(() => {
    if (player && isZenMode) {
      const exponentialVolume = Math.pow(savedVolume / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
  }, [player, isZenMode, savedVolume]);

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
    // Added 'cursor-none' when inactive to hide the mouse pointer completely
    <div className={`fixed inset-0 z-[100] bg-black overflow-hidden flex items-center justify-center font-sans select-none transition-colors duration-700 ${isActive ? '' : 'cursor-none'}`}>
      
      {/* 1. ANIMATED AMBIENT ENGINE */}
      <AnimatePresence mode="popLayout">
        {albumArtUrl && (
          <motion.div 
            key={`bg-${trackId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 1.5, ease: "easeInOut" } }}
            transition={{ duration: 2, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-30 scale-125 blur-[100px] saturate-[1.6] animate-[pulse_10s_ease-in-out_infinite]"
              style={{ backgroundImage: `url(${albumArtUrl})` }}
            />
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-25 scale-150 blur-[120px] saturate-[1.8] origin-[45%_55%] animate-[spin_80s_linear_infinite]"
              style={{ backgroundImage: `url(${albumArtUrl})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black" />
            <div className="absolute inset-0 bg-radial-vignette pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. EXIT CONTROLLER (Fades out on inactivity) */}
      <button 
        onClick={toggleZenMode}
        className={`absolute top-8 right-8 z-20 w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:text-white rounded-full backdrop-blur-xl hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-700 shadow-2xl ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <Minimize2 className="w-5 h-5" />
      </button>

      {/* 3. CORE INTERFACE (Album & Text only) */}
      <div className="relative z-10 flex flex-col items-center max-w-4xl w-full px-8 text-center -mt-16">
        <AnimatePresence mode="wait">
          {currentTrack ? (
            <motion.div 
              key={`ui-${trackId}`}
              initial={{ opacity: 0, y: 30, scale: 0.95, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -30, scale: 1.05, filter: "blur(10px)" }}
              transition={{ type: "spring", stiffness: 100, damping: 20, mass: 1 }}
              className="flex flex-col items-center w-full"
            >
              <div className="relative group mb-10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] rounded-2xl overflow-hidden transition-all duration-700 hover:shadow-green-500/5 hover:shadow-[0_30px_70px_-10px_rgba(34,197,94,0.15)] hover:scale-[1.01]">
                <img 
                  src={albumArtUrl} 
                  alt="" 
                  className="w-72 h-72 md:w-[380px] md:h-[380px] object-cover rounded-2xl"
                />
                <div className="absolute inset-0 border border-white/10 rounded-2xl pointer-events-none transition-colors group-hover:border-white/20" />
              </div>
              
              <div className="py-2 w-full flex flex-col items-center">
                {/* FIX: Removed 'truncate', added 'whitespace-nowrap overflow-hidden text-ellipsis pb-2 leading-normal' to fix clipping */}
                <h1 className={`font-extrabold text-white tracking-tighter mb-2 max-w-2xl whitespace-nowrap overflow-hidden text-ellipsis pb-2 leading-normal px-4 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] ${getFontSizeClass(currentTrack.name)}`}>
                  {currentTrack.name}
                </h1>
                <h2 className="text-xl md:text-2xl font-medium text-neutral-400 max-w-2xl whitespace-nowrap overflow-hidden text-ellipsis pb-2 leading-normal px-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                  {currentTrack.artists.map(a => a.name).join(', ')}
                </h2>
              </div>
            </motion.div>
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

      {/* 4. STATIC MEDIA CONTROLS (Absolutely positioned to never jitter, fades out on inactivity) */}
      <div 
        className={`absolute bottom-[12%] left-1/2 -translate-x-1/2 flex items-center space-x-8 bg-white/[0.02] border border-white/[0.06] backdrop-blur-2xl px-8 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.4)] transition-all duration-700 ease-in-out ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <button 
          onClick={() => player?.previousTrack()} 
          className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300"
        >
          <SkipBack className="w-6 h-6 fill-current" />
        </button>
        
        <button 
          onClick={() => player?.togglePlay()} 
          className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 shadow-xl shadow-black/40"
        >
          {isPaused ? (
            <Play className="w-7 h-7 fill-current ml-1" />
          ) : (
            <Pause className="w-7 h-7 fill-current" />
          )}
        </button>

        <button 
          onClick={() => player?.nextTrack()} 
          className="text-white/40 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300"
        >
          <SkipForward className="w-6 h-6 fill-current" />
        </button>
      </div>

      {/* 5. DISCRETE HOVER VOLUME HUD (Only hoverable when active) */}
      <div className={`absolute bottom-8 right-8 z-20 flex items-center space-x-3 bg-neutral-950/20 border border-white/5 hover:border-white/10 hover:bg-neutral-900/40 backdrop-blur-xl px-4 py-3 rounded-xl transition-all duration-500 group ${isActive ? 'opacity-0 hover:opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
          {isMuted || savedVolume === 0 ? (
            <VolumeX className="w-4 h-4 text-red-400" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
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