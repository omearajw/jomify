// The Virtual Insanity room's choreography, planned up front from the song's line times. The floor
// and what stands on it never move: the camera and the walls do, which is the video's trick. Every
// move ends with the two-seater square against a wall or square in the open, and a wall holds it
// while the room carries on. The whole schedule is built once from a seed, so a seek lands on the
// same room and the moves can be tested without a screen.

export const ROOM = { floor: 330, ceil: -640, wall: 900, back: -2300 };
export const SCALE = 0.95;
export const SOFAS = {
  loose: { W: 560, n: 2 },
  fixed: { W: 760, n: 3, view: { x: 520, z: ROOM.back + 150 }, yaw: 0 },
  big: { W: 860, n: 3, zIn: -720, zOut: 1250 }
};
const PIVOT = { x: 0, z: -1150 };
const MARGIN = 30;
const DEPTH = 150;

export const rad = (a) => (a * Math.PI) / 180;
export const toView = (p, g) => { const c = Math.cos(rad(g.a)), s = Math.sin(rad(g.a)); return { x: g.x + p.x * c - p.z * s, z: g.z + p.x * s + p.z * c }; };
export const toFloor = (v, g) => { const c = Math.cos(rad(-g.a)), s = Math.sin(rad(-g.a)); const dx = v.x - g.x, dz = v.z - g.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; };
// A sofa's half extents along the room's axes, for a heading
export const ext = (Wd, a) => { const c = Math.abs(Math.cos(rad(a))), s = Math.abs(Math.sin(rad(a))); return { x: (Wd * 0.5 * c + DEPTH * s) * SCALE, z: (Wd * 0.5 * s + DEPTH * c) * SCALE }; };
// Its four corners in view, standing at floor point f with its own yaw, for a pose of the world
export const corners = (f, yawW, Wd, g) => {
  const v = toView(f, g), a = rad(yawW + g.a), c = Math.cos(a), s = Math.sin(a), hw = Wd * 0.5 * SCALE, hd = DEPTH * SCALE;
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, j]) => ({ x: v.x + i * hw * c + j * hd * s, z: v.z - i * hw * s + j * hd * c }));
};
const inside = (pts, slack) => pts.every((q) => Math.abs(q.x) < ROOM.wall - slack && q.z > ROOM.back + slack);
// Do two footprints overlap? Separating axes of both rectangles
const axesOf = (pts) => [{ x: pts[1].x - pts[0].x, z: pts[1].z - pts[0].z }, { x: pts[2].x - pts[0].x, z: pts[2].z - pts[0].z }];
export function overlap(A, B, slack = 0) {
  for (const ax of [...axesOf(A), ...axesOf(B)]) {
    const len = Math.hypot(ax.x, ax.z) || 1, nx = ax.x / len, nz = ax.z / len;
    const pa = A.map((q) => q.x * nx + q.z * nz), pb = B.map((q) => q.x * nx + q.z * nz);
    if (Math.max(...pa) + slack < Math.min(...pb) || Math.max(...pb) + slack < Math.min(...pa)) return false;
  }
  return true;
}
const fixedBox = () => corners({ x: 0, z: 0 }, SOFAS.fixed.yaw, SOFAS.fixed.W, { ...SOFAS.fixed.view, a: 0 });
// Where the two-seater really stands for a pose of the world: its rigid place, held inside by the walls
export const pinned = (g) => { const e = ext(SOFAS.loose.W, g.a); return { x: Math.max(-ROOM.wall + e.x + 6, Math.min(ROOM.wall - e.x - 6, g.x)), z: Math.max(ROOM.back + e.z + 6, g.z), a: g.a }; };
const atSideWall = (g) => { const e = ext(SOFAS.loose.W, g.a); return Math.abs(g.x) >= ROOM.wall - e.x - MARGIN - 8; };

// The pose part way through a move: a turn about the room's middle and a slide, eased together,
// so every sofa arcs the same way
export function poseAt(e, from, to) {
  const da = to.a - from.a, a = from.a + da * e;
  const c = Math.cos(rad(da * e)), s = Math.sin(rad(da * e));
  const rx = PIVOT.x + (from.x - PIVOT.x) * c - (from.z - PIVOT.z) * s, rz = PIVOT.z + (from.x - PIVOT.x) * s + (from.z - PIVOT.z) * c;
  const cf = Math.cos(rad(da)), sf = Math.sin(rad(da));
  const ex = PIVOT.x + (from.x - PIVOT.x) * cf - (from.z - PIVOT.z) * sf, ez = PIVOT.z + (from.x - PIVOT.x) * sf + (from.z - PIVOT.z) * cf;
  return { x: rx + (to.x - ex) * e, z: rz + (to.z - ez) * e, a };
}
// Every move starts and ends at rest, like a set being pushed
const inOut = (pin, pout) => (u) => { const a = Math.pow(u, pin), b = Math.pow(1 - u, pout); return a / (a + b); };
export const EASES = [(u) => u * u * (3 - 2 * u), inOut(2.6, 1.8), (u) => u * u * u * (u * (6 * u - 15) + 10), inOut(1.8, 2.8)];

