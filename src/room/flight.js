import { isSameTrack } from '../utils/spotifyUri';
import { log } from '../services/debugLog';

// The top song of the queue flying into the now-playing cover (Jack, 19 Oct: "when a song goes from
// the top of the queue to playing, there is a nice animation"). The queue moves on a moment before
// Spotify says the song has changed (it hands the next list over just before the end), so the
// two don't happen in one render: the queue row notes where its cover was as it leaves, and the
// now-playing cover, when it changes to that song, grows from there.

// eases out of the row and settles: the room's own curve front-loads the motion so much that a
// journey this long read as a pop
const EASE = 'cubic-bezier(0.5, 0, 0.15, 1)';
const FRESH_MS = 8000;
let pending = null; // { track, rect, at }

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function noteFlight(track, el) {
  if (!track || !el || reduced()) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return; // not on screen: nothing to fly from
  pending = { track, rect, at: Date.now() };
  log('anim', `${track.name} leaves the queue for the cover`);
}

// The cover that has just appeared for `track`: if it came from the queue, it flies in from there
// (a transform only, so it stays smooth on a phone). True when it did.
export function flyIn(el, track) {
  const f = pending;
  if (!el || !f || Date.now() - f.at > FRESH_MS || !isSameTrack(f.track, track)) return false;
  const to = el.getBoundingClientRect();
  // a cover not laid out (a second copy fading out, say) leaves the flight for the real one
  if (!to.width || !to.height) return false;
  pending = null;
  log('anim', `${track.name} flies into the cover`);
  const s = f.rect.width / to.width;
  el.animate([
    { transformOrigin: '0 0', transform: `translate(${f.rect.left - to.left}px, ${f.rect.top - to.top}px) scale(${s})`, opacity: 0.6 },
    { transformOrigin: '0 0', transform: 'translate(0, 0) scale(1)', opacity: 1 }
  ], { duration: 850, easing: EASE });
  return true;
}

export const flightWaiting = (track) => Boolean(pending && Date.now() - pending.at < FRESH_MS && isSameTrack(pending.track, track));
