import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, MonitorSpeaker, ListMusic, MicVocal, Ellipsis, Volume2
} from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { useProgress } from '../hooks/useProgress';
import { togglePlay, next, previous, seek, toggleShuffle, cycleRepeat } from '../services/spotify/playbackController';
import { formatTime } from '../utils/formatTime';
import LikeButton from '../components/LikeButton';
import TrackArtists from '../components/TrackArtists';
import { idFromUri } from '../utils/spotifyUri';
import { useSlice } from '../store/selectors';
import { usePlayingFrom, playingFromLabel } from '../hooks/usePlayingFrom';
import SleepTimer from '../components/SleepTimer';
import { setVolume as setPlaybackVolume } from '../services/spotify/playbackController';

// Outer component only decides whether the sheet exists; the body mounts fresh each time it
// opens so its scrub state starts clean (same split as the dialogs).
export default function NowPlayingSheet() {
  const isOpen = useUserStore((s) => s.isNowPlayingOpen);
  return createPortal(
    <AnimatePresence>{isOpen && <NowPlayingSheetBody key="now-playing" />}</AnimatePresence>,
    document.body
  );
}

// A swipe on the artwork counts past this distance or speed
const SWIPE_PX = 70;
const SWIPE_VELOCITY = 500;

function NowPlayingSheetBody() {
  const { setNowPlayingOpen, setQueueOpen, setDevicePickerOpen, setCurrentView, navigateToAlbum, navigateToPlaylist, navigateToArtist, setContextMenu } = useSlice(useUserStore, ['setNowPlayingOpen', 'setQueueOpen', 'setDevicePickerOpen', 'setCurrentView', 'navigateToAlbum', 'navigateToPlaylist', 'navigateToArtist', 'setContextMenu']);
  const playingFrom = usePlayingFrom();
  const openPlayingFrom = () => {
    if (!playingFrom) return;
    close();
    if (playingFrom.type === 'playlist') navigateToPlaylist(playingFrom.id);
    else if (playingFrom.type === 'album') navigateToAlbum(playingFrom.id);
    else if (playingFrom.type === 'artist') navigateToArtist(playingFrom.id);
    else setCurrentView('liked-songs');
  };
  const { isShuffled, repeatMode, activeDevice, sdkStatus, remoteVolume, autoplaySource } = useSlice(usePlayerStore, ['isShuffled', 'repeatMode', 'activeDevice', 'sdkStatus', 'remoteVolume', 'autoplaySource']);
  // What comes next: this browser's player knows; for another device, the queue the panel fetched
  const nextTrack = usePlayerStore((s) => s.playbackState?.track_window?.next_tracks?.[0] || null);
  const queuedNext = useUserStore((s) => s.queueData?.queue?.[0] || null);
  const upNext = nextTrack || queuedNext;
  // A speaker or computer playing: its volume, from here
  const remoteVolumeControl = Boolean(activeDevice) && !activeDevice.isLocal && activeDevice.supportsVolume !== false;
  const [volumeDraft, setVolumeDraft] = useState(null);
  const { position, duration, paused, track } = useProgress();
  const [scrub, setScrub] = useState(null);

  const close = () => setNowPlayingOpen(false);
  const swiped = useRef(false);
  const shown = scrub ?? position;
  const percent = duration > 0 ? (shown / duration) * 100 : 0;
  const art = track?.album?.images?.[0]?.url;
  const albumId = idFromUri(track?.album?.uri, 'album');
  const canControl = Boolean(activeDevice) || sdkStatus === 'ready' || sdkStatus === 'reconnecting';

  const commitSeek = () => {
    if (scrub === null) return;
    seek(scrub);
    setScrub(null);
  };

  const openMenu = (e) => {
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ type: 'track', track, x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 800) close(); }}
      className="fixed inset-0 z-[9000] flex flex-col bg-neutral-950 text-white select-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] overflow-hidden"
    >
      {art && (
        <img src={art} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-3xl scale-125 pointer-events-none" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black pointer-events-none" />

      <div className="relative flex items-center justify-between px-4 pt-3">
        <button type="button" onClick={close} aria-label="Close" className="w-11 h-11 flex items-center justify-center text-neutral-300">
          <ChevronDown className="w-7 h-7" />
        </button>
        <div className="min-w-0 text-center">
          {/* What the music is coming from, as Spotify shows; the device sits beneath it */}
          {autoplaySource ? (
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-light)] truncate">
              Autoplay · {autoplaySource === 'liked' ? 'from your Liked Songs' : "songs by the playlist's artists"}
            </p>
          ) : playingFrom ? (
            <button type="button" onClick={openPlayingFrom} className="block max-w-full text-xs font-bold uppercase tracking-widest text-white truncate">
              {playingFromLabel(playingFrom)}
            </button>
          ) : null}
          <p className={`text-xs font-bold uppercase tracking-widest text-neutral-400 truncate ${playingFrom ? 'text-[10px] font-semibold' : ''}`}>
            {activeDevice ? `Playing on ${activeDevice.name}` : 'Not connected'}
          </p>
        </div>
        <button type="button" onClick={openMenu} aria-label="More options" className="w-11 h-11 flex items-center justify-center text-neutral-300">
          <Ellipsis className="w-6 h-6" />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col justify-end px-6 pb-4 gap-6 min-h-0">
        <div className="flex-1 flex items-center justify-center min-h-0 py-4">
          {/* Swipe the art left for the next song, right for the previous; a tap still opens the album */}
          <motion.button
            type="button"
            drag={canControl ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.5}
            onDragStart={() => { swiped.current = true; }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -SWIPE_PX || info.velocity.x < -SWIPE_VELOCITY) next();
              else if (info.offset.x > SWIPE_PX || info.velocity.x > SWIPE_VELOCITY) previous();
            }}
            onClick={() => {
              if (swiped.current) { swiped.current = false; return; }
              if (albumId) { close(); navigateToAlbum(albumId); }
            }}
            className="w-full max-w-[min(85vw,60dvh)] aspect-square rounded-2xl shadow-2xl overflow-hidden bg-neutral-800 touch-pan-y"
            aria-label={albumId ? 'Go to album' : undefined}
          >
            {art && <img src={art} alt="" className="w-full h-full object-cover pointer-events-none" draggable="false" />}
          </motion.button>
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold tracking-tight truncate">{track ? track.name : 'Nothing playing'}</h2>
            {track && (
              <TrackArtists
                artists={track.artists}
                className="text-base text-neutral-300 truncate block"
                linkClassName="hover:underline hover:text-white transition-colors"
                onBeforeNavigate={close}
              />
            )}
          </div>
          {track?.id && <LikeButton trackId={track.id} />}
        </div>

        <div>
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={Math.min(shown, duration || 100)}
            onChange={(e) => setScrub(parseInt(e.target.value, 10))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            onTouchEnd={commitSeek}
            disabled={!track}
            aria-label="Seek"
            className="w-full h-1.5 rounded-lg appearance-none accent-white"
            style={{ background: `linear-gradient(to right, var(--brand-start) 0%, var(--brand-mid) ${percent}%, #404040 ${percent}%, #404040 100%)` }}
          />
          <div className="flex justify-between text-xs text-neutral-400 font-medium mt-1 tabular-nums">
            <span>{formatTime(shown)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleShuffle}
            disabled={!canControl}
            aria-label={isShuffled ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={isShuffled}
            className={`w-12 h-12 flex items-center justify-center disabled:opacity-40 ${isShuffled ? 'text-[var(--brand-mid)]' : 'text-neutral-300'}`}
          >
            <Shuffle className="w-6 h-6" />
          </button>
          <button type="button" onClick={previous} disabled={!track} aria-label="Previous track" className="w-14 h-14 flex items-center justify-center text-white disabled:opacity-40 active:scale-95 transition-transform">
            <SkipBack className="w-8 h-8 fill-current" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!track}
            aria-label={paused ? 'Play' : 'Pause'}
            className="w-18 h-18 flex items-center justify-center bg-white text-black rounded-full disabled:opacity-40 active:scale-95 transition-transform shadow-xl"
          >
            {paused ? <Play className="w-9 h-9 fill-current ml-1" /> : <Pause className="w-9 h-9 fill-current" />}
          </button>
          <button type="button" onClick={next} disabled={!track} aria-label="Next track" className="w-14 h-14 flex items-center justify-center text-white disabled:opacity-40 active:scale-95 transition-transform">
            <SkipForward className="w-8 h-8 fill-current" />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            disabled={!canControl}
            aria-label={['Repeat off', 'Repeat all', 'Repeat one'][repeatMode] || 'Repeat'}
            className={`w-12 h-12 flex items-center justify-center disabled:opacity-40 ${repeatMode ? 'text-[var(--brand-mid)]' : 'text-neutral-300'}`}
          >
            {repeatMode === 2 ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
          </button>
        </div>

        {upNext && (
          <p className="text-xs text-neutral-400 truncate -mt-2">
            <span className="font-bold uppercase tracking-widest text-neutral-500 mr-2">Next</span>
            <span className="text-neutral-200">{upNext.name}</span>{upNext.artists?.length ? ` · ${upNext.artists.map((a) => a.name).join(', ')}` : ''}
          </p>
        )}

        {remoteVolumeControl && (
          <div className="flex items-center gap-3 text-neutral-400">
            <Volume2 className="w-4 h-4 shrink-0" />
            <input
              type="range"
              min="0"
              max="100"
              value={volumeDraft ?? remoteVolume ?? 50}
              onChange={(e) => setVolumeDraft(parseInt(e.target.value, 10))}
              onPointerUp={() => { if (volumeDraft !== null) { setPlaybackVolume(volumeDraft); setVolumeDraft(null); } }}
              onTouchEnd={() => { if (volumeDraft !== null) { setPlaybackVolume(volumeDraft); setVolumeDraft(null); } }}
              onKeyUp={() => { if (volumeDraft !== null) { setPlaybackVolume(volumeDraft); setVolumeDraft(null); } }}
              aria-label={`Volume on ${activeDevice.name}`}
              className="w-full h-1.5 rounded-lg appearance-none accent-white"
            />
            <span className="text-xs tabular-nums w-8 text-right">{volumeDraft ?? remoteVolume ?? '–'}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-neutral-300">
          <button type="button" onClick={() => setDevicePickerOpen(true)} aria-label="Choose a device" className={`w-12 h-12 flex items-center justify-center ${activeDevice && !activeDevice.isLocal ? 'text-[var(--brand-mid)]' : ''}`}>
            <MonitorSpeaker className="w-6 h-6" />
          </button>
          <SleepTimer buttonClass="w-12 h-12 flex items-center justify-center" />
          <button type="button" onClick={() => { close(); setCurrentView('lyrics'); }} disabled={!track} aria-label="Lyrics" className="w-12 h-12 flex items-center justify-center disabled:opacity-40">
            <MicVocal className="w-6 h-6" />
          </button>
          <button type="button" onClick={() => setQueueOpen(true)} aria-label="Queue" className="w-12 h-12 flex items-center justify-center">
            <ListMusic className="w-6 h-6" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
