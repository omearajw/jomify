import { useUserStore } from '../../store/userStore';

// Zen mode's scene is expensive to composite: blended full-screen layers, blurred text, layers
// that never stop moving. A machine with a working GPU draws it at full rate; one without (or
// Chrome on Windows falling back to software compositing) crawls at a few frames a second and
// everything in the app lags with it. So the scene measures itself when it opens and drops to a
// lighter version that keeps the look, and remembers the answer for this device.

const REMEMBER_KEY = 'jomify_zen_lite';
export const SLOW_FRAME_MS = 24; // under ~40fps the full scene is costing more than it gives
const SAMPLE_MS = 2000;

export const zenEffectsSetting = () => useUserStore.getState().playbackSettings?.zenEffects || 'auto';

export function rememberedLite() {
  try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; }
}
export function rememberLite(value) {
  try { if (value) localStorage.setItem(REMEMBER_KEY, '1'); else localStorage.removeItem(REMEMBER_KEY); } catch { /* fine */ }
}

// What to start with: the setting wins; on auto, whatever this device measured last time
export function initialLite() {
  const setting = zenEffectsSetting();
  if (setting === 'lite') return true;
  if (setting === 'full') return false;
  return rememberedLite();
}

// Mean frame gap over a short window, in ms; resolves early with null if the page is hidden
export function measureFrames(ms = SAMPLE_MS) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function' || document.hidden) { resolve(null); return; }
    const gaps = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve(gaps.length > 5 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null);
    };
    requestAnimationFrame(tick);
  });
}
