import { cloneElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { Minimize2, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Mic2, Projector } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { findLyrics } from '../../lib/lrc';
import { useSlice } from '../../store/selectors';
import { useProgress } from '../../hooks/useProgress';
import { formatTime } from '../../utils/formatTime';
import { getBlurredBackdrop } from '../../utils/blurBackdrop';
import { togglePlay, next as nextTrack, previous as previousTrack, seek, setVolume as setPlaybackVolume } from '../../services/spotify/playbackController';
import Projection from './Projection';
import ZenStage from './ZenStage';
import { ZenFocusLyricsLite, ZenPlainLyrics } from './ZenLyricsDom';
import { TRACK_DRAG_TYPE } from '../../utils/spotifyUri';
import LikeButton from '../../components/LikeButton';
import { FALLBACK_PALETTE, paletteCss, paletteForArt } from './palette';
import { beatAt, canHearComputer, hearComputer } from './zenPulse';
import { soundFeaturesFor } from '../../services/soundFeatures';
import { usePartyStore } from '../../store/partyStore';
import { requestedBy } from '../../party/view';
import { log } from '../../services/debugLog';
import { initialLite, measureFrames, rememberLite, zenEffectsSetting, SLOW_FRAME_MS } from './zenEffects';
import Artists from '../../room/Artists';
import { flyIn, flightWaiting } from '../../room/flight';

// Zen mode: a calm, cinematic room for the song. A WebGL stage draws slow light in the cover's
// colours and the lyrics as glass that bends it, one line at a time; this component is the
// cover, the words about the song, and the controls over it. Without WebGL, or on the lite
// scene, the same layout sits over the pre-blurred cover instead.

// Real fullscreen on macOS moves the window to its own Space and blacks out every other monitor,
// which is a high price for hiding a tab bar. Zen already fills the viewport, so on a Mac it
// stays a normal window; the desktop app asks its wrapper for the screen without a Space.
const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent || '');
const desktop = () => (typeof window !== 'undefined' ? window.jomifyDesktop : null);
const usesRealFullscreen = () => !IS_MAC && !desktop()?.setZenFullscreen;

const EASE = [0.16, 1, 0.3, 1];
const GLIDE = { type: 'spring', stiffness: 60, damping: 18, mass: 1 };

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

// The thin line of light along the bottom: where the song is, and a place to seek
function ZenProgress() {
  const { position, duration, track } = useProgress();
  const [scrub, setScrub] = useState(null);
  const shown = scrub ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const commit = () => { if (scrub !== null) { seek(scrub); setScrub(null); } };
  return (
    <div className="flex items-center gap-4 text-[11px] font-medium tracking-[0.08em] tabular-nums text-white/55">
      <span className="w-10 text-right">{formatTime(shown)}</span>
      <div className="group relative flex-1 h-4 flex items-center">
        <div className="relative w-full h-[2px] rounded-full bg-white/12">
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-white/25 to-white shadow-[0_0_12px_var(--zen-glow)]" style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] rounded-full bg-white shadow-[0_0_14px_#fff,0_0_34px_var(--zen-glow)] transition-transform group-hover:scale-125" style={{ left: `${pct}%` }} />
        </div>
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={Math.min(shown, duration || 100)}
          onChange={(e) => setScrub(parseInt(e.target.value, 10))}
          onPointerUp={commit}
          onKeyUp={commit}
          onTouchEnd={commit}
          disabled={!track}
          aria-label="Seek"
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
      <span className="w-10">{formatTime(duration)}</span>
    </div>
  );
}

// mode 'zen' (the default) is the full-screen room with its chrome faded, opened over the app;
// mode 'room' is the app's base in the new layout (src/room/Room.jsx): the same stage and
// lyrics with the controls always there, the queue in `aside`, and no fullscreen. roomLayout
// says how much of the room the layer has taken: 'rest', 'half' (the room reflows beside it) or
// 'full' (the room has left; the Room draws its strip).
// The room's tempo for the parts that travel between the room and the strip (DESIGN.md §11)
const ROOM_LAYOUT = { layout: { duration: 1.1, ease: [0.2, 0.75, 0.2, 1] } };

