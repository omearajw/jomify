// The Virtual Insanity room, drawn into Zen's scene target: the video's tiled set with its glossy
// floor, the sofas as ray-marched leather, and the album sleeve propped on the two-seater. The
// camera and walls move while the floor and sofas stay put, planned by scenes/planner.js. Zen's
// glass lyrics, glow and grain composite over it as over any scene.

import { ROOM, SCALE, SOFAS, rad } from './planner.js';

const STAGE_H = 900, FOCAL = 820, CY = 450;

const FS = `precision highp float; varying vec2 uv;
uniform vec2 res; uniform float f, cy, floorY, ceilY, wallX, backZ, t, fade, dim;
uniform vec4 sh0, sh1, sh2;
uniform vec3 sfc0, sfc1, sfc2; uniform vec4 sfp0, sfp1, sfp2;
uniform sampler2D cover; uniform vec3 pc; uniform vec3 ph; uniform float py, ppitch, sleeve;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), fr = fract(p); fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), fr.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), fr.x), fr.y); }
float shadowAt(vec3 p, vec4 s){ if (s.w <= 0.0) return 0.0; vec2 d = (p.xz - s.xy) / vec2(s.z, s.z * 0.55); return s.w * (1.0 - smoothstep(0.0, 1.0, length(d))); }
vec3 tiles(vec2 q, float shade){
  vec2 cell = vec2(450.0, (floorY - ceilY) / 3.0);
  vec2 id = floor(q / cell), fr = fract(q / cell) * cell;
  float tone = 0.80 + 0.07 * hash(id) + 0.03 * noise(q * 0.02);
  float mortar = clamp(1.0 - (smoothstep(5.0, 0.0, fr.x) + smoothstep(cell.x - 5.0, cell.x, fr.x) + smoothstep(5.0, 0.0, fr.y) + smoothstep(cell.y - 5.0, cell.y, fr.y)), 0.0, 1.0);
  vec2 c = abs(fr - cell * 0.5) - (cell * 0.5 - 42.0);
  float dot_ = smoothstep(9.0, 5.0, length(c));
  float v = tone * mix(0.6, 1.0, mortar) * (1.0 - 0.45 * dot_);
  return vec3(v, v, v * 1.02) * shade;
}
float lightbox(float z, float y, float z0, float z1){
  float inside = step(z0, z) * step(z, z1) * step(-310.0, y) * step(y, -70.0);
  vec2 d = vec2(max(max(z0 - z, z - z1), 0.0), max(max(-310.0 - y, y + 70.0), 0.0));
  return inside + (1.0 - inside) * exp(-length(d) / 150.0) * 0.45;
}
float tubes(vec3 p){
  float v = 0.0;
  for (int i = -1; i <= 1; i++){
    float dx = abs(p.x - float(i) * 450.0);
    float seg = step(0.07, fract(p.z / 760.0)) * step(fract(p.z / 760.0), 0.93);
    v += seg * (smoothstep(9.0, 5.0, dx) + 0.12 * exp(-dx / 45.0));
  }
  return v;
}
bool boxLocal(vec3 o, vec3 d, vec3 h, out float tn, out float tf, out vec3 nl){
  vec3 m = 1.0 / d, k = abs(m) * h, t1 = -m * o - k, t2 = -m * o + k;
  tn = max(max(t1.x, t1.y), t1.z); tf = min(min(t2.x, t2.y), t2.z);
  nl = -sign(d) * step(vec3(tn), t1);
  return tn <= tf && tf > 0.0;
}
vec3 toLocal(vec3 v, float cs, float sn){ return vec3(v.x * cs - v.z * sn, v.y, v.x * sn + v.z * cs); }
vec3 fromLocal(vec3 v, float cs, float sn){ return vec3(v.x * cs + v.z * sn, v.y, -v.x * sn + v.z * cs); }
float rbox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
// A low square block with a shallow well, flat seat cushions and back cushions leaning on the back
float sofaSDF(vec3 p, float Wd, float n){
  float armW = 72.0, D = 300.0, Hh = 108.0, backT = 92.0, gap = 10.0;
  float body = rbox(p - vec3(0.0, Hh, 0.0), vec3(Wd * 0.5, Hh, D * 0.5), 9.0);
  float well = rbox(p - vec3(0.0, Hh + 60.0, backT * 0.5 + 10.0), vec3(Wd * 0.5 - armW, 60.0, D * 0.5 - backT * 0.5 + 10.0), 6.0);
  float d = max(body, -well);
  float inner = Wd - 2.0 * armW, cw = (inner - (n - 1.0) * gap) / n;
  float cs = cos(0.17), sn = sin(0.17);
  for (int i = 0; i < 3; i++){
    if (float(i) >= n) break;
    float cx = -inner * 0.5 + cw * 0.5 + float(i) * (cw + gap);
    d = min(d, rbox(p - vec3(cx, 126.0, backT * 0.5 + 8.0), vec3(cw * 0.5 - 8.0, 30.0, D * 0.5 - backT * 0.5 - 6.0), 12.0));
    vec3 q = p - vec3(cx, 196.0, -D * 0.5 + backT + 26.0);
    q = vec3(q.x, q.y * cs - q.z * sn, q.y * sn + q.z * cs);
    d = min(d, rbox(q, vec3(cw * 0.5 - 10.0, 48.0, 22.0), 12.0));
  }
  return d;
}
float sofaDist(vec3 pw, vec3 c, vec4 prm){
  float cs = cos(prm.x), sn = sin(prm.x);
  vec3 q = toLocal(pw - c, cs, sn);
  q = vec3(q.x, -q.y, q.z) / prm.w;
  return sofaSDF(q, prm.y, prm.z) * prm.w;
}
float sofaHit(vec3 ro, vec3 rd, vec3 c, vec4 prm, out vec3 n, out float ao, out vec3 lp){
  if (prm.y <= 0.0) return 1e9;
  float cs = cos(prm.x), sn = sin(prm.x);
  vec3 half_ = vec3(prm.y * 0.5, 130.0, 155.0) * prm.w;
  vec3 o = toLocal(ro - (c - vec3(0.0, half_.y, 0.0)), cs, sn), d = toLocal(rd, cs, sn);
  float tn, tf; vec3 nl;
  if (!boxLocal(o, d, half_ + 4.0, tn, tf, nl)) return 1e9;
  float tt = max(tn, 0.0);
  for (int i = 0; i < 56; i++){
    vec3 p = ro + rd * tt;
    float dd = sofaDist(p, c, prm);
    if (dd < 0.6) {
      vec2 e = vec2(1.5, 0.0);
      n = normalize(vec3(sofaDist(p + e.xyy, c, prm) - sofaDist(p - e.xyy, c, prm), sofaDist(p + e.yxy, c, prm) - sofaDist(p - e.yxy, c, prm), sofaDist(p + e.yyx, c, prm) - sofaDist(p - e.yyx, c, prm)));
      float a1 = sofaDist(p + n * 14.0, c, prm), a2 = sofaDist(p + n * 34.0, c, prm);
      ao = clamp(0.55 + 0.25 * a1 / 14.0 + 0.2 * a2 / 34.0, 0.35, 1.0);
      lp = toLocal(p - c, cs, sn);
      return tt;
    }
    tt += dd * 0.9;
    if (tt > tf) break;
  }
  return 1e9;
}
float sofas(vec3 ro, vec3 rd, out vec3 n, out float ao, out vec3 lp){
  float best = 1e9; vec3 bn, blp; float bao, tb;
  tb = sofaHit(ro, rd, sfc0, sfp0, bn, bao, blp); if (tb < best) { best = tb; n = bn; ao = bao; lp = blp; }
  tb = sofaHit(ro, rd, sfc1, sfp1, bn, bao, blp); if (tb < best) { best = tb; n = bn; ao = bao; lp = blp; }
  tb = sofaHit(ro, rd, sfc2, sfp2, bn, bao, blp); if (tb < best) { best = tb; n = bn; ao = bao; lp = blp; }
  return best;
}
// Patent leather: near-black, a hard sheen from the tubes, creases in the sofa's own coordinates
vec3 leather(vec3 p, vec3 n, vec3 rd, float ao){
  float w1 = noise(p.xz * 0.045 + p.y * 0.03), w2 = noise(p.xy * 0.07 - p.z * 0.02);
  vec3 wn = normalize(n + 0.22 * vec3(w1 - 0.5, w2 - 0.5, (w1 - w2)));
  float up = max(-wn.y, 0.0);
  vec3 base = vec3(0.034, 0.034, 0.040) + vec3(0.11) * up + vec3(0.03) * max(wn.z, 0.0) + vec3(0.02) * abs(wn.x);
  vec3 r = reflect(rd, wn);
  float spec = pow(max(-r.y, 0.0), 60.0) * 0.9 + pow(max(-r.y, 0.0), 6.0) * 0.18 + pow(max(-r.y, 0.0), 2.0) * 0.07 + pow(max(abs(r.x), 0.0), 40.0) * 0.08;
  float fres = pow(1.0 - abs(dot(wn, rd)), 3.0) * 0.28;
  return (base + vec3(spec) * vec3(0.95, 0.97, 1.0) + vec3(fres)) * ao;
}
// The sleeve: a thin box leaning back on the cushion, the picture on its face, card at its edges
float coverHit(vec3 ro, vec3 rd, out vec3 col){
  if (ph.x <= 0.0) return 1e9;
  float cs = cos(py), sn = sin(py), cp = cos(ppitch), sp = sin(ppitch);
  vec3 o = toLocal(ro - pc, cs, sn), d = toLocal(rd, cs, sn);
  o = vec3(o.x, o.y * cp - o.z * sp, o.y * sp + o.z * cp); d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float tn, tf; vec3 nl;
  if (!boxLocal(o, d, ph, tn, tf, nl)) return 1e9;
  tn = max(tn, 0.0);
  vec3 p = o + d * tn; vec2 cuv = vec2(p.x / ph.x, p.y / ph.y) * 0.5 + 0.5;
  vec3 n = fromLocal(vec3(nl.x, nl.y * cp + nl.z * sp, -nl.y * sp + nl.z * cp), cs, sn);
  float fres = pow(1.0 - abs(dot(n, rd)), 3.0);
  if (nl.z > 0.5) col = texture2D(cover, vec2(cuv.x, 1.0 - cuv.y)).rgb * 0.9 + vec3(0.12) * fres;
  else if (nl.z < -0.5) col = vec3(0.22, 0.21, 0.20);
  else col = vec3(0.86, 0.84, 0.80) * (0.75 + 0.25 * max(-n.y, 0.0)) * (nl.y > 0.5 ? 0.6 : 1.0);
  return tn;
}
vec3 room(vec3 ro, vec3 rd, out float tm){
  if (ro.z < backZ) { tm = 1e9; return vec3(0.03); }
  float tb = (backZ - ro.z) / rd.z; if (tb < 0.0) tb = 1e9;
  float tc = rd.y < 0.0 ? (ceilY - ro.y) / rd.y : 1e9;
  float tw = abs(rd.x) > 1e-5 ? (sign(rd.x) * wallX - ro.x) / rd.x : 1e9;
  tm = min(tb, min(tc, tw));
  vec3 p = ro + rd * tm;
  float dFloor = floorY - p.y, dCeil = p.y - ceilY;
  if (tm == tc){
    vec3 col = vec3(0.17, 0.18, 0.20) * (0.7 + 0.3 * smoothstep(0.0, 500.0, min(wallX - abs(p.x), p.z - backZ)));
    float beam = step(fract(p.z / 760.0), 0.045) + step(0.955, fract(p.z / 760.0));
    col *= 1.0 - 0.35 * beam;
    return col + vec3(0.95, 0.97, 1.0) * tubes(p);
  }
  float shade = (0.70 + 0.30 * smoothstep(0.0, 420.0, dFloor)) * (0.8 + 0.2 * smoothstep(0.0, 300.0, dCeil));
  if (dFloor < 14.0) return vec3(0.06);
  if (tm == tb){
    if (abs(p.x) < 135.0 && p.y > -430.0) {
      float tcw = abs(rd.x) > 1e-5 ? (sign(rd.x) * 135.0 - ro.x) / rd.x : 1e9;
      float tcc = rd.y < 0.0 ? (-430.0 - ro.y) / rd.y : 1e9;
      float tcb = (backZ - 1500.0 - ro.z) / rd.z;
      tm = min(min(tcw, tcc), tcb);
      vec3 q = ro + rd * tm;
      return vec3(0.15, 0.15, 0.16) * (1.0 - 0.9 * clamp((backZ - q.z) / 1500.0, 0.0, 1.0));
    }
    return tiles(vec2(p.x + wallX, dFloor), shade * (0.82 + 0.18 * smoothstep(0.0, 400.0, wallX - abs(p.x))));
  }
  vec3 col = tiles(vec2(p.z - backZ, dFloor), shade * (0.84 + 0.16 * smoothstep(0.0, 500.0, p.z - backZ)));
  float lb = max(lightbox(p.z, p.y, -2000.0, -1400.0), lightbox(p.z, p.y, -1050.0, -350.0));
  return mix(col, vec3(1.08, 1.09, 1.1), lb);
}
vec3 scene(vec3 ro, vec3 rd, out float tm){
  float tr; vec3 col = room(ro, rd, tr);
  vec3 sn, slp; float ao; float ts = sofas(ro, rd, sn, ao, slp);
  vec3 ccol; float tcv = coverHit(ro, rd, ccol);
  tm = tr;
  if (ts < tm) { tm = ts; col = leather(slp, sn, rd, ao); }
  if (tcv < tm) { tm = tcv; col = mix(col, ccol, sleeve); }
  return col;
}
void main(){
  vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);
  vec3 ro = vec3(0.0, 0.0, f);
  vec3 rd = normalize(vec3(px.x - res.x * 0.5, px.y - cy, -f));
  float ts; vec3 col = scene(ro, rd, ts);
  float tf = rd.y > 0.0 ? (floorY - ro.y) / rd.y : 1e9;
  if (tf < ts){
    vec3 p = ro + rd * tf;
    float ao = 0.55 + 0.45 * smoothstep(0.0, 420.0, min(wallX - abs(p.x), p.z - backZ));
    vec3 base = vec3(0.50, 0.55, 0.60) * ao * (p.z < backZ ? 0.3 : 1.0);
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    float t2; vec3 mirror = scene(p + rr * 0.5, rr, t2);
    float fres = 0.18 + 0.5 * pow(1.0 - max(-rd.y, 0.0), 3.0);
    col = mix(base, mirror * vec3(0.9, 0.95, 1.0), fres * 0.55);
    float s = clamp(shadowAt(p, sh0) + shadowAt(p, sh1) + shadowAt(p, sh2), 0.0, 1.0);
    col *= 1.0 - 0.5 * s;
  }
  col += (noise(px * 1.1 + t * 7.0) - 0.5) * 0.02;
  vec2 q = (uv - 0.5) * vec2(1.0, 1.2); col *= 1.0 - dot(q, q) * 0.5;
  gl_FragColor = vec4(min(col * dim, vec3(1.0)), fade);
}`;

