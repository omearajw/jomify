import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Mic2, Maximize2, VolumeX, Shuffle, ListMusic, Repeat, Repeat1, MonitorSpeaker } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { formatTime } from '../utils/formatTime';
import { checkTracksLiked } from '../services/spotify/api';
import { useUserStore } from '../store/userStore';
import LikeButton from '../components/LikeButton';
import TrackArtists from '../components/TrackArtists';
import { idFromUri } from '../utils/spotifyUri';
import { useSlice } from '../store/selectors';
import { artUrl } from '../utils/images';
import {
  togglePlay, next as nextTrack, previous as previousTrack, seek, setVolume as setPlaybackVolume,
  toggleShuffle, cycleRepeat
} from '../services/spotify/playbackController';

export default function PlayerBar() {
  const { playbackState, isShuffled, repeatMode, activeDevice, sdkStatus, isLocalActive, remoteVolume } = useSlice(usePlayerStore, ['playbackState', 'isShuffled', 'repeatMode', 'activeDevice', 'sdkStatus', 'isLocalActive', 'remoteVolume']);
  const {
    token, setLikedTracks, toggleQueue, consumeManuallyQueuedTrack,
    toggleZenMode, savedVolume, setSavedVolume, setDevicePickerOpen,
    currentView, setCurrentView, goBack, navigateToAlbum, viewHistory,
    isQueueOpen, isZenMode
  } = useSlice(useUserStore, [
    'token', 'setLikedTracks', 'toggleQueue', 'consumeManuallyQueuedTrack',
    'toggleZenMode', 'savedVolume', 'setSavedVolume', 'setDevicePickerOpen',
    'currentView', 'setCurrentView', 'goBack', 'navigateToAlbum', 'viewHistory',
    'isQueueOpen', 'isZenMode'
  ]);

  const [progressMs, setProgressMs] = useState(0);
  const [prevVolume, setPrevVolume] = useState(50);
  // True while the user is dragging the progress slider, so position updates and the
  // one-second tick don't yank the thumb back mid-gesture.
  const isScrubbing = useRef(false);

  const currentTrack = playbackState?.track_window?.current_track;
  const currentTrackUid = currentTrack?.uid;
  const isPaused = playbackState ? playbackState.paused : true;
  const durationMs = currentTrack ? playbackState.duration : 0;
  // Something to send commands to: this browser's player, or whatever device Spotify says is active
  const canControl = Boolean(activeDevice) || sdkStatus === 'ready';
  const isRemote = Boolean(activeDevice) && !isLocalActive;

  // The slider shows this browser's own level, or the remote device's when one is playing
  const volumeValue = isRemote && remoteVolume !== null ? remoteVolume : savedVolume;
  const volumeSupported = !isRemote || activeDevice?.supportsVolume !== false;

  // Calculate percentages for the dynamic gradients
  const progressPercentage = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;
  const volumePercentage = volumeValue;

  useEffect(() => {
    if (playbackState && !isScrubbing.current) {
      setProgressMs(playbackState.position);
    }
  }, [playbackState]);

  useEffect(() => {
    let interval = null;
    if (!isPaused && durationMs > 0) {
      interval = setInterval(() => {
        setProgressMs((prev) => (isScrubbing.current ? prev : Math.min(prev + 1000, durationMs)));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPaused, durationMs]);

  useEffect(() => {
    if (token && currentTrack?.id) {
      // During a rate-limit cooldown this rejects locally; there's nothing useful to do about it
      checkTracksLiked(token, [currentTrack.id]).then(setLikedTracks).catch(() => {});
    }
  }, [token, currentTrack?.id, setLikedTracks]);

  const handleTogglePlay = () => { if (currentTrack) togglePlay(); };
  const handleNext = () => nextTrack();
  const handlePrev = () => previousTrack();

  // The slider previews while dragging and seeks once on release. onChange alone fired a
  // seek per pixel and fought the position events the whole way.
  const previewSeek = (e) => setProgressMs(parseInt(e.target.value, 10));
  const commitSeek = () => {
    isScrubbing.current = false;
    seek(progressMs);
  };
  const seekBy = (deltaMs) => {
    if (!currentTrack) return;
    const next = Math.max(0, Math.min(durationMs, progressMs + deltaMs));
    setProgressMs(next);
    seek(next);
  };

  const handleToggleShuffle = () => { if (canControl) toggleShuffle(); };

  useEffect(() => {
    if (currentTrack) {
      consumeManuallyQueuedTrack(currentTrack);
    }
  // Keyed on the per-play uid rather than the track object, so a track that repeats is
  // consumed once per play and a position tick doesn't re-run this
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackUid, consumeManuallyQueuedTrack]);

  // One place that maps slider value -> audible volume. The controller applies the cubic curve
  // for this browser's player and sends the plain percentage to remote devices.
  const applyVolume = (sliderValue) => {
    const clamped = Math.max(0, Math.min(100, sliderValue));
    if (clamped > 0) setPrevVolume(clamped);
    if (!isRemote) setSavedVolume(clamped);
    setPlaybackVolume(clamped);
  };

  const handleVolumeChange = (e) => applyVolume(parseInt(e.target.value, 10));
  const changeVolumeBy = (delta) => applyVolume(volumeValue + delta);

  const toggleMute = () => {
    if (!canControl || !volumeSupported) return;
    if (volumeValue > 0) {
      setPrevVolume(volumeValue);
      applyVolume(0);
    } else {
      applyVolume(prevVolume > 0 ? prevVolume : 50);
    }
  };

  // --- KEYBOARD SHORTCUTS ---
  // One document-level listener, reading the freshest handlers through a ref so it never
  // re-subscribes. Ignored while typing in a field or when a modifier is held.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { handleTogglePlay, seekBy, changeVolumeBy, toggleMute, hasTrack: Boolean(currentTrack) };
  });

  useEffect(() => {
    const isTyping = (el) =>
      Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const h = latest.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          h.handleTogglePlay();
          break;
        case 'ArrowRight':
          if (h.hasTrack) { e.preventDefault(); h.seekBy(10000); }
          break;
        case 'ArrowLeft':
          if (h.hasTrack) { e.preventDefault(); h.seekBy(-10000); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          h.changeVolumeBy(5);
          break;
        case 'ArrowDown':
          e.preventDefault();
          h.changeVolumeBy(-5);
          break;
        case 'm':
        case 'M':
          h.toggleMute();
          break;
        default:
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // The SDK hands us URIs, not ids, so resolve the album here once
  const albumId = idFromUri(currentTrack?.album?.uri, 'album');
  const albumArt = currentTrack?.album?.images?.[0]?.url ? (
    <img
      src={artUrl(currentTrack.album.images, 56)}
      alt={currentTrack.name}
      width="56"
      height="56"
      decoding="async"
      className="w-14 h-14 rounded shadow-md object-cover"
    />
  ) : (
    <div className="w-14 h-14 bg-neutral-800 rounded flex items-center justify-center text-neutral-500 shadow-md">
      🎵
    </div>
  );

  return (
    <div className="h-24 bg-black/60 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-6 text-white select-none relative z-10">

      <div className="flex items-center space-x-4 w-1/3 min-w-0">
        {albumId ? (
          <button
            type="button"
            onClick={() => navigateToAlbum(albumId)}
            title={currentTrack.album.name ? `Go to ${currentTrack.album.name}` : 'Go to album'}
            className="shrink-0 rounded hover:opacity-80 hover:scale-105 transition-all"
          >
            {albumArt}
          </button>
        ) : (
          <div className="shrink-0">{albumArt}</div>
        )}
        <div className="truncate pr-4 min-w-0">
          <h4 className="text-sm font-bold text-white truncate">
            {currentTrack ? currentTrack.name : 'Nothing playing'}
          </h4>
          {currentTrack && (
            <TrackArtists
              artists={currentTrack.artists}
              className="text-xs text-neutral-400 truncate block"
            />
          )}
          {currentTrack?.id && <LikeButton trackId={currentTrack.id} />}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center w-1/3 space-y-2">
        <div className="flex items-center space-x-6">
          <button
            onClick={handleToggleShuffle}
            disabled={!canControl}
            aria-label={isShuffled ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={isShuffled}
            className={`mr-4 transition-colors disabled:opacity-50 ${isShuffled ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'text-neutral-400 hover:text-white'}`}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button onClick={handlePrev} disabled={!currentTrack} aria-label="Previous track" className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          <button
            onClick={handleTogglePlay}
            disabled={!currentTrack}
            aria-label={isPaused ? 'Play' : 'Pause'}
            title={isPaused ? 'Play (Space)' : 'Pause (Space)'}
            className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-transform disabled:opacity-50"
          >
            {isPaused ? <Play className="w-5 h-5 fill-current ml-1" /> : <Pause className="w-5 h-5 fill-current" />}
          </button>

          <button onClick={handleNext} disabled={!currentTrack} aria-label="Next track" className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50">
            <SkipForward className="w-5 h-5 fill-current" />
          </button>

          <button
            onClick={cycleRepeat}
            disabled={!canControl}
            aria-label={['Repeat off', 'Repeat all', 'Repeat one'][repeatMode] || 'Repeat'}
            title={['Repeat off', 'Repeat all', 'Repeat one'][repeatMode] || 'Repeat'}
            className={`ml-4 transition-colors disabled:opacity-50 ${repeatMode ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'text-neutral-400 hover:text-white'}`}
          >
            {repeatMode === 2 ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
        </div>

        <div className="w-full flex items-center space-x-3 text-xs text-neutral-400 font-medium tracking-tighter group">
          <span className="w-8 text-right">{formatTime(progressMs)}</span>
          <input
            type="range"
            min="0"
            max={durationMs || 100}
            value={progressMs}
            onChange={previewSeek}
            onPointerDown={() => { isScrubbing.current = true; }}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            disabled={!currentTrack}
            aria-label="Seek"
            className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-white transition-all"
            style={{
              background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${progressPercentage}%, #404040 ${progressPercentage}%, #404040 100%)`
            }}
          />
          <span className="w-8">{formatTime(durationMs)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end space-x-4 w-1/3 text-neutral-400">
        <button
          onClick={() => setDevicePickerOpen(true)}
          aria-label="Choose a device"
          title={activeDevice ? `Playing on ${activeDevice.name}` : 'Choose a device'}
          className={`flex items-center gap-1.5 transition-colors ${isRemote ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'hover:text-white'}`}
        >
          <MonitorSpeaker className="w-4 h-4" />
          {isRemote && <span className="text-[11px] font-semibold max-w-[8rem] truncate">{activeDevice.name}</span>}
        </button>

        <button
          // Leaving lyrics: go back if there's somewhere to go, otherwise Home. A bare goBack()
          // was a dead button when the history stack was empty.
          onClick={() => {
            if (currentView !== 'lyrics') setCurrentView('lyrics');
            else if (viewHistory.length > 0) goBack();
            else setCurrentView('home');
          }}
          aria-label={currentView === 'lyrics' ? 'Close lyrics' : 'Show lyrics'}
          aria-pressed={currentView === 'lyrics'}
          className={`transition-colors ${currentView === 'lyrics' ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'hover:text-white'}`}
        >
          <Mic2 className="w-4 h-4" />
        </button>

        <div className="flex items-center space-x-2 group">
          <button onClick={toggleMute} disabled={!canControl || !volumeSupported} aria-label={volumeValue === 0 ? 'Unmute' : 'Mute'} title="Mute (M)" className="hover:text-white transition-colors disabled:opacity-50">
            {volumeValue === 0 ? <VolumeX className="w-5 h-5 text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volumeValue}
            onChange={handleVolumeChange}
            disabled={!canControl || !volumeSupported}
            aria-label="Volume"
            className="w-24 h-1.5 rounded-lg appearance-none cursor-pointer accent-white transition-all disabled:opacity-50"
            style={{
              background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${volumePercentage}%, #404040 ${volumePercentage}%, #404040 100%)`
            }}
          />
        </div>

        <button
          onClick={toggleQueue}
          aria-label={isQueueOpen ? 'Hide queue' : 'Show queue'}
          aria-pressed={isQueueOpen}
          className={`transition-colors ${isQueueOpen ? 'text-[var(--brand-mid)] drop-shadow-[0_0_8px_rgba(249,19,98,0.5)]' : 'hover:text-white'}`}
        >
          <ListMusic className="w-4 h-4" />
        </button>

        <button
          onClick={toggleZenMode}
          aria-label={isZenMode ? 'Exit Zen Mode' : 'Enter Zen Mode'}
          aria-pressed={isZenMode}
          className="text-neutral-400 hover:text-white transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