// Does a move keep every sofa in the room and clear of the others the whole way?
export function pathClear(from, to, big) {
  const fb = fixedBox();
  for (let i = 1; i <= 14; i++) {
    const g = poseAt(i / 14, from, to);
    const lp = corners({ x: 0, z: 0 }, 0, SOFAS.loose.W, pinned(g));
    if (overlap(lp, fb, 30)) return false;
    if (big) {
      const pts = corners(big.f, big.yawW, SOFAS.big.W, g);
      if (!inside(pts, 4) || !pts.every((q) => q.z < -120) || overlap(pts, fb, 30) || overlap(pts, lp, 30)) return false;
    }
  }
  return true;
}
// Where the two-seater may stand: against each wall facing the camera or into the room, or out
// in the open; and, with the big sofa in, on past a wall it is already against
function candidates(g, big, rnd) {
  const c = [], Wd = SOFAS.loose.W, e0 = ext(Wd, 0), e90 = ext(Wd, 90);
  for (const z of [-650, -1050, -1450, -1850]) {
    c.push({ x: -ROOM.wall + e0.x + MARGIN, z, a: 0 }, { x: ROOM.wall - e0.x - MARGIN, z, a: 0 });
    c.push({ x: -ROOM.wall + e90.x + MARGIN, z, a: 90 }, { x: ROOM.wall - e90.x - MARGIN, z, a: -90 });
  }
  for (const x of [-560, -260]) c.push({ x, z: ROOM.back + e0.z + MARGIN, a: 0 });
  for (const x of [-380, 60, 420]) for (const z of [-950, -1350]) { c.push({ x, z, a: 0 }); if (rnd() < 0.3) c.push({ x, z, a: x < 0 ? 90 : -90 }); }
  if (big) {
    const e = ext(Wd, g.a), atL = g.x <= -ROOM.wall + e.x + MARGIN + 8, atR = g.x >= ROOM.wall - e.x - MARGIN - 8, atB = g.z <= ROOM.back + e.z + MARGIN + 8;
    for (const d of [350, 600]) { if (atL) c.push({ x: g.x - d, z: g.z, a: g.a }); if (atR) c.push({ x: g.x + d, z: g.z, a: g.a }); if (atB) c.push({ x: g.x, z: g.z - d, a: g.a }); }
  }
  return c;
}
const moveMsFor = (from, to) => { const dist = Math.hypot(to.x - from.x, to.z - from.z), da = Math.abs(to.a - from.a); return Math.max(5200, Math.min(11000, 3200 + dist * 3.8 + da * 34)); };

// A small seeded generator, so the same song always gets the same room
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sungStarts = (lines) => (lines || []).filter((l) => l?.text && l.text.trim() !== '♪' && !/instrumental/i.test(l.text)).map((l) => l.timeMs);