export default function ZenMode({ mode = 'zen', roomLayout = 'rest', aside = null, inRoom = false }) {
  const room = mode === 'room';
  // Zen is the room with the chrome faded: on a switch the old layout stays as a ghost for one
  // beat, fading, while the new one fades in over the same stage. The ghost carries no refs, so
  // the stage keeps drawing into the live lyrics box.
  const [cross, setCross] = useState(null);
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) { setSeenMode(mode); setCross(seenMode); }
  useEffect(() => {
    if (!cross) return undefined;
    const t = setTimeout(() => setCross(null), 700);
    return () => clearTimeout(t);
  }, [cross]);
  const roomGhost = cross === 'room';
  // A beat across a change of layout, while the room's parts travel
  const [moving, setMoving] = useState(false);
  // the parts that are not the song (volume, progress, queue) go quiet while they travel, so the
  // crossings of a row becoming a column do not read as noise; the art and the song stay solid
  const quiet = { opacity: moving ? 0.25 : 1, transition: 'opacity var(--room-mid) var(--room-ease)' };
  // At full the queue takes whatever the lyrics leave: the column measures the queue's box and
  // tells it how many rows fit (a head of 32px, rows of 51px), so with no lyrics it grows
  const asideRef = useRef(null);
  const [asideRows, setAsideRows] = useState(3);
  useEffect(() => {
    if (roomLayout !== 'full' || !asideRef.current) return undefined;
    const el = asideRef.current;
    const fit = () => setAsideRows(Math.max(1, Math.floor((el.clientHeight - 32) / 51)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [roomLayout]);
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; return undefined; }
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 1100);
    return () => clearTimeout(t);
  }, [roomLayout]);
  const zenGhost = cross === 'zen';
  const fade = (ghost) => ({ position: 'absolute', inset: 0, pointerEvents: ghost ? 'none' : undefined, animation: `${ghost ? 'room-fade-out' : 'room-fade-in'} var(--room-mid) var(--room-ease) forwards` });
  const { isZenMode, toggleZenMode, savedVolume, setSavedVolume, playbackSettings, setPlaybackSetting } = useSlice(useUserStore, ['isZenMode', 'toggleZenMode', 'savedVolume', 'setSavedVolume', 'playbackSettings', 'setPlaybackSetting']);
  const { playbackState, activeDevice, isLocalActive, remoteVolume } = useSlice(usePlayerStore, ['playbackState', 'activeDevice', 'isLocalActive', 'remoteVolume']);

  const [prevVolume, setPrevVolume] = useState(50);
  const [isActive, setIsActive] = useState(true);
  // The lighter scene, for a machine that cannot keep the full one up: chosen in Settings, or
  // measured here on the first seconds and remembered for this device
  const [lite, setLite] = useState(initialLite);
  const [glFailed, setGlFailed] = useState(false);
  const useGl = !lite && !glFailed;
  const reducedMotion = usePrefersReducedMotion();

  // Projection mapping onto a wall: hidden behind a small button and the P key
  // Only from Zen itself. In the room this component is always mounted under the layer, and P
  // there used to open a full-screen black projector from anywhere, with the cursor hidden.
  const [projecting, setProjecting] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (mode !== 'zen' && !projecting) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target?.isContentEditable) return;
      if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) setProjecting((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [projecting, mode]);

  // Remembered with the other playback settings, so Zen opens the way it was left
  const showLyrics = Boolean(playbackSettings?.zenLyrics);
  const setShowLyrics = (on) => setPlaybackSetting('zenLyrics', Boolean(on));
  // The answer carries the song it is for. Between songs the old answer never stands in for the
  // new song, and the layout holds still until the new one arrives: before, a song with no lyrics
  // after one with none went "none, finding, none" and the stage jumped twice (Jack, 15 and 19 Oct).
  const [lyricsAnswer, setLyricsAnswer] = useState({ id: null, synced: null, plain: [] });
  const [slowLookup, setSlowLookup] = useState(null); // the song id whose lookup is taking a while
  const [sungLine, setSungLine] = useState(null);

  const currentTrack = playbackState?.track_window?.current_track;
  const partyHistory = usePartyStore((st) => st.history);
  const partyUpNext = usePartyStore((st) => st.upNext);
  const requestedByGuest = requestedBy(currentTrack, { history: partyHistory, upNext: partyUpNext });
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';
  // A song arriving from the top of the queue: its cover flies in from the queue row
  // (room/flight.js) instead of rising in like any other change of song
  const flyRef = useRef(null);
  const flying = flightWaiting(currentTrack);
  useLayoutEffect(() => {
    if (flyRef.current && currentTrack) flyIn(flyRef.current, currentTrack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // The light's colours, from the cover
  const [palette, setPalette] = useState(FALLBACK_PALETTE);
  useEffect(() => {
    let cancelled = false;
    paletteForArt(albumArtUrl).then((p) => { if (!cancelled) setPalette(p); });
    return () => { cancelled = true; };
  }, [albumArtUrl]);
  const colours = paletteCss(palette);

  // The lite scene's backdrop: the cover, pre-blurred once
  const [backdrop, setBackdrop] = useState(null);
  useEffect(() => {
    if (useGl) return undefined;
    let cancelled = false;
    if (albumArtUrl) getBlurredBackdrop(albumArtUrl).then((url) => { if (!cancelled) setBackdrop({ art: albumArtUrl, url }); });
    return () => { cancelled = true; };
  }, [albumArtUrl, useGl]);
  const backdropUrl = backdrop?.art === albumArtUrl ? backdrop.url : null;

  // What the light breathes to: the song's tempo, or this computer's sound when chosen in Settings
  const soundSetting = playbackSettings?.zenSound === 'sound' && canHearComputer() ? 'sound' : 'tempo';
  // Kept with the id it belongs to, so a new song never breathes to the last one's tempo
  const [featuresFor, setFeaturesFor] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const id = currentTrack?.id;
    soundFeaturesFor(id).then((f) => { if (!cancelled) setFeaturesFor({ id, f }); });
    return () => { cancelled = true; };
  }, [currentTrack?.id]);
  const features = featuresFor && featuresFor.id === currentTrack?.id ? featuresFor.f : null;
  const listener = useRef(null);
  const [soundNote, setSoundNote] = useState('');
  useEffect(() => {
    if (soundSetting !== 'sound') return undefined;
    let stopped = false;
    hearComputer()
      .then((l) => { if (stopped) l.stop(); else listener.current = l; })
      .catch((err) => { log('zen', 'could not listen to the computer', err?.message); if (!stopped) setSoundNote(err?.name === 'NotAllowedError' ? 'Not listening: sharing was cancelled. Following the song’s tempo.' : (err?.message || 'Could not listen to this computer.')); });
    return () => { stopped = true; listener.current?.stop(); listener.current = null; };
  }, [soundSetting]);
  useEffect(() => {
    if (!soundNote) return undefined;
    const id = setTimeout(() => setSoundNote(''), 6000);
    return () => clearTimeout(id);
  }, [soundNote]);
  const pulse = useCallback((pos) => {
    if (listener.current) return { ...listener.current.level(), live: true };
    if (features?.tempo > 0) return { beat: beatAt(pos, features.tempo), energy: features.energy };
    return null;
  }, [features]);

  // Controls fade away while nobody is touching anything
  useEffect(() => {
    let timeout;
    const resetTimer = () => {
      setIsActive(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsActive(false), 3000);
    };
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(ev, resetTimer);
    resetTimer();
    return () => {
      for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart']) window.removeEventListener(ev, resetTimer);
      clearTimeout(timeout);
    };
  }, []);

  // Leaving is done in the cleanup: Zen unmounts the moment it closes, so an effect never sees
  // isZenMode turn false
  useEffect(() => {
    if (!isZenMode) return undefined;
    const wrapper = desktop();
    if (wrapper?.setZenFullscreen) {
      Promise.resolve(wrapper.setZenFullscreen(true)).catch(() => {});
      return () => { Promise.resolve(wrapper.setZenFullscreen(false)).catch(() => {}); };
    }
    if (IS_MAC) return undefined;
    document.documentElement.requestFullscreen().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, [isZenMode]);

  // Measure the full scene once it is up; a slow result switches to lite for good on this device
  useEffect(() => {
    if (!useGl || zenEffectsSetting() !== 'auto') return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      measureFrames().then((mean) => {
        if (cancelled || mean === null) return;
        if (mean > SLOW_FRAME_MS) { log('zen', 'slow frames; switching to the lite scene', `${mean.toFixed(1)}ms`); rememberLite(true); setLite(true); }
      });
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [useGl]);

  useEffect(() => {
    if (!usesRealFullscreen()) return undefined;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isZenMode) toggleZenMode();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isZenMode, toggleZenMode]);

  // Volume goes through the controller, the same as the player bar: it reaches whichever
  // device is playing
  const isRemote = Boolean(activeDevice) && !isLocalActive;
  const volumeValue = isRemote && remoteVolume !== null ? remoteVolume : savedVolume;
  const volumeSupported = !isRemote || activeDevice?.supportsVolume !== false;
  const applyVolume = (value) => {
    const clamped = Math.max(0, Math.min(100, value));
    if (clamped > 0) setPrevVolume(clamped);
    if (!isRemote) setSavedVolume(clamped);
    setPlaybackVolume(clamped);
  };
  const toggleMute = () => {
    if (!volumeSupported) return;
    if (volumeValue > 0) applyVolume(0);
    else applyVolume(prevVolume > 0 ? prevVolume : 50);
  };

  // Escape leaves Zen even when the browser refused fullscreen
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement && useUserStore.getState().isZenMode) toggleZenMode(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleZenMode]);

  useEffect(() => {
    if (!showLyrics || !currentTrack) return undefined;
    let isMounted = true;
    const stop = new AbortController();
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;
    const id = currentTrack.id;
    // the dots only for a lookup that is actually slow; a quick (or cached) one shows nothing
    const slow = setTimeout(() => { if (isMounted) setSlowLookup(id); }, 700);
    const fetchLyrics = async () => {
      let found = null;
      try { found = await findLyrics(currentTrack, trackDurationSec, { signal: stop.signal }); } catch { /* no lyrics: the cover keeps the stage */ }
      if (!isMounted) return;
      clearTimeout(slow);
      setLyricsAnswer({ id, synced: found?.synced || null, plain: found?.synced ? [] : (found?.plain || []) });
    };
    fetchLyrics();
    return () => { isMounted = false; clearTimeout(slow); stop.abort(); };
  // Keyed on the track id, not the track object or playbackState.duration: those change on every
  // position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, showLyrics]);

  const answered = lyricsAnswer.id === (currentTrack?.id || null);
  const syncedLyrics = answered ? lyricsAnswer.synced : null;
  const plainLyrics = answered ? lyricsAnswer.plain : [];
  const lyricsLoading = showLyrics && Boolean(currentTrack) && !answered && slowLookup === currentTrack?.id;
  const hasSynced = showLyrics && Boolean(syncedLyrics?.length);
  const hasPlain = showLyrics && !syncedLyrics && plainLyrics.length > 0;
  const noLyrics = showLyrics && answered && !hasSynced && !hasPlain;
  // while the next song's lyrics are on their way the stage keeps the shape it had
  // (the last answer, for the previous song, says what that shape was)
  const hadLyrics = Boolean(lyricsAnswer.synced?.length || lyricsAnswer.plain?.length);
  const split = showLyrics && (answered ? !noLyrics : lyricsLoading || hadLyrics);
  const linesKey = useMemo(() => `${trackId}:${syncedLyrics?.length || 0}:${syncedLyrics?.[0]?.timeMs ?? ''}`, [trackId, syncedLyrics]);

  const boxRef = useRef(null);
  const dotsRef = useRef(null);
  // A song with a scene of its own: the stage says when it is up ('scene'), when it is going
  // ('leaving') and when the usual layout is wanted again ('off')
  const [scenePhase, setScenePhase] = useState('off');
  const onScene = useCallback(({ phase }) => setScenePhase(phase), []);
  const onLine = useCallback((text) => setSungLine(text), []);
  const onFailed = useCallback((reason) => { log('zen', 'WebGL unavailable; using the plain scene', reason); setGlFailed(true); }, []);

  if (!room && !isZenMode) return null;
  // The projector takes the whole screen
  if (projecting) return <Projection onClose={() => setProjecting(false)} />;

  const idle = isActive || room ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none';
  const artists = currentTrack?.artists?.map((a) => a.name).join(', ') || '';
  // In a song's scene the cover, name and artist sit small at the bottom left, out of the room's
  // way, and the lyrics keep to the right, right-aligned
  const inScene = useGl && (scenePhase === 'scene' || scenePhase === 'leaving');

  return (
    <div
      className={room
        ? 'absolute inset-0 z-0 bg-black overflow-hidden select-none text-white'
        : `fixed inset-0 z-[100] bg-black overflow-hidden select-none font-sans text-white ${isActive ? '' : 'cursor-none'}`}
      style={{ '--zen-accent': colours.accent, '--zen-glow': colours.glow, fontFamily: room || inRoom ? 'var(--font-room)' : undefined }}
    >
      {useGl ? (
        <ZenStage
          lines={hasSynced ? syncedLyrics : null}
          linesKey={linesKey}
          showLyrics={hasSynced}
          palette={palette}
          paused={isPaused}
          pulse={pulse}
          character={features}
          boxRef={boxRef}
          dotsRef={dotsRef}
          onLine={onLine}
          onFailed={onFailed}
          reducedMotion={reducedMotion}
          track={room ? null : currentTrack}
          durationMs={playbackState?.duration || null}
          onScene={onScene}
          lyricAlign={inScene ? 'right' : 'left'}
        />
      ) : (
        <div className="absolute inset-0 pointer-events-none">
          {/* In the room the light has to reach every edge, under the layer and the strip; a
              contained square left black bands either side of a wide window and read as a box */}
          {backdropUrl && <div className={`zen-lite-drift absolute -inset-[30%] bg-center bg-no-repeat transition-opacity duration-1000 ${room ? 'bg-cover opacity-55' : 'bg-contain opacity-80'}`} style={{ backgroundImage: `url(${backdropUrl})` }} />}
          <div className={`absolute inset-0 ${room ? 'bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.6)_100%)]' : 'bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]'}`} />
        </div>
      )}

      {/* Up from black */}
      <motion.div aria-hidden="true" className="absolute inset-0 z-[5] bg-black pointer-events-none" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.3 : 1.6, ease: 'easeOut' }} />

      {(room || roomGhost) && (
        <div style={cross ? fade(roomGhost) : undefined} className={cross ? '' : 'contents'}>
        {/* The room's layout (DESIGN.md §5): art, the song with the lyrics between its name and the
           controls, the queue column. At half the art goes and the rest moves beside the layer; at
           full the room leaves and the Room's strip stands in. One tempo for all of it. */}
        <main
          className={roomLayout === 'full'
            ? 'absolute right-0 top-0 z-10 flex h-full w-[24%] flex-col px-8 py-8'
            : 'relative z-10 flex h-full w-full items-center gap-[4%]'}
          style={roomLayout === 'full' ? undefined : { paddingLeft: roomLayout === 'half' ? 'calc(58px + 300px + 4%)' : (inRoom && !zenGhost ? 'calc(58px + 4%)' : '5%'), paddingRight: '5%' }}
        >
          {/* Every part carries `layout`: when the layout changes (rest, half, full) the parts
              measure their old and new places and travel between them, so the art, the song, the
              lyrics, the controls, the progress and the queue all move as one. Nothing here is
              transitioned by CSS, which would fight that measurement. */}
          <section className="shrink-0" style={{ width: roomLayout === 'full' ? 'min(100%, 24vh)' : roomLayout === 'half' ? '24%' : '33%' }}>
            {currentTrack && (
              <motion.div
                layout
                transition={ROOM_LAYOUT}
                className="relative aspect-square w-full"
                // at full the cover is the handle: dragged onto a target in Unadded, it files the song
                draggable={roomLayout === 'full'}
                data-control={roomLayout === 'full' ? '' : undefined}
                onDragStart={roomLayout === 'full' ? (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TRACK_DRAG_TYPE, currentTrack.uri); e.dataTransfer.setData('text/plain', currentTrack.uri); } : undefined}
              >
              {/* a change of song crossfades: the old cover fades and lifts away as the new one
                  settles in (or flies in from the queue) */}
              <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={trackId} className="relative aspect-square w-full" initial={flying ? { opacity: 1 } : reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.03 }} transition={{ duration: 0.9, ease: EASE }}>
                <div ref={flyRef} className="absolute inset-0">
                  <img src={albumArtUrl} alt="" draggable="false" className="absolute inset-0 h-full w-full rounded-[6px] object-cover shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9)]" style={{ animation: reducedMotion ? 'none' : 'room-breathe 9s ease-in-out infinite' }} />
                </div>
              </motion.div>
              </AnimatePresence>
              </motion.div>
            )}
          </section>
          <section className={roomLayout === 'full' ? 'mt-4 min-w-0 shrink-0' : 'min-w-0 flex-1'}>
            {currentTrack ? (
              <motion.div layout="position" transition={ROOM_LAYOUT} className="relative">
              <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={trackId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.35, ease: EASE } }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}>
                <h1 className="m-0 font-semibold leading-none tracking-[-0.025em] [text-wrap:balance]" style={{ fontSize: roomLayout === 'full' ? 17 : roomLayout === 'half' ? 26 : 36, transition: 'font-size var(--room-slow) var(--room-ease)' }}>{currentTrack.name}</h1>
                <Artists artists={currentTrack?.artists} className={`room-mono block text-[var(--room-dim)] ${roomLayout === 'full' ? 'mt-1.5' : 'mt-3'}`} />
                {requestedByGuest && <p className="room-mono mt-2 text-[var(--room-faint)]">Requested by {requestedByGuest}</p>}
              </motion.div>
              </AnimatePresence>
              </motion.div>
            ) : (
              <p className="room-mono text-[var(--room-faint)]">Waiting for music</p>
            )}
            {/* the lyrics, between the song and the controls; the stage draws into this box */}
            <motion.div
              layout
              transition={ROOM_LAYOUT}
              ref={roomGhost ? undefined : boxRef}
              aria-label="Lyrics"
              className="relative overflow-hidden"
              style={{ height: split ? (roomLayout === 'full' ? '24vh' : roomLayout === 'half' ? '22vh' : '26vh') : 0, marginTop: split ? (roomLayout === 'full' ? 14 : 28) : 0, }}
            >
              <p className="sr-only" aria-live="off">{sungLine || ''}</p>
              {hasPlain && split && <ZenPlainLyrics lines={plainLyrics} />}
              {hasSynced && !useGl && split && <ZenFocusLyricsLite lines={syncedLyrics} />}
              <div ref={roomGhost ? undefined : dotsRef} aria-hidden="true" className="absolute left-0 top-1/2 flex -translate-y-1/2 gap-3 transition-opacity duration-700" style={{ opacity: 0 }}>
                {[0, 1, 2].map((k) => <span key={k} className="zen-dot h-3.5 w-3.5 rounded-full bg-white" style={{ '--k': k }} />)}
              </div>
              {lyricsLoading && <div className="absolute left-0 top-1/2 flex -translate-y-1/2 gap-3" aria-label="Finding the lyrics">{[0, 1, 2].map((k) => <span key={k} className="h-3 w-3 animate-pulse rounded-full bg-white/40" style={{ animationDelay: `${k * 200}ms` }} />)}</div>}
            </motion.div>
            {noLyrics && <p className="room-mono mt-4 text-[var(--room-faint)]">No lyrics for this one</p>}
            <div className={`flex flex-wrap items-center ${roomLayout === 'full' ? 'mt-4 gap-3' : 'mt-7 gap-6'}`} data-control>
              <motion.div layout="position" transition={ROOM_LAYOUT} className={`flex items-center ${roomLayout === 'full' ? 'gap-3' : 'gap-6'}`}>
              <button onClick={previousTrack} aria-label="Previous" className="room-press text-[var(--room-dim)] transition-colors hover:text-[var(--room-paper)]"><SkipBack className="h-5 w-5" /></button>
              <button onClick={togglePlay} aria-label={isPaused ? 'Play' : 'Pause'} className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--room-paper)] text-[#0a0810] transition-transform hover:scale-105 active:scale-90">
                {isPaused ? <Play key="play" className="room-turn ml-0.5 h-[18px] w-[18px] fill-current" /> : <Pause key="pause" className="room-turn h-[18px] w-[18px] fill-current" />}
              </button>
              <button onClick={nextTrack} aria-label="Next" className="room-press text-[var(--room-dim)] transition-colors hover:text-[var(--room-paper)]"><SkipForward className="h-5 w-5" /></button>
              </motion.div>
              <motion.span layout="position" transition={ROOM_LAYOUT} className={`flex items-center ${roomLayout === 'full' ? 'gap-3' : 'gap-6'}`} style={quiet}>
              {currentTrack?.id && <span className="room-like flex items-center [&_button]:p-0 [&_svg]:h-[17px] [&_svg]:w-[17px]"><LikeButton trackId={currentTrack.id} /></span>}
              <button onClick={() => setShowLyrics(!showLyrics)} aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'} aria-pressed={showLyrics} className={`transition-colors ${roomLayout === 'full' ? '' : 'ml-2'} ${showLyrics ? 'text-[var(--room-paper)]' : 'text-[var(--room-faint)] hover:text-[var(--room-dim)]'}`}><Mic2 className="h-[17px] w-[17px]" /></button>
              <button onClick={toggleMute} disabled={!volumeSupported} aria-label={volumeValue === 0 ? 'Unmute' : 'Mute'} className="text-[var(--room-faint)] transition-colors hover:text-[var(--room-dim)] disabled:opacity-40">{volumeValue === 0 ? <VolumeX className="h-[17px] w-[17px]" /> : <Volume2 className="h-[17px] w-[17px]" />}</button>
              <input type="range" min="0" max="100" value={volumeValue} onChange={(e) => applyVolume(parseInt(e.target.value, 10))} disabled={!volumeSupported} aria-label="Volume" className="zen-range w-20" style={{ '--v': `${volumeValue}%` }} />
              </motion.span>
            </div>
            <motion.div layout="position" transition={ROOM_LAYOUT} className={roomLayout === 'full' ? 'mt-4' : 'mt-7'} style={quiet} data-control><ZenProgress /></motion.div>
          </section>
          <motion.aside ref={roomGhost ? undefined : asideRef} layout="position" transition={ROOM_LAYOUT} className={roomLayout === 'full' ? 'mt-6 min-h-0 w-full flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_85%,transparent)]' : 'shrink-0 self-center'} style={roomLayout === 'full' ? quiet : { ...quiet, width: roomLayout === 'half' ? '30%' : '23%' }}>
            {roomLayout === 'full' && aside ? cloneElement(aside, { maxRows: asideRows }) : aside}
          </motion.aside>
        </main>
        </div>
      )}
      {(!room || zenGhost) && (
      <div style={cross ? fade(zenGhost) : undefined} className={cross ? '' : 'contents'}>
      <main className={`relative z-10 h-full w-full flex items-center ${inScene ? 'justify-end' : split ? 'justify-start' : 'justify-center'} px-[6vw] pt-[6vh] pb-[18vh] gap-[5vw]`}>
        {!inScene && <motion.section layout transition={reducedMotion ? { duration: 0 } : GLIDE} className="shrink-0 flex flex-col items-center" style={{ width: split ? 'min(30vw, 44vh)' : 'min(34vw, 50vh)' }}>
          <AnimatePresence mode="popLayout" initial>
            {currentTrack ? (
              <motion.div
                key={trackId}
                className="w-full flex flex-col items-center"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -18, filter: 'blur(14px)' }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.25 }}
              >
                {/* The same cover, by layoutId, glides to the caption when a song's scene comes up */}
                <motion.div layoutId={zenGhost ? undefined : "zen-cover"} className="relative w-full aspect-square">
                  <img src={albumArtUrl} alt="" draggable="false" className="absolute inset-0 w-full h-full object-cover rounded-[22px] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85),0_0_120px_-10px_var(--zen-glow)] transition-shadow duration-1000" />
                  {/* The light catching the cover is the scene's light, so it takes the cover's colour */}
                  <div aria-hidden="true" className="absolute inset-0 rounded-[22px] pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--zen-accent) 26%, transparent)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--zen-accent) 38%, transparent) 0%, color-mix(in srgb, var(--zen-accent) 9%, transparent) 28%, transparent 46%)' }} />
                </motion.div>
                <motion.div className="relative z-10 mt-10 w-full text-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.55 }}>
                  <h1 className={`font-semibold tracking-[-0.015em] leading-tight [text-wrap:balance] drop-shadow-[0_2px_30px_rgba(0,0,0,0.6)] ${split ? 'text-3xl' : 'text-4xl md:text-5xl'}`}>{currentTrack.name}</h1>
                  <motion.p className="mt-3 text-[13px] font-semibold uppercase tracking-[0.38em] text-[var(--zen-accent)] [text-shadow:0_0_18px_var(--zen-glow)] transition-colors duration-1000" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.8 }}>{artists}</motion.p>
                  {requestedByGuest && <p className="mt-2.5 text-xs uppercase tracking-[0.2em] text-white/50">Requested by {requestedByGuest}</p>}
                  <AnimatePresence>
                    {noLyrics && <motion.p key="none" className="mt-4 text-xs uppercase tracking-[0.25em] text-white/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>No lyrics for this one</motion.p>}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            ) : (
              <motion.p key="waiting" className="text-white/40 text-lg tracking-[0.2em] uppercase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Waiting for music</motion.p>
            )}
          </AnimatePresence>
        </motion.section>}

        {/* popLayout: a closing lyrics panel leaves the layout at once and fades where it was, so the
            cover glides to its final place in one move. Kept in the layout, the panel held its
            space until it had faded, and the cover jumped the rest of the way when it went. */}
        <AnimatePresence mode="popLayout">
          {split && (
            <motion.section
              key="lyrics"
              ref={zenGhost ? undefined : boxRef}
              aria-label="Lyrics"
              className={`relative flex-1 h-[58vh] ${inScene ? 'max-w-[560px] text-right' : 'max-w-[820px]'}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
            >
              {hasPlain && <ZenPlainLyrics lines={plainLyrics} />}
              {hasSynced && !useGl && <ZenFocusLyricsLite lines={syncedLyrics} />}
              {hasSynced && useGl && (
                <>
                  <p className="sr-only" aria-live="off">{sungLine || ''}</p>
                  <div ref={zenGhost ? undefined : dotsRef} aria-hidden="true" className={`absolute ${inScene ? 'right-0' : 'left-0'} top-1/2 -translate-y-1/2 flex gap-3 transition-opacity duration-700`} style={{ opacity: 0 }}>
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="zen-dot w-3.5 h-3.5 rounded-full bg-white" style={{ '--k': k }} />
                    ))}
                  </div>
                </>
              )}
              {lyricsLoading && <div className={`absolute ${inScene ? 'right-0' : 'left-0'} top-1/2 -translate-y-1/2 flex gap-3`} aria-label="Finding the lyrics">{[0, 1, 2].map((k) => <span key={k} className="w-3 h-3 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: `${k * 200}ms` }} />)}</div>}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
      </div>
      )}

      {/* In a scene, the cover, name and artist keep to the bottom left, out of the room's way */}
      <AnimatePresence>
        {inScene && currentTrack && (
          <motion.div key={`caption-${trackId}`} className="absolute left-[6vw] bottom-[17vh] z-10 max-w-[38vw]" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.9, ease: EASE }}>
            <motion.div layoutId="zen-cover" className="relative mb-5 aspect-square" style={{ width: 'min(13vw, 19vh)' }}>
              <img src={albumArtUrl} alt="" draggable="false" className="absolute inset-0 w-full h-full object-cover rounded-[14px] shadow-[0_24px_50px_-16px_rgba(0,0,0,0.85)]" />
            </motion.div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-[-0.015em] leading-tight [text-wrap:balance] drop-shadow-[0_2px_30px_rgba(0,0,0,0.7)]">{currentTrack.name}</h1>
            <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.38em] text-[var(--zen-accent)] [text-shadow:0_0_18px_var(--zen-glow)]">{artists}</p>
            {requestedByGuest && <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/50">Requested by {requestedByGuest}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {!room && <motion.div className="absolute inset-0 z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 1.1 }}>
        <button
          onClick={toggleZenMode}
          aria-label="Leave Zen mode"
          title="Leave Zen mode (Esc)"
          className={`absolute top-8 right-9 w-11 h-11 rounded-full grid place-items-center bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] text-white/70 hover:text-white hover:bg-white/10 transition-all duration-700 ${idle}`}
        >
          <Minimize2 className="w-[18px] h-[18px]" />
        </button>

        <div className={`absolute left-1/2 bottom-[58px] -translate-x-1/2 flex items-center gap-7 px-6 py-3 rounded-full bg-gradient-to-b from-white/[0.09] to-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),inset_0_1px_0_rgba(255,255,255,0.18),0_20px_50px_-10px_rgba(0,0,0,0.6)] transition-all duration-700 ${idle} ${isActive ? 'translate-y-0' : 'translate-y-3'}`}>
          <button onClick={previousTrack} aria-label="Previous" className="text-white/75 hover:text-white hover:scale-110 active:scale-95 transition-all">
            <SkipBack className="w-5 h-5" />
          </button>
          <button onClick={togglePlay} aria-label={playbackState?.paused ? 'Play' : 'Pause'} className="w-14 h-14 rounded-full bg-white text-[#0a0810] grid place-items-center shadow-[0_0_40px_var(--zen-glow),0_0_0_6px_rgba(255,255,255,0.06)] hover:scale-105 active:scale-95 transition-all">
            {isPaused ? <Play className="w-5 h-5 fill-current ml-0.5" /> : <Pause className="w-5 h-5 fill-current" />}
          </button>
          <button onClick={nextTrack} aria-label="Next" className="text-white/75 hover:text-white hover:scale-110 active:scale-95 transition-all">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className={`absolute left-[12%] right-[12%] bottom-6 transition-opacity duration-700 ${idle}`}>
          <ZenProgress />
        </div>

        <div className={`absolute right-10 bottom-[52px] flex items-center gap-4 transition-opacity duration-700 ${isActive ? 'opacity-60 hover:opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
            aria-pressed={showLyrics}
            className={`transition-colors ${showLyrics ? 'text-[var(--zen-accent)] drop-shadow-[0_0_6px_var(--zen-glow)]' : 'text-white hover:text-white'}`}
          >
            <Mic2 className="w-[18px] h-[18px]" />
          </button>
          <button onClick={() => setProjecting(true)} aria-label="Projector" title="Projector: map the music onto a wall (P)" className="text-white">
            <Projector className="w-[18px] h-[18px]" />
          </button>
          <button onClick={toggleMute} disabled={!volumeSupported} aria-label={volumeValue === 0 ? 'Unmute' : 'Mute'} className="text-white disabled:opacity-40">
            {volumeValue === 0 ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volumeValue}
            onChange={(e) => applyVolume(parseInt(e.target.value, 10))}
            disabled={!volumeSupported}
            aria-label="Volume"
            className="zen-range w-20"
            style={{ '--v': `${volumeValue}%` }}
          />
        </div>

        <AnimatePresence>
          {soundNote && (
            <motion.p key="note" role="status" className="absolute right-10 bottom-24 max-w-xs text-right text-xs text-white/60" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{soundNote}</motion.p>
          )}
        </AnimatePresence>
      </motion.div>}
    </div>
  );
}
