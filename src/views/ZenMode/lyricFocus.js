// Which lyric lines Zen shows, and where. Zen gives each line the stage to itself: the line being
// sung large, the one before small above it and the one after small below. Pure functions, so
// the timing can be tested without a screen.

import { LYRIC_LEAD_IN_MS } from '../../lib/lrc.js';

export const isInstrumental = (line) => !line?.text || line.text.trim() === '♪' || /instrumental/i.test(line.text);

// Without word timings, the fill is paced to the line's length and finishes before the next line
const FILL_MS_PER_CHAR = 85;
const FILL_MIN_MS = 800;

// The line being sung right now, counting the lead-in, or -1 before the first
export function lineAt(lines, posMs) {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= posMs + LYRIC_LEAD_IN_MS) found = i;
    else break;
  }
  return found;
}

const nextSung = (lines, from) => { for (let i = from; i < lines.length; i++) if (!isInstrumental(lines[i])) return i; return null; };
const prevSung = (lines, from) => { for (let i = from; i >= 0; i--) if (!isInstrumental(lines[i])) return i; return null; };

// { current, prev, next } as indexes into lines (null when there is none), and gap: true before
// the first line and in instrumental breaks, when the stage waits for the next line. gapProgress
// runs 0 to 1 across the wait, for the dots.
// A line with an end time stops being current this long after it, if the next is still far off
const LINGER_MS = 2500;
const LONG_GAP_MS = 7000;

export function focusAt(lines, posMs) {
  const at = lineAt(lines, posMs);
  const after = at >= 0 && lines[at].endMs ? posMs - lines[at].endMs : -Infinity;
  const nextStart = lines[at + 1]?.timeMs ?? Infinity;
  const silent = after > LINGER_MS && nextStart - lines[at]?.endMs > LONG_GAP_MS;
  if (at >= 0 && !isInstrumental(lines[at]) && !silent) {
    return { current: at, prev: prevSung(lines, at - 1), next: nextSung(lines, at + 1), gap: false, gapProgress: 0 };
  }
  const next = nextSung(lines, at + 1);
  const from = at >= 0 ? (silent ? lines[at].endMs + LINGER_MS : lines[at].timeMs) : 0;
  const until = next !== null ? lines[next].timeMs - LYRIC_LEAD_IN_MS : from;
  const gapProgress = until > from ? Math.max(0, Math.min(1, (posMs - from) / (until - from))) : 1;
  return { current: null, prev: prevSung(lines, at), next, gap: true, gapProgress };
}

// How much of line i has been sung, 0 to 1
export function fillProgress(lines, i, posMs) {
  if (i === null || i < 0 || !lines[i]) return 0;
  const start = lines[i].timeMs - LYRIC_LEAD_IN_MS;
  const gap = (lines[i + 1]?.timeMs ?? Infinity) - lines[i].timeMs - 150;
  const ms = Math.max(300, Math.min(Math.max(FILL_MIN_MS, lines[i].text.length * FILL_MS_PER_CHAR), gap));
  const p = Math.max(0, Math.min(1, (posMs - start) / ms));
  // A gentle ease out: quick through the first words, settling into the last
  return 1 - Math.pow(1 - p, 1.7);
}

// With word timings: how far along the line the light should be, as a fraction of its reading
// order. stops[k] is where word k starts and ends along the line (from makeLine). Between words
// the light rests at the end of the last one sung; through a word it eases out across it.
export function wordFill(words, stops, posMs) {
  if (!words?.length || !stops?.length) return null;
  let at = 0;
  for (let k = 0; k < words.length && k < stops.length; k++) {
    const w = words[k];
    if (posMs < w.startMs) return at;
    const span = Math.max(1, w.endMs - w.startMs);
    const p = Math.min(1, (posMs - w.startMs) / span);
    at = stops[k].from + (stops[k].to - stops[k].from) * (1 - Math.pow(1 - p, 1.4));
    if (p < 1) return at;
    at = stops[k].to;
  }
  return 1;
}

// Where each visible line should be. A line has two faces: big (the line being sung, glass) and
// small (the lines either side, soft, laid out at their own size so they keep to one or two rows).
// Moving between roles is a cross-dissolve of the two faces as they travel. blocks maps
// "index:big" / "index:small" to text block sizes; box is the lyric area. Returns targets keyed the
// same way, in the units of box.
export const SMALL_RATIO = 0.4;
export const faceKey = (index, face) => `${index}:${face}`;
export function layoutFocus({ focus, blocks, box, big }) {
  const out = {};
  const gap = big * 0.55;
  const centreY = box.y + box.h / 2;
  const cur = focus.current;
  const curH = cur !== null && blocks[faceKey(cur, 'big')] ? blocks[faceKey(cur, 'big')].h : big * 1.1;
  const curTop = centreY - curH / 2;
  const curBottom = curTop + curH;
  const smallH = (i) => blocks[faceKey(i, 'small')]?.h ?? big * SMALL_RATIO * 1.1;
  if (cur !== null) out[faceKey(cur, 'big')] = { x: box.x, y: curTop, scale: 1, alpha: 1, glass: 1, halo: 1, litVisible: 1 };
  if (focus.prev !== null && focus.prev !== cur) {
    out[faceKey(focus.prev, 'small')] = { x: box.x, y: curTop - gap - smallH(focus.prev), scale: 1, alpha: 1, glass: 0, halo: 0, litVisible: 0 };
  }
  if (focus.next !== null && focus.next !== cur) {
    out[faceKey(focus.next, 'small')] = { x: box.x, y: curBottom + gap, scale: 1, alpha: 1, glass: 0, halo: 0, litVisible: 0 };
  }
  return out;
}