// The schedule: moves of the world, and the big sofa's one visit. Cues come every other sung line
// (or every 8.5s without timings); a cue is taken when the last move has finished. The big sofa's
// visit begins at the first cue after 40% of the song and lasts about eight lines; before it comes
// in, the two-seater is moved to a side wall, and it enters on the other side.
export function buildSchedule({ lines, durationMs, seed }) {
  const rnd = seeded(seed || 'virtual-insanity');
  const starts = sungStarts(lines);
  const cues = starts.length >= 4 ? starts.filter((_, i) => i % 2 === 0).map((t) => t + 500) : Array.from({ length: Math.ceil((durationMs || 240000) / 8500) }, (_, i) => 6000 + i * 8500);
  const dur = durationMs || (starts.length ? starts[starts.length - 1] + 20000 : 240000);
  const bigAt = dur * 0.4;
  const bigStay = starts.length >= 8 ? Math.max(40000, (starts[Math.min(starts.length - 1, 8)] - starts[0]) * 1) : 48000;

  const moves = [];
  let group = { x: 240, z: -1200, a: 0 };
  let big = null; // { f, yawW } while in
  let bigPhase = 'before'; // before | parking | in | after
  let bigEnter = null, bigLeave = null, enteredAt = 0;
  let busyUntil = 0, k = 0;
  const push = (at, to, ease, kind) => {
    const from = { ...group };
    const ms = moveMsFor(from, to);
    const bigFrom = big ? { ...big } : null;
    // the move ends where the two-seater truly is; the big sofa keeps its place in the room
    const end = pinned(to);
    const bigEnd = big ? { f: toFloor(toView(big.f, to), end), yawW: big.yawW } : null;
    moves.push({ at, ms, from, to, end, ease, big: bigFrom, bigEnd, kind });
    group = end; if (bigEnd) big = bigEnd;
    busyUntil = at + ms + 400; k += 1;
  };
  for (const cue of cues) {
    if (cue < busyUntil) continue;
    if (bigPhase === 'before' && cue >= bigAt) {
      if (!atSideWall(group)) {
        const e = ext(SOFAS.loose.W, group.a), side = group.x < 0 ? -1 : 1;
        const to = { x: side * (ROOM.wall - e.x - MARGIN), z: Math.max(ROOM.back + e.z + MARGIN, Math.min(-650, group.z)), a: group.a };
        if (pathClear(group, to, null)) { push(cue, to, 1, 'park'); bigPhase = 'parking'; continue; }
      } else bigPhase = 'parking';
    }
    if (bigPhase === 'parking') {
      // it comes in on the far side, if its whole slide is clear of the two-seater
      const lp = corners({ x: 0, z: 0 }, 0, SOFAS.loose.W, pinned(group));
      const x = group.x > 0 ? -420 : 420;
      let clear = true;
      for (let i = 0; i <= 10 && clear; i++) { const z = SOFAS.big.zOut + (SOFAS.big.zIn - SOFAS.big.zOut) * i / 10; if (overlap(corners(toFloor({ x, z }, group), -group.a, SOFAS.big.W, group), lp, 40)) clear = false; }
      if (clear) { big = { f: toFloor({ x, z: SOFAS.big.zIn }, group), yawW: -group.a }; bigEnter = { at: cue, ms: 4200, f: big.f, yawW: big.yawW }; enteredAt = cue; bigPhase = 'in'; busyUntil = cue + 4200 + 400; continue; }
    }
    if (bigPhase === 'in' && cue >= enteredAt + bigStay) {
      bigLeave = { at: cue, ms: 4000, view: toView(big.f, group), yaw: big.yawW + group.a };
      big = null; bigPhase = 'after'; busyUntil = cue + 4000 + 400; continue;
    }
    const all = candidates(group, big, rnd).filter((c) => Math.abs(c.x - group.x) > 300 || Math.abs(c.z - group.z) > 300);
    const turn = k % 4 === 3;
    const clear = all.map((c) => { const da = ((c.a - group.a + 540) % 360) - 180; return { x: c.x, z: c.z, a: group.a + da, da }; }).filter((c) => pathClear(group, c, big));
    let pool = clear.filter((c) => (turn ? c.da !== 0 : c.da === 0));
    if (!pool.length) pool = clear;
    if (!pool.length) continue;
    // facing the camera is favoured
    const weighted = pool.flatMap((c) => ((((c.a % 360) + 360) % 360) === 0 ? [c, c] : [c]));
    const pick = weighted[Math.floor(rnd() * weighted.length)];
    push(cue, { x: pick.x, z: pick.z, a: pick.a }, k % EASES.length, 'move');
  }
  return { moves, bigEnter, bigLeave, start: { x: 240, z: -1200, a: 0 } };
}

// The room at a moment: the world's pose, where the two-seater stands, and the big sofa if it is
// in (its view position and yaw, with its entrance or exit slide applied)
export function stateAt(schedule, posMs) {
  const { moves, bigEnter, bigLeave } = schedule;
  let group = { ...schedule.start }, big = null, moving = false;
  for (const m of moves) {
    if (posMs < m.at) break;
    if (posMs < m.at + m.ms) {
      const e = EASES[m.ease % EASES.length](Math.min(1, (posMs - m.at) / m.ms));
      group = poseAt(e, m.from, m.to); big = m.big; moving = true; break;
    }
    group = m.end; big = m.bigEnd;
  }
  // the big sofa's presence is by time: its entrance and exit are slides added to its rigid place
  let bigOut = null;
  if (bigEnter && posMs >= bigEnter.at && !(bigLeave && posMs >= bigLeave.at + bigLeave.ms)) {
    if (bigLeave && posMs >= bigLeave.at) {
      const p = Math.min(1, (posMs - bigLeave.at) / bigLeave.ms), pe = p * p * (3 - 2 * p);
      bigOut = { x: bigLeave.view.x, z: bigLeave.view.z + (SOFAS.big.zOut - bigLeave.view.z) * pe, yaw: bigLeave.yaw * (1 - pe) };
    } else {
      const f = big || { f: bigEnter.f, yawW: bigEnter.yawW };
      const v = toView(f.f, group);
      const p = Math.min(1, (posMs - bigEnter.at) / bigEnter.ms), pe = p * p * (3 - 2 * p);
      bigOut = { x: v.x, z: v.z + (1 - pe) * (SOFAS.big.zOut - SOFAS.big.zIn), yaw: f.yawW + group.a };
    }
  }
  const two = pinned(group);
  return { group, two: { x: two.x, z: two.z, yaw: group.a }, big: bigOut, moving };
}
