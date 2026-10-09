import { useSyncExternalStore } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useUserStore } from '../store/userStore';
import { fetchAudioAnalysis } from '../services/spotify/api';
import { log } from '../services/debugLog';

// Where the waveform's bars come from. The music itself can't be read: Spotify's player plays
// DRM-protected audio inside its own frame, and browsers hand a page silence for protected media;
// when the music plays on another device there is no audio here at all. Two real sources remain:
//   - Spotify's analysis of the song (loudness and pitch, a few readings a second), drawn in
//     step with the playback position. Works whatever device is playing. Spotify withdrew it
//     for apps registered after November 2024, so it is asked for and a refusal remembered.
//   - The microphone, when the user switches it on: the real sound in the room, analysed here
//     and never recorded or sent.
// With neither, the waveform falls back to its animation.

export const MAX_BARS = 15;
const REFUSED_KEY = 'jomify_analysis_refused';
const REFUSED_FOR_MS = 24 * 3600 * 1000;
const STOP_AFTER_MS = 4000;

const setting = () => useUserStore.getState().playbackSettings?.waveform || 'auto';

// ---- who is listening, and which source feeds them ----------------------------------------

const frameSubs = new Set();
const sourceSubs = new Set();
let source = null; // 'analysis' | 'mic' | null
const setSource = (next) => { if (next !== source) { source = next; sourceSubs.forEach((fn) => fn()); } };

export function useWaveSource() {
  return useSyncExternalStore((fn) => { sourceSubs.add(fn); return () => sourceSubs.delete(fn); }, () => source, () => null);
}

// A waveform registers here while mounted; `onFrame(levels)` gets MAX_BARS values in 0..1
export function subscribeLevels(onFrame) {
  frameSubs.add(onFrame);
  wake();
  return () => { frameSubs.delete(onFrame); if (frameSubs.size === 0) scheduleStop(); };
}

// ---- Spotify's analysis --------------------------------------------------------------------

const analyses = new Map(); // track id -> { segments } | 'pending'
const failedAt = new Map();  // track id -> when a request for it last failed for a passing reason
const RETRY_AFTER_MS = 30000;
let lastTrackId = null;

// A refusal is Spotify's policy for the app, not a passing fault: remembered for a day, and read
// from storage once rather than on every frame
let refusedUntil = (() => { try { return Number(localStorage.getItem(REFUSED_KEY) || 0) + REFUSED_FOR_MS; } catch { return 0; } })();
const refusedRecently = () => Date.now() < refusedUntil;

// Keep what drawing needs: about a thousand segments a song, each a few numbers
function slim(raw) {
  const segments = (raw?.segments || []).map((s) => ({
    t: s.start, d: s.duration, l0: s.loudness_start, lm: s.loudness_max, lmt: s.loudness_max_time, p: s.pitches || []
  }));
  return segments.length ? { segments } : null;
}

async function loadAnalysis(trackId) {
  if (!trackId || analyses.has(trackId) || refusedRecently()) return;
  if (Date.now() - (failedAt.get(trackId) || 0) < RETRY_AFTER_MS) return;
  const token = useUserStore.getState().token;
  if (!token) return;
  analyses.set(trackId, 'pending');
  try {
    const data = slim(await fetchAudioAnalysis(token, trackId));
    if (!data) { analyses.delete(trackId); return; }
    analyses.set(trackId, data);
    if (analyses.size > 6) analyses.delete(analyses.keys().next().value);
    if (!loadAnalysis.announced) { loadAnalysis.announced = true; log('waveform', "Spotify shares its song analysis with Jomify: the waveform follows the song"); }
  } catch (err) {
    analyses.delete(trackId);
    failedAt.set(trackId, Date.now());
    if (err?.status === 403 || err?.status === 404 || err?.status === 410) {
      refusedUntil = Date.now() + REFUSED_FOR_MS;
      try { localStorage.setItem(REFUSED_KEY, String(Date.now())); } catch { /* fine */ }
      log('waveform', "Spotify won't share its song analysis with Jomify", `HTTP ${err.status}; the waveform is animated${setting() === 'mic' ? '' : ' unless the microphone is switched on in Settings'}`);
    }
  }
}

// Loudness at a moment, in dB: rising from the segment's start to its peak, then towards the next
function loudnessAt(segs, i, t) {
  const s = segs[i];
  const peakAt = s.t + (s.lmt || 0);
  if (t <= peakAt) return s.l0 + (s.lm - s.l0) * ((t - s.t) / Math.max(0.001, peakAt - s.t));
  const next = segs[i + 1];
  const end = s.t + s.d;
  const to = next ? next.l0 : s.l0;
  return s.lm + (to - s.lm) * Math.min(1, (t - peakAt) / Math.max(0.001, end - peakAt));
}

