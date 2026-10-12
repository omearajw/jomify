import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { FALLBACK_PALETTE, paletteCss, paletteForArt } from './palette';
import { beatAt, canHearComputer, hearComputer, trackFeatures } from './zenPulse';
import { usePartyStore } from '../../store/partyStore';
import { requestedBy } from '../../party/view';
import { log } from '../../services/debugLog';
import { initialLite, measureFrames, rememberLite, zenEffectsSetting, SLOW_FRAME_MS } from './zenEffects';

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
// The cover's reflection fades away from the cover (it is flipped, so 'to top' runs downwards on
// screen) and towards both sides
const REFLECTION_MASK = 'linear-gradient(to top, black, transparent 28%), linear-gradient(90deg, transparent, black 22%, black 78%, transparent)';
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

export default function ZenMode() {
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
  const [projecting, setProjecting] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) setProjecting((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Remembered with the other playback settings, so Zen opens the way it was left
  const showLyrics = Boolean(playbackSettings?.zenLyrics);
  const setShowLyrics = (on) => setPlaybackSetting('zenLyrics', Boolean(on));
  const [plainLyrics, setPlainLyrics] = useState([]);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [sungLine, setSungLine] = useState(null);

  const currentTrack = playbackState?.track_window?.current_track;
  const partyHistory = usePartyStore((st) => st.history);
  const partyUpNext = usePartyStore((st) => st.upNext);
  const requestedByGuest = requestedBy(currentTrack, { history: partyHistory, upNext: partyUpNext });
  const isPaused = playbackState ? playbackState.paused : true;
  const albumArtUrl = currentTrack?.album?.images?.[0]?.url || '';
  const trackId = currentTrack?.id || 'empty';

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
    trackFeatures(id).then((f) => { if (!cancelled) setFeaturesFor({ id, f }); });
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
    if (features) return { beat: beatAt(pos, features.tempo), energy: features.energy };
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
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) toggleZenMode(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleZenMode]);

  useEffect(() => {
    if (!showLyrics || !currentTrack) return undefined;
    let isMounted = true;
    const stop = new AbortController();
    const trackDurationSec = playbackState?.duration ? playbackState.duration / 1000 : null;
    const fetchLyrics = async () => {
      setSyncedLyrics(null);
      setPlainLyrics([]);
      setLyricsLoading(true);
      try {
        const found = await findLyrics(currentTrack, trackDurationSec, { signal: stop.signal });
        if (!isMounted) return;
        if (found.synced) setSyncedLyrics(found.synced);
        else setPlainLyrics(found.plain);
      } catch { /* no lyrics: the cover keeps the stage */ } finally {
        if (isMounted) setLyricsLoading(false);
      }
    };
    fetchLyrics();
    return () => { isMounted = false; stop.abort(); };
  // Keyed on the track id, not the track object or playbackState.duration: those change on every
  // position tick and would refetch lyrics several times a second
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, showLyrics]);

  const hasSynced = showLyrics && Boolean(syncedLyrics?.length);
  const hasPlain = showLyrics && !syncedLyrics && plainLyrics.length > 0;
  const noLyrics = showLyrics && !lyricsLoading && !hasSynced && !hasPlain;
  const split = showLyrics && !noLyrics;
  const linesKey = useMemo(() => `${trackId}:${syncedLyrics?.length || 0}:${syncedLyrics?.[0]?.timeMs ?? ''}`, [trackId, syncedLyrics]);

  const boxRef = useRef(null);
  const dotsRef = useRef(null);
  const onLine = useCallback((text) => setSungLine(text), []);
  const onFailed = useCallback((reason) => { log('zen', 'WebGL unavailable; using the plain scene', reason); setGlFailed(true); }, []);

  if (!isZenMode) return null;
  // The projector takes the whole screen
  if (projecting) return <Projection onClose={() => setProjecting(false)} />;

  const idle = isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none';
  const artists = currentTrack?.artists?.map((a) => a.name).join(', ') || '';

  return (
    <div
      className={`fixed inset-0 z-[100] bg-black overflow-hidden select-none font-sans text-white ${isActive ? '' : 'cursor-none'}`}
      style={{ '--zen-accent': colours.accent, '--zen-glow': colours.glow }}
    >
      {useGl ? (
        <ZenStage
          lines={hasSynced ? syncedLyrics : null}
          linesKey={linesKey}
          showLyrics={hasSynced}
          palette={palette}
          paused={isPaused}
          pulse={pulse}
          boxRef={boxRef}
          dotsRef={dotsRef}
          onLine={onLine}
          onFailed={onFailed}
          reducedMotion={reducedMotion}
        />
      ) : (
        <div className="absolute inset-0 pointer-events-none">
          {backdropUrl && <div className="absolute -inset-[30%] bg-contain bg-center bg-no-repeat opacity-80 transition-opacity duration-1000" style={{ backgroundImage: `url(${backdropUrl})` }} />}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />
        </div>
      )}

      {/* Up from black */}
      <motion.div aria-hidden="true" className="absolute inset-0 z-[5] bg-black pointer-events-none" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.3 : 1.6, ease: 'easeOut' }} />

      <main className={`relative z-10 h-full w-full flex items-center ${split ? 'justify-start' : 'justify-center'} px-[6vw] pt-[6vh] pb-[18vh] gap-[5vw]`}>
        <motion.section layout transition={reducedMotion ? { duration: 0 } : GLIDE} className="shrink-0 flex flex-col items-center" style={{ width: split ? 'min(30vw, 44vh)' : 'min(34vw, 50vh)' }}>
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
                <div className="relative w-full aspect-square">
                  {/* The ground the cover stands on, so its reflection has somewhere to be: a pool of
                      the cover's own light spreading out underneath, and a faint horizon where they meet */}
                  <div aria-hidden="true" className="absolute left-1/2 top-full w-[190%] h-[60%] -translate-x-1/2 -translate-y-[38%] pointer-events-none" style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--zen-accent) 26%, transparent), color-mix(in srgb, var(--zen-accent) 9%, transparent) 55%, transparent)' }} />
                  <div aria-hidden="true" className="absolute top-full -left-[18%] -right-[18%] h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--zen-accent) 35%, transparent) 25%, color-mix(in srgb, var(--zen-accent) 70%, transparent) 50%, color-mix(in srgb, var(--zen-accent) 35%, transparent) 75%, transparent)', boxShadow: '0 0 12px 0 color-mix(in srgb, var(--zen-accent) 30%, transparent)' }} />
                  <img src={albumArtUrl} alt="" draggable="false" className="absolute inset-0 w-full h-full object-cover rounded-[22px] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85),0_0_120px_-10px_var(--zen-glow)] transition-shadow duration-1000" />
                  {/* The light catching the cover is the scene's light, so it takes the cover's colour */}
                  <div aria-hidden="true" className="absolute inset-0 rounded-[22px] pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--zen-accent) 26%, transparent)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--zen-accent) 38%, transparent) 0%, color-mix(in srgb, var(--zen-accent) 9%, transparent) 28%, transparent 46%)' }} />
                  {/* Its reflection in that ground: soft, fading down and out to the sides, so it melts
                      into the floor instead of hanging under the cover as a second, greyer slab */}
                  <img src={albumArtUrl} alt="" aria-hidden="true" draggable="false" className="absolute left-0 top-full mt-0.5 w-full h-full object-cover rounded-[22px] -scale-y-100 opacity-[0.22] blur-[3px] pointer-events-none" style={{ maskImage: REFLECTION_MASK, WebkitMaskImage: REFLECTION_MASK, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }} />
                </div>
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
        </motion.section>

        <AnimatePresence>
          {split && (
            <motion.section
              key="lyrics"
              ref={boxRef}
              aria-label="Lyrics"
              className="relative flex-1 max-w-[820px] h-[58vh]"
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
                  <div ref={dotsRef} aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-3 transition-opacity duration-700" style={{ opacity: 0 }}>
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="zen-dot w-3.5 h-3.5 rounded-full bg-white" style={{ '--k': k }} />
                    ))}
                  </div>
                </>
              )}
              {lyricsLoading && <div className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-3" aria-label="Finding the lyrics">{[0, 1, 2].map((k) => <span key={k} className="w-3 h-3 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: `${k * 200}ms` }} />)}</div>}
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <motion.div className="absolute inset-0 z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 1.1 }}>
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
      </motion.div>
    </div>
  );
}