// The sleeve's place on the two-seater: on its left cushion, leaning back on the back cushion
const SLEEVE = (() => { const inner = SOFAS.loose.W - 144, cw = (inner - 10) / 2, h = 92 * SCALE, pitch = -0.2; return { lx: (-inner / 2 + cw / 2) * SCALE, lz: 18 * SCALE, h, pitch, cy: 156 * SCALE + h * Math.cos(pitch), cz: 18 * SCALE + h * Math.sin(-pitch) * 0.5 }; })();
export function sleevePlace(two) {
  const c = Math.cos(rad(two.yaw)), s = Math.sin(rad(two.yaw));
  return { x: two.x + SLEEVE.lx * c + SLEEVE.cz * s, y: ROOM.floor - SLEEVE.cy, z: two.z - SLEEVE.lx * s + SLEEVE.cz * c, yaw: two.yaw, pitch: SLEEVE.pitch, h: SLEEVE.h };
}
// Where the sleeve's face lands on screen, in CSS pixels of a canvas css wide and tall: the
// camera sees a stage 900 units tall, as wide as the canvas's aspect makes it
export function sleeveScreenBox(two, cssW, cssH) {
  const p = sleevePlace(two);
  const stageW = STAGE_H * (cssW / cssH), k = cssH / STAGE_H;
  const c = Math.cos(rad(p.yaw)), s = Math.sin(rad(p.yaw)), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const pts = [];
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    // a corner of the face in the sleeve's own frame, pitched then turned, then set in the room
    const lx = i * p.h, ly0 = j * p.h, lz0 = 6;
    const ly = ly0 * cp + lz0 * sp, lz = -ly0 * sp + lz0 * cp;
    const x = p.x + lx * c + lz * s, y = p.y + ly, z = p.z - lx * s + lz * c;
    const sc = FOCAL / (FOCAL - z);
    pts.push({ x: (stageW / 2 + x * sc) * k, y: (CY + y * sc) * k });
  }
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// r is Zen's renderer (zenGl); the scene draws into its scene target
export function createRoomScene(r) {
  const prog = r.compileProgram(FS);
  const gl = r.gl;
  let coverTex = null, coverFor = null;
  const setCover = (img, key) => {
    if (coverFor === key) return;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    c.getContext('2d').drawImage(img, 0, 0, 512, 512);
    if (coverTex) gl.deleteTexture(coverTex);
    coverTex = r.makeTexture(c); coverFor = key;
  };
  const sofa = (v, W, n, yaw) => ({ c: [v.x, ROOM.floor, v.z], p: [rad(yaw), W, n, SCALE] });
  const draw = ({ state, t, fade = 1, dim = 1, sleeve = 1 }) => {
    const out = r.sceneTarget();
    const two = sofa(state.two, SOFAS.loose.W, SOFAS.loose.n, state.two.yaw);
    const fixed = sofa(SOFAS.fixed.view, SOFAS.fixed.W, SOFAS.fixed.n, SOFAS.fixed.yaw);
    const big = state.big ? sofa(state.big, SOFAS.big.W, SOFAS.big.n, state.big.yaw) : { c: [0, 0, 0], p: [0, 0, 0, SCALE] };
    const pl = sleevePlace(state.two);
    const u = {
      res: [STAGE_H * (out.w / out.h), STAGE_H], f: FOCAL, cy: CY, floorY: ROOM.floor, ceilY: ROOM.ceil, wallX: ROOM.wall, backZ: ROOM.back, t, fade, dim,
      sh0: [state.two.x, state.two.z, SOFAS.loose.W * 0.42, 0.75], sh1: [SOFAS.fixed.view.x, SOFAS.fixed.view.z, SOFAS.fixed.W * 0.42, 0.7], sh2: state.big ? [state.big.x, state.big.z, SOFAS.big.W * 0.42, 0.75] : [0, 0, 1, 0],
      sfc0: two.c, sfp0: two.p, sfc1: fixed.c, sfp1: fixed.p, sfc2: big.c, sfp2: big.p,
      cover: coverTex || r.emptyTexture, pc: [pl.x, pl.y, pl.z], ph: coverTex && sleeve > 0 ? [pl.h, pl.h, 6] : [0, 0, 0], py: rad(pl.yaw), ppitch: pl.pitch, sleeve
    };
    r.drawWith(prog, out, u, { blend: fade < 1 });
  };
  return {
    draw, setCover,
    destroy() { if (coverTex) gl.deleteTexture(coverTex); r.freeProgram(prog); }
  };
}
