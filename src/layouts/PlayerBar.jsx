import { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Mic2, Maximize2, VolumeX, Shuffle, ListMusic } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { formatTime } from '../utils/formatTime';
import { checkTracksLiked, toggleShuffleState } from '../services/spotify/api';
import { useUserStore } from '../store/userStore';
import LikeButton from '../components/LikeButton';

export default function PlayerBar() {
  const { player, playbackState, deviceId, isShuffled, toggleOptimisticShuffle } = usePlayerStore();
  const { 
    token, setLikedTracks, toggleQueue, consumeManuallyQueuedTrack, 
    toggleZenMode, savedVolume, setSavedVolume,
    currentView, setCurrentView, goBack
  } = useUserStore();

  const [progressMs, setProgressMs] = useState(0);
  const [prevVolume, setPrevVolume] = useState(50);

  const currentTrack = playbackState?.track_window?.current_track;
  const currentTrackUid = currentTrack?.uid;
  const isPaused = playbackState ? playbackState.paused : true;
  const durationMs = currentTrack ? playbackState.duration : 0;

  const progressPercentage = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;
  const volumePercentage = savedVolume;

  useEffect(() => {
    if (playbackState) {
      setProgressMs(playbackState.position);
    }
  }, [playbackState]);

  useEffect(() => {
    let interval = null;
    if (!isPaused && durationMs > 0) {
      interval = setInterval(() => {
        setProgressMs((prev) => Math.min(prev + 1000, durationMs));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPaused, durationMs]);

  useEffect(() => {
    if (token && currentTrack?.id) {
      checkTracksLiked(token, [currentTrack.id]).then(setLikedTracks);
    }
  }, [token, currentTrack?.id, setLikedTracks]);

  const handleTogglePlay = () => player?.togglePlay().catch(console.error);
  const handleNext = () => player?.nextTrack().catch(console.error);
  const handlePrev = () => player?.previousTrack().catch(console.error);

  const handleSeek = (e) => {
    const newTime = parseInt(e.target.value, 10);
    setProgressMs(newTime);
    player?.seek(newTime).catch(console.error);
  };

  const handleToggleShuffle = () => {
    if (!player || !deviceId) return;
    toggleOptimisticShuffle();
    toggleShuffleState(token, deviceId, !isShuffled).catch((err) => {
      console.error(err);
      toggleOptimisticShuffle();
    });
  };

  useEffect(() => {
    if (currentTrack) {
      consumeManuallyQueuedTrack(currentTrack);
    }
  }, [currentTrackUid, consumeManuallyQueuedTrack]);

  const handleVolumeChange = (e) => {
    const sliderValue = parseInt(e.target.value, 10);
    setSavedVolume(sliderValue);
    if (sliderValue > 0) setPrevVolume(sliderValue);
    const normalized = sliderValue / 100;
    const humanEarVolume = Math.pow(normalized, 3); 
    player?.setVolume(humanEarVolume).catch(console.error);
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
      const normalized = restoredVolume / 100;
      const humanEarVolume = Math.pow(normalized, 3);
      player.setVolume(humanEarVolume).catch(console.error);
    }
  };

  return (
    <div className="h-20 md:h-24 bg-black/80 md:bg-black/60 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-4 md:px-6 text-white select-none relative z-20 pb-safe">
      
      {/* 1. Track Info (Flex-1 on mobile, 1/3 on desktop) */}
      <div className="flex items-center space-x-3 md:space-x-4 flex-1 md:w-1/3 md:flex-initial min-w-0 pr-2">
        {currentTrack?.album?.images?.[0]?.url ? (
          <img 
            src={currentTrack.album.images[0].url} 
            alt={currentTrack.name} 
            className="w-11 h-11 md:w-14 md:h-14 rounded-lg md:rounded shadow-md object-cover shrink-0"
          />
        ) : (
          <div className="w-11 h-11 md:w-14 md:h-14 bg-neutral-800 rounded flex items-center justify-center text-neutral-500 shadow-md shrink-0">
            🎵
          </div>
        )}
        <div className="truncate min-w-0 flex-1">
          <h4 className="text-xs md:text-sm font-bold text-white truncate">
            {currentTrack ? currentTrack.name : 'No Track Playing'}
          </h4>
          <p className="text-[10px] md:text-xs text-neutral-400 truncate">
            {currentTrack ? currentTrack.artists.map(a => a.name).join(', ') : 'Unknown Artist'}
          </p>
        </div>
        <div className="shrink-0 flex items-center">
          <LikeButton trackId={currentTrack?.id} />
        </div>
      </div>

      {/* 2. Playback Controls & Scrubber */}
      <div className="flex flex-col items-center justify-center md:w-1/3 shrink-0">
        <div className="flex items-center space-x-3 md:space-x-6">
          <button onClick={handleToggleShuffle} className={`hidden md:block mr-2 transition-colors ${isShuffled ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'text-neutral-400 hover:text-white'}`}>
            <Shuffle className="w-4 h-4" />
          </button>

          <button onClick={handlePrev} disabled={!player} className="hidden sm:block text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipBack className="w-4 h-4 md:w-5 md:h-5 fill-current" />
          </button>
          
          <button 
            onClick={handleTogglePlay} 
            disabled={!player} 
            className="w-10 h-10 md:w-10 md:h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 shadow-md"
          >
            {isPaused ? <Play className="w-4 h-4 md:w-5 md:h-5 fill-current ml-0.5" /> : <Pause className="w-4 h-4 md:w-5 md:h-5 fill-current" />}
          </button>
          
          <button onClick={handleNext} disabled={!player} className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipForward className="w-4 h-4 md:w-5 md:h-5 fill-current" />
          </button>
        </div>

        {/* Desktop-only Scrubber Bar */}
        <div className="hidden md:flex w-full items-center space-x-3 text-xs text-neutral-400 font-medium tracking-tighter group mt-2">
          <span className="w-8 text-right">{formatTime(progressMs)}</span>
          <input 
            type="range" 
            min="0" 
            max={durationMs || 100} 
            value={progressMs} 
            onChange={handleSeek}
            disabled={!player || !currentTrack}
            className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-white transition-all"
            style={{
              background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${progressPercentage}%, #404040 ${progressPercentage}%, #404040 100%)`
            }}
          />
          <span className="w-8">{formatTime(durationMs)}</span>
        </div>
      </div>

      {/* 3. Utility Actions & Volume */}
      <div className="hidden md:flex items-center justify-end space-x-4 md:w-1/3 text-neutral-400">
        <button 
          onClick={() => currentView === 'lyrics' ? goBack() : setCurrentView('lyrics')} 
          className={`transition-colors ${currentView === 'lyrics' ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'hover:text-white'}`}
        >
          <Mic2 className="w-4 h-4" />
        </button>
        
        <div className="flex items-center space-x-2 group">
          <button onClick={toggleMute} className="hover:text-white transition-colors">
            {savedVolume === 0 ? <VolumeX className="w-5 h-5 text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={savedVolume} 
            onChange={handleVolumeChange}
            className="w-24 h-1.5 rounded-lg appearance-none cursor-pointer accent-white transition-all"
            style={{
              background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${volumePercentage}%, #404040 ${volumePercentage}%, #404040 100%)`
            }}
          />
        </div>
        
        <button onClick={toggleQueue} className="hover:text-white transition-colors">
          <ListMusic className="w-4 h-4" />
        </button>

        <button onClick={toggleZenMode} className="text-neutral-400 hover:text-white transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}