let segIndex = 0;
function analysisLevels(data, seconds, out) {
  const segs = data.segments;
  if (segIndex >= segs.length || segs[segIndex].t > seconds) segIndex = 0;
  while (segIndex < segs.length - 1 && segs[segIndex].t + segs[segIndex].d <= seconds) segIndex += 1;
  const s = segs[segIndex];
  const db = loudnessAt(segs, segIndex, seconds);
  // -45 dB is near silence for a mastered track, -3 dB about as loud as it gets
  const loud = Math.max(0, Math.min(1, (db + 45) / 42)) ** 1.5;
  for (let k = 0; k < MAX_BARS; k++) {
    const pitch = s.p[Math.floor((k * 12) / MAX_BARS)] ?? 0.5;
    const shape = 0.72 + 0.28 * Math.sin(Math.PI * ((k + 0.5) / MAX_BARS));
    out[k] = loud * (0.35 + 0.65 * pitch) * shape;
  }
  return out;
}

// ---- the microphone ------------------------------------------------------------------------

let mic = null; // { stream, ctx, analyser, data }
let micState = 'off'; // 'off' | 'starting' | 'on' | 'denied'

async function startMic() {
  if (micState === 'starting' || micState === 'on' || micState === 'denied') return;
  if (!navigator.mediaDevices?.getUserMedia) { micState = 'denied'; return; }
  micState = 'starting';
  try {
    // Raw sound: the voice processing a call wants would flatten the music
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // Browsers keep audio processing suspended until a click or key press, and this runs from the
    // drawing loop, not a click: waiting on resume() here waited for ever. It is resumed now if
    // allowed, else on the next click or key; until then the bars stay on their other source.
    const resume = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    const events = ['pointerdown', 'keydown', 'touchend'];
    events.forEach((ev) => document.addEventListener(ev, resume, { capture: true }));
    ctx.onstatechange = () => { if (ctx.state === 'running') log('waveform', 'listening through the microphone (analysed here, never recorded or sent)'); };
    mic = { stream, ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount), cleanup: () => events.forEach((ev) => document.removeEventListener(ev, resume, { capture: true })) };
    micState = 'on';
    resume();
    if (ctx.state === 'running') log('waveform', 'listening through the microphone (analysed here, never recorded or sent)');
  } catch (err) {
    micState = 'denied';
    log('waveform', 'the microphone was refused; the waveform uses the song analysis or its animation', err?.name || err?.message || String(err));
  }
}

function stopMic() {
  if (!mic) { if (micState !== 'denied') micState = 'off'; return; }
  mic.cleanup?.();
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
  micState = 'off';
}

// Bands spaced evenly in pitch, not frequency, from a bass note to the top of most music
function micLevels(out) {
  const { analyser, data, ctx } = mic;
  analyser.getByteFrequencyData(data);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const lo = Math.log(50);
  const hi = Math.log(9000);
  for (let k = 0; k < MAX_BARS; k++) {
    const from = Math.max(1, Math.floor(Math.exp(lo + ((hi - lo) * k) / MAX_BARS) / binHz));
    const to = Math.max(from + 1, Math.floor(Math.exp(lo + ((hi - lo) * (k + 1)) / MAX_BARS) / binHz));
    let peak = 0;
    for (let b = from; b < to && b < data.length; b++) peak = Math.max(peak, data[b]);
    out[k] = Math.min(1, (peak / 255) ** 1.6 * 1.25);
  }
  return out;
}

// ---- the loop ------------------------------------------------------------------------------

const target = new Array(MAX_BARS).fill(0);
const shown = new Array(MAX_BARS).fill(0);
let raf = 0;
let stopTimer = null;

function currentTrackId() {
  return usePlayerStore.getState().playbackState?.track_window?.current_track?.id || null;
}
function positionSeconds() {
  const { playbackState, positionAt } = usePlayerStore.getState();
  if (!playbackState) return 0;
  return (playbackState.position + (playbackState.paused ? 0 : Date.now() - positionAt)) / 1000;
}

function frame() {
  raf = 0;
  if (frameSubs.size === 0) return;
  const mode = setting();
  const paused = usePlayerStore.getState().playbackState?.paused !== false;
  const trackId = currentTrackId();
  if (trackId !== lastTrackId) { lastTrackId = trackId; segIndex = 0; }
  if (mode !== 'off' && trackId) loadAnalysis(trackId);
  if (mode === 'mic') startMic(); else if (mic) stopMic();

  const data = trackId ? analyses.get(trackId) : null;
  let next = null;
  if (mode === 'mic' && micState === 'on' && mic?.ctx.state === 'running') next = 'mic';
  else if (mode !== 'off' && data && data !== 'pending') next = 'analysis';
  setSource(next);

  if (next === 'mic') micLevels(target);
  else if (next === 'analysis' && !paused) analysisLevels(data, positionSeconds(), target);
  else target.fill(0);
  // Quick to rise, slower to fall, the way a meter reads
  for (let k = 0; k < MAX_BARS; k++) shown[k] = target[k] > shown[k] ? shown[k] + (target[k] - shown[k]) * 0.6 : shown[k] * 0.86 + target[k] * 0.14;
  frameSubs.forEach((fn) => { try { fn(shown); } catch { /* one waveform's problem */ } });
  raf = requestAnimationFrame(frame);
}

function wake() {
  clearTimeout(stopTimer);
  if (!raf) raf = requestAnimationFrame(frame);
}

function scheduleStop() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => { if (frameSubs.size === 0) { if (raf) cancelAnimationFrame(raf); raf = 0; stopMic(); } }, STOP_AFTER_MS);
}
