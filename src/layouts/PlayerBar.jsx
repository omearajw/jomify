import { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Mic2, Maximize2, VolumeX, Shuffle, ListMusic } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { formatTime } from '../utils/formatTime';
import { checkTracksLiked } from '../services/spotify/api';
import { useUserStore } from '../store/userStore';
import LikeButton from '../components/LikeButton';
import { toggleShuffleState } from '../services/spotify/api';

export default function PlayerBar() {
  const { player, playbackState, deviceId, isShuffled, toggleOptimisticShuffle } = usePlayerStore();
  const { token, setLikedTracks, toggleQueue, consumeManuallyQueuedTrack, toggleZenMode } = useUserStore();

  // Local state for smooth UI updates
  const [progressMs, setProgressMs] = useState(0);
  const [visualVolume, setVisualVolume] = useState(50); // 0 to 100
  const [prevVolume, setPrevVolume] = useState(50);

  // Extract track info safely
  const currentTrack = playbackState?.track_window?.current_track;
  const currentTrackUid = currentTrack?.uid;
  const isPaused = playbackState ? playbackState.paused : true;
  const durationMs = currentTrack ? playbackState.duration : 0;
  const currentTrackUri = playbackState?.track_window?.current_track?.uri;

  // 1. Sync local progress with Spotify's state, and create a ticking clock
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

  // 2. Control Functions
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
    
    toggleOptimisticShuffle(); // Instantly turns the button green/grey
    
    toggleShuffleState(token, deviceId, !isShuffled).catch((err) => {
      console.error(err);
      toggleOptimisticShuffle(); // Revert the color if the network fails
    });
  };

  // When a song starts playing, delete it from the manual queue memory
  useEffect(() => {
    if (currentTrack) {
      consumeManuallyQueuedTrack(currentTrack);
    }
  }, [currentTrackUid, consumeManuallyQueuedTrack]);

  // 3. The Exponential Volume Fix
    const handleVolumeChange = (e) => {
    const sliderValue = parseInt(e.target.value, 10);
    setVisualVolume(sliderValue);

    if (sliderValue > 0) {
        setPrevVolume(sliderValue); // Dynamically update memory cash as you slide
    }

    const normalized = sliderValue / 100;
    const humanEarVolume = Math.pow(normalized, 2); 
    player?.setVolume(humanEarVolume).catch(console.error);
    };

    const toggleMute = () => {
    if (!player) return;

    if (visualVolume > 0) {
        // Currently has sound -> Mute it
        setPrevVolume(visualVolume);
        setVisualVolume(0);
        player.setVolume(0).catch(console.error);
    } else {
        // Currently muted -> Restore sound based on memory cache
        setVisualVolume(prevVolume);
        const normalized = prevVolume / 100;
        const humanEarVolume = Math.pow(normalized, 2);
        player.setVolume(humanEarVolume).catch(console.error);
    }
    };

  return (
    <div className="h-24 bg-black border-t border-neutral-800 flex items-center justify-between px-6 text-white select-none">
      
      {/* Track Info (Left) */}
      <div className="flex items-center space-x-4 w-1/3">
        {currentTrack?.album?.images?.[0]?.url ? (
          <img 
            src={currentTrack.album.images[0].url} 
            alt={currentTrack.name} 
            className="w-14 h-14 rounded shadow-md object-cover"
          />
        ) : (
          <div className="w-14 h-14 bg-neutral-800 rounded flex items-center justify-center text-neutral-500 shadow-md">
            🎵
          </div>
        )}
        <div className="truncate pr-4">
          <h4 className="text-sm font-bold text-white truncate">
            {currentTrack ? currentTrack.name : 'No Track Playing'}
          </h4>
          <p className="text-xs text-neutral-400 truncate">
            {currentTrack ? currentTrack.artists.map(a => a.name).join(', ') : 'Unknown Artist'}
          </p>
          <LikeButton trackId={currentTrack?.id} />
        </div>
      </div>

      {/* Main Controls (Center) */}
      <div className="flex flex-col items-center justify-center w-1/3 space-y-2">
        <div className="flex items-center space-x-6">
          <button onClick={handleToggleShuffle} className={`mr-4 transition-colors ${isShuffled ? 'text-green-500' : 'text-neutral-400 hover:text-white'}`}>
            <Shuffle className="w-4 h-4" />
          </button>

          <button onClick={handlePrev} disabled={!player} className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipBack className="w-5 h-5 fill-current" />
          </button>
          
          <button onClick={handleTogglePlay} disabled={!player} className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-transform disabled:opacity-50">
            {isPaused ? <Play className="w-5 h-5 fill-current ml-1" /> : <Pause className="w-5 h-5 fill-current" />}
          </button>
          
          <button onClick={handleNext} disabled={!player} className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>

        {/* Timeline Slider */}
        <div className="w-full flex items-center space-x-3 text-xs text-neutral-400 font-medium tracking-tighter">
          <span className="w-8 text-right">{formatTime(progressMs)}</span>
          <input 
            type="range" 
            min="0" 
            max={durationMs || 100} 
            value={progressMs} 
            onChange={handleSeek}
            disabled={!player || !currentTrack}
            className="flex-1 h-1 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-white hover:accent-green-500 transition-all"
          />
          <span className="w-8">{formatTime(durationMs)}</span>
        </div>
      </div>

      {/* Extra Controls (Right) */}
      <div className="flex items-center justify-end space-x-4 w-1/3 text-neutral-400">
        <button className="hover:text-white transition-colors"><Mic2 className="w-4 h-4" /></button>
        
        <div className="flex items-center space-x-2 group">
          <button onClick={toggleMute} className="hover:text-white transition-colors">
            {visualVolume === 0 ? <VolumeX className="w-5 h-5 text-green-500" /> : <Volume2 className="w-5 h-5" />}
          </button>
          {/* Volume Slider */}
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={visualVolume} 
            onChange={handleVolumeChange}
            className="w-24 h-1 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-white group-hover:accent-green-500 transition-all"
          />
        </div>
        
        <button onClick={toggleQueue} className="hover:text-white transition-colors">
          <ListMusic className="w-4 h-4" />
        </button>

        {/* NEW: Zen Mode Toggle */}
        <button onClick={toggleZenMode} className="text-neutral-400 hover:text-white transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>

      </div>

      

    </div>
  );
}