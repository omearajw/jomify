import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ZenMode() {
  const { isZenMode, toggleZenMode } = useUserStore();
  const { player, playbackState } = usePlayerStore();
  
  const [localVolume, setLocalVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);

  const currentTrack = playbackState?.track_window?.current_track;
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';

  // --- EXPONENTIAL VOLUME CONTROL ---
  const handleVolumeChange = (e) => {
    const uiValue = parseInt(e.target.value, 10);
    setLocalVolume(uiValue); 

    if (player) {
      // Convert linear slider (0-100) to an exponential curve (0.0 - 1.0)
      // uiValue = 50 -> (0.5)^3 = 0.125 power (sounds like half volume to human ears)
      const exponentialVolume = Math.pow(uiValue / 100, 3);
      player.setVolume(exponentialVolume).catch(console.error);
    }
    if (uiValue > 0 && isMuted) setIsMuted(false);
  };

  const toggleMute = () => {
    if (!player) return;
    if (isMuted) {
      const exponentialVolume = Math.pow(localVolume / 100, 3);
      player.setVolume(exponentialVolume).then(() => setIsMuted(false)).catch(console.error);
    } else {
      player.setVolume(0).then(() => setIsMuted(true)).catch(console.error);
    }
  };

  if (!isZenMode) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-hidden flex items-center justify-center font-sans select-none">
      
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

      {/* 2. EXIT CONTROLLER */}
      <button 
        onClick={toggleZenMode}
        className="absolute top-8 right-8 z-20 w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 text-white/60 hover:text-white rounded-full backdrop-blur-xl hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-300 shadow-2xl"
      >
        <Minimize2 className="w-5 h-5" />
      </button>

      {/* 3. CORE INTERFACE (Framer Motion Orchestration) */}
      <AnimatePresence mode="wait">
        {currentTrack ? (
          <motion.div 
            key={`ui-${trackId}`}
            // The Entry Animation
            initial={{ opacity: 0, y: 30, scale: 0.95, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            // The Exit Animation
            exit={{ opacity: 0, y: -30, scale: 1.05, filter: "blur(10px)" }}
            // The Spring Physics Config
            transition={{ 
              type: "spring", 
              stiffness: 100, 
              damping: 20, 
              mass: 1 
            }}
            className="relative z-10 flex flex-col items-center max-w-4xl w-full px-8 text-center"
          >
            {/* Holographic Album Window */}
            <div className="relative group mb-12 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] rounded-2xl overflow-hidden transition-all duration-700 hover:shadow-green-500/5 hover:shadow-[0_30px_70px_-10px_rgba(34,197,94,0.15)] hover:scale-[1.01]">
              <img 
                src={albumArtUrl} 
                alt="" 
                className="w-72 h-72 md:w-[380px] md:h-[380px] object-cover rounded-2xl"
              />
              <div className="absolute inset-0 border border-white/10 rounded-2xl pointer-events-none transition-colors group-hover:border-white/20" />
            </div>
            
            <h1 className="text-4xl md:text-6xl font-extrabold text-white tracking-tighter mb-4 max-w-2xl truncate px-4 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
              {currentTrack.name}
            </h1>
            <h2 className="text-xl md:text-2xl font-medium text-neutral-400 max-w-2xl truncate px-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
              {currentTrack.artists.map(a => a.name).join(', ')}
            </h2>

            {/* Premium Control Dock */}
            <div className="flex items-center space-x-8 mt-14 bg-white/[0.02] border border-white/[0.06] backdrop-blur-2xl px-8 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
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
          </motion.div>
        ) : (
          <motion.h1 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            className="text-3xl text-neutral-500 font-bold tracking-tight animate-pulse relative z-10"
          >
            Awaiting active audio stream...
          </motion.h1>
        )}
      </AnimatePresence>

      {/* 4. DISCRETE HOVER VOLUME HUD */}
      <div className="absolute bottom-8 right-8 z-20 flex items-center space-x-3 bg-neutral-950/20 border border-white/5 hover:border-white/10 hover:bg-neutral-900/40 backdrop-blur-xl px-4 py-3 rounded-xl opacity-0 hover:opacity-100 transition-all duration-500 group">
        <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
          {isMuted || localVolume === 0 ? (
            <VolumeX className="w-4 h-4 text-red-400" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
        <input 
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : localVolume}
          onChange={handleVolumeChange}
          className="w-0 group-hover:w-20 accent-white h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer transition-all duration-500 ease-out origin-right"
        />
      </div>
    </div>
  );
}