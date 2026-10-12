// What makes Zen's light breathe with the music. The page cannot hear Spotify (its player is a
// locked, copy-protected frame), so there are two sources:
//   tempo: the song's tempo and energy from ReccoBeats (src/services/soundFeatures). The light
//          swells on each beat of the song's real BPM, not locked to the exact beat.
//   sound: what this computer is playing, where the platform allows it: the desktop app (built-in
//          loopback; on macOS, the system picker and its one-time permission) or a Chromium
//          browser's share prompt with "Share system audio". Safari offers no audio at all.
// Both reduce to beat(positionMs) and energy, 0 to 1.

import { log } from '../../services/debugLog';

// A gentle swell at each beat, rising and falling smoothly (a sharp rise read as a flash)
export function beatAt(positionMs, tempo) {
  if (!tempo) return 0;
  const phase = ((positionMs / 60000) * tempo) % 1;
  return Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), 2);
}

export const canHearComputer = () => {
  if (typeof window === 'undefined') return false;
  if (window.jomifyDesktop?.hearsComputer) return true;
  // Safari has no "Chrome/" in its user agent; every Chromium browser does
  return Boolean(/(Chrome|Chromium)\//.test(navigator.userAgent || '') && navigator.mediaDevices?.getDisplayMedia);
};

// Listens to the computer. Resolves { level(), stop() } or rejects with a message for the user.
export async function hearComputer() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' });
  stream.getVideoTracks().forEach((t) => t.stop());
  const audio = stream.getAudioTracks();
  if (!audio.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No sound was shared. Choose the whole screen and turn on "Share system audio".');
  }
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream(audio));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  let slow = 0;
  log('zen', 'listening to the computer', audio[0].label);
  return {
    // The low end against its own running average: a kick lifts it, a steady drone does not
    level() {
      analyser.getByteFrequencyData(bins);
      let low = 0;
      for (let i = 1; i < 12; i++) low += bins[i];
      low /= 11 * 255;
      slow += (low - slow) * 0.02;
      return { beat: Math.max(0, Math.min(1, (low - slow) * 4)), energy: Math.min(1, low * 1.4) };
    },
    stop() {
      audio.forEach((t) => t.stop());
      ctx.close().catch(() => {});
    }
  };
}
