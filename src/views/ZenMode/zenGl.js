// Zen mode's picture, drawn by WebGL: slow ribbons of light in the cover's colours, and the lyric
// lines as glass that bends that light. Everything visual lives here; ZenStage decides what is on
// screen and where, and hands it over each frame.
//
// Each lyric line is drawn once, when it first appears, into one texture holding four things:
//   r: the letters, sharp           g: the letters slightly blurred, the height of the glass bevel
//   b: the letters widely blurred   a: reading order, 0 at the first letter to 1 at the last
// The wide blur is the line's halo, its shadow and, scaled down, the soft text of the lines either
// side; the reading order lets the sung part glow with a feathered edge that runs along the first
// row before the second. Nothing about a line is redrawn per frame, only where it is.

import { wordStops } from './lyricFocus.js';

const VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

const BLUR_FS = `precision mediump float; uniform sampler2D tex; uniform vec2 dir; varying vec2 uv;
void main(){ vec4 s = texture2D(tex, uv) * 0.19648;
  s += (texture2D(tex, uv + dir * 1.41176) + texture2D(tex, uv - dir * 1.41176)) * 0.29691;
  s += (texture2D(tex, uv + dir * 3.29412) + texture2D(tex, uv - dir * 3.29412)) * 0.09447;
  s += (texture2D(tex, uv + dir * 5.17647) + texture2D(tex, uv - dir * 5.17647)) * 0.01038;
  gl_FragColor = s; }`;

const COPY_FS = 'precision mediump float; uniform sampler2D tex; varying vec2 uv; void main(){ gl_FragColor = texture2D(tex, uv); }';

const PACK_FS = `precision mediump float; varying vec2 uv; uniform sampler2D sharp, bevel, soft, order;
void main(){ gl_FragColor = vec4(texture2D(sharp, uv).r, texture2D(bevel, uv).r, texture2D(soft, uv).r, texture2D(order, uv).r); }`;

const SCENE_FS = `precision highp float; varying vec2 uv;
uniform float t, beat, aspect, intro, dim; uniform vec3 c1, c2, c3;
// The song's character (ReccoBeats): energy, valence, acousticness, minor key; and lift, how much a
// chorus opens the light up
uniform float energy, valence, acoustic, minor, lift;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 col = mix(vec3(0.012, 0.01, 0.025), c3 * 0.06, uv.y);
  // Happy songs warm the light a little, sad ones cool it; a minor key and low mood dim it a touch,
  // a chorus brightens it
  vec3 tint = mix(vec3(0.9, 0.96, 1.1), vec3(1.1, 1.0, 0.88), valence);
  float bright = mix(0.84, 1.1, valence) * (1.0 - 0.08 * minor) * (1.0 + 0.25 * lift);
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    vec3 c = i == 0 ? c1 : i == 1 ? c2 : mix(c1, c2, 0.5);
    float y = 0.55 + 0.18 * sin(p.x * 1.1 + t * 0.045 + fi * 2.1) + 0.12 * (fbm(vec2(p.x * 0.7 + fi * 3.0, t * 0.025)) - 0.5) - fi * 0.13;
    // Quiet songs: wide, soft ribbons; loud ones: tighter, more defined
    float w = (0.09 + 0.05 * fbm(vec2(p.x * 1.3, t * 0.02 + fi))) * mix(1.45, 0.8, energy) * (1.0 + 0.15 * lift);
    float band = exp(-pow((uv.y - y) / w, 2.0));
    float curtain = 0.55 + 0.45 * fbm(vec2(p.x * 9.0 + t * 0.08, uv.y * 1.5 + fi * 7.0));
    float upper = smoothstep(y - w * 2.5, y + w * 0.4, uv.y);
    col += c * tint * band * curtain * (0.55 + 0.14 * beat) * (0.6 + 0.4 * upper) * intro * bright;
    col += c * tint * exp(-pow((uv.y - y) / (w * 4.0), 2.0)) * 0.07 * intro * bright;
    // Fine filaments along each ribbon: the detail the glass has to bend
    float fil = pow(abs(sin((uv.y - y) * 48.0 + fbm(vec2(p.x * 2.2, fi + t * 0.01)) * 7.0)), 34.0) * smoothstep(0.35, 0.75, fbm(vec2(p.x * 1.6 - t * 0.02, fi * 5.0)));
    // Acoustic songs lose the electric filaments for a softer light
    col += mix(c, vec3(1.0), 0.5) * fil * band * 0.3 * intro * (1.0 - 0.8 * acoustic);
  }
  // ...and gain a slow haze, like light through a dusty room
  float haze = fbm(vec2(p.x * 2.5 - t * 0.015, uv.y * 2.5 + t * 0.01));
  col += mix(c1, c3, 0.5) * tint * smoothstep(0.45, 0.85, haze) * 0.07 * acoustic * intro * bright;
  gl_FragColor = vec4(col * dim, 1.0);
}`;

// Six faces at once covers a line change: the big face leaving and arriving, and the small ones
// above and below doing the same. With the scene and the glow, eight textures: all WebGL1 promises.
const ITEMS = 6;
// Lines can stand in a scene: tilt turns them a little about a vertical axis through a pivot
// (tan(angle)/focal per device pixel, cos(angle), pivot x, pivot y), and mirror reflects them,
// faintly, in a floor line (its y in device pixels, how strong; y below 0 is off)
const STAGE_GLSL = `uniform vec4 tilt; uniform vec2 mirror;
vec2 warp(vec2 fpx){
  if (tilt.y >= 0.9999) return fpx;
  vec2 d = fpx - tilt.zw;
  float w = 1.0 / (1.0 - d.x * tilt.x);
  return tilt.zw + vec2(d.x * w / tilt.y, d.y * w);
}`;
const COMP_FS = `precision highp float; varying vec2 uv;
uniform sampler2D scene, glow; uniform vec2 res; uniform float strength, grain, glowGain, disperse; uniform vec3 c1, tint;
${Array.from({ length: ITEMS }, (_, i) => `uniform sampler2D tx${i}; uniform vec4 bx${i}, pr${i}, tl${i};`).join('\n')}
${STAGE_GLSL}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// A line's reflection: its soft shape, dim, fading with distance from the floor line
float ghost(sampler2D tx, vec4 bx, vec4 pr, vec4 tl, vec2 fpx){
  if (pr.x < 0.003) return 0.0;
  vec2 l = (fpx - bx.xy) / bx.zw;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return 0.0;
  vec4 p = texture2D(tx, vec2(l.x, 1.0 - l.y));
  return (p.r * 0.5 + p.b * 0.5) * pr.x * (0.5 + 0.5 * pr.y);
}
float hgt(sampler2D tx, vec2 st){ return smoothstep(0.06, 0.94, texture2D(tx, st).g); }
// bx: where the line's texture is drawn (left, top, width, height, device pixels)
// pr: opacity, how much glass (against soft text), halo, how visible the sung glow is
// tl: one texel of the texture, then how much of the line has been sung
vec3 item(vec3 col, sampler2D tx, vec4 bx, vec4 pr, vec4 tl, vec2 fpx){
  if (pr.x < 0.003) return col;
  vec2 l = (fpx - bx.xy) / bx.zw;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return col;
  vec2 st = vec2(l.x, 1.0 - l.y);
  vec4 p = texture2D(tx, st);
  float a = p.r, s = p.b, o = p.a, alpha = pr.x, glass = pr.y;
  // The head runs past both ends, so the first letter starts unlit and the last ends fully lit
  float head = mix(-0.04, 1.0, tl.z);
  // Full light reaches the head itself; the soft edge runs ahead of it, never behind, or the words
  // light late
  float lit = tl.z <= 0.0 ? 0.0 : (1.0 - smoothstep(head, head + 0.04, o)) * pr.w;
  float sh = texture2D(tx, st + vec2(-1.5, 4.0) * tl.xy).b;
  col *= 1.0 - 0.45 * sh * glass * alpha * (1.0 - a);
  if (glass > 0.003 && a > 0.003){
    float dx = hgt(tx, st + vec2(tl.x, 0.0)) - hgt(tx, st - vec2(tl.x, 0.0));
    float dy = hgt(tx, st + vec2(0.0, tl.y)) - hgt(tx, st - vec2(0.0, tl.y));
    vec3 n = normalize(vec3(-dx * 3.2, -dy * 3.2, 1.0));
    vec2 off = (n.xy * strength + (1.0 - n.z) * vec2(0.0, -6.0)) / res;
    // the glass splits colours a little; on a scene with hard edges that read as fringes, so a scene turns it down
    vec3 seen = vec3(texture2D(scene, uv - off * (1.0 - 0.25 * disperse)).r, texture2D(scene, uv - off).g, texture2D(scene, uv - off * (1.0 + 0.32 * disperse)).b);
    vec3 face = mix(seen * 1.5 + 0.03, vec3(0.30, 0.30, 0.34), 0.24);
    vec3 hv = normalize(normalize(vec3(-0.6, 0.6, 0.55)) + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, hv), 0.0), 40.0);
    float rim = pow(1.0 - n.z, 1.4);
    float lower = max(dot(n.xy, normalize(vec2(0.7, -0.7))), 0.0);
    vec3 g = face + spec * 0.8 + rim * 0.32 - lower * 0.16;
    g = mix(g, vec3(1.0) - (1.0 - n.z) * 0.06, lit);
    col = mix(col, g, a * glass * alpha);
  }
  col = mix(col, vec3(0.92, 0.9, 0.96), clamp(s * 1.25, 0.0, 1.0) * (1.0 - glass) * alpha * 0.32);
  col += (vec3(1.0) * 0.06 + tint * 0.1) * s * pr.z * alpha * (1.0 - a * glass * 0.5) * glowGain;
  return col;
}
void main(){
  vec2 fpx = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec3 col = texture2D(scene, uv).rgb;
  if (mirror.y > 0.003 && fpx.y > mirror.x) {
    vec2 m = warp(vec2(fpx.x, 2.0 * mirror.x - fpx.y));
    float fall = 1.0 - clamp((fpx.y - mirror.x) / (0.3 * res.y), 0.0, 1.0);
    float g = 0.0;
${Array.from({ length: ITEMS }, (_, i) => `    g += ghost(tx${i}, bx${i}, pr${i}, tl${i}, m);`).join('\n')}
    col = mix(col, vec3(0.78, 0.82, 0.9), clamp(g, 0.0, 1.0) * mirror.y * fall * fall);
  }
  vec2 wpx = warp(fpx);
${Array.from({ length: ITEMS }, (_, i) => `  col = item(col, tx${i}, bx${i}, pr${i}, tl${i}, wpx);`).join('\n')}
  // The sung words' glow: their letters, blurred as a whole (see GLOW_FS)
  col += (vec3(1.0) * 0.42 + tint * 0.5) * texture2D(glow, uv).r * 0.6 * glowGain;
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * 0.9;
  col += (hash(fpx + fract(grain) * 31.0) - 0.5) * 0.022;
  col = col / (1.0 + col * 0.25);
  gl_FragColor = vec4(col, 1.0);
}`;

// The sung part of each line, as plain light, drawn small to be blurred into its glow. Blurring the
// lit letters themselves is what keeps the glow smooth: working it out per pixel from the line's
// reading order left hard steps where one row's glow met the next.
const GLOW_FS = `precision highp float; varying vec2 uv;
uniform vec2 res, full;
${Array.from({ length: ITEMS }, (_, i) => `uniform sampler2D tx${i}; uniform vec4 bx${i}, pr${i}, tl${i};`).join('\n')}
${STAGE_GLSL}
float lit(sampler2D tx, vec4 bx, vec4 pr, vec4 tl, vec2 fpx){
  if (pr.x < 0.003 || tl.z <= 0.0 || pr.w < 0.003) return 0.0;
  vec2 l = (fpx - bx.xy) / bx.zw;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return 0.0;
  vec4 p = texture2D(tx, vec2(l.x, 1.0 - l.y));
  float head = mix(-0.04, 1.0, tl.z);
  return p.r * (1.0 - smoothstep(head, head + 0.04, p.a)) * pr.w * pr.x;
}
void main(){
  vec2 fpx = warp(vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) * (full / res));
  float v = 0.0;
${Array.from({ length: ITEMS }, (_, i) => `  v += lit(tx${i}, bx${i}, pr${i}, tl${i}, fpx);`).join('\n')}
  gl_FragColor = vec4(min(v, 1.0), 0.0, 0.0, 1.0);
}`;

const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const lineFont = (px) => `800 ${px}px ${FONT_FAMILY}`;

// Words onto rows no wider than maxW (device pixels)
export function wrapRows(ctx, text, maxW) {
  const rows = [];
  let row = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = row ? `${row} ${word}` : word;
    if (row && ctx.measureText(next).width > maxW) { rows.push(row); row = word; } else row = next;
  }
  if (row) rows.push(row);
  return rows;
}

// onFail(reason) says why WebGL could not be used, for the debug log
export function createZenRenderer(canvas, { onLost, onFail } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) { onFail?.('the browser gave no WebGL context'); return null; }
  if (gl.isContextLost()) { onFail?.('the WebGL context was already lost'); return null; }

  const compile = (fs) => {
    const program = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader failed');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link failed');
    return { program, locs: new Map() };
  };
  let P;
  try {
    P = { blur: compile(BLUR_FS), copy: compile(COPY_FS), pack: compile(PACK_FS), scene: compile(SCENE_FS), glow: compile(GLOW_FS), comp: compile(COMP_FS) };
  } catch (err) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    onFail?.(`shader failed on ${gpu}: ${String(err?.message || err).slice(0, 400)}`);
    return null;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const texture = (source, w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return t;
  };
  const target = (w, h) => {
    const t = texture(null, w, h);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  };
  const freeTarget = (tg) => { if (tg) { gl.deleteFramebuffer(tg.f); gl.deleteTexture(tg.t); } };
  const empty = texture(null, 1, 1);

  const draw = (prog, out, uniforms, { blend = false } = {}) => {
    gl.useProgram(prog.program);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.f : null);
    gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
    const loc = gl.getAttribLocation(prog.program, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    let unit = 0;
    for (const [name, v] of Object.entries(uniforms)) {
      if (!prog.locs.has(name)) prog.locs.set(name, gl.getUniformLocation(prog.program, name));
      const u = prog.locs.get(name);
      if (u === null) continue;
      if (v instanceof WebGLTexture || (v && v.t instanceof WebGLTexture)) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v.t || v);
        gl.uniform1i(u, unit);
        unit += 1;
      } else if (typeof v === 'number') gl.uniform1f(u, v);
      else if (v.length === 2) gl.uniform2f(u, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(u, v[0], v[1], v[2]);
      else gl.uniform4f(u, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const blur = (src, w, h, spread, passes) => {
    const a = target(w, h);
    const b = target(w, h);
    let from = src;
    for (let i = 0; i < passes; i++) {
      draw(P.blur, a, { tex: from, dir: [spread / w, 0] });
      draw(P.blur, b, { tex: a, dir: [0, spread / h] });
      from = b;
    }
    freeTarget(a);
    return b;
  };

  let scene = null;
  let glowA = null;
  let glowB = null;
  const resize = () => {
    freeTarget(scene); freeTarget(glowA); freeTarget(glowB);
    scene = target(Math.max(1, Math.round(canvas.width / 2)), Math.max(1, Math.round(canvas.height / 2)));
    glowA = target(Math.max(1, Math.round(canvas.width / 4)), Math.max(1, Math.round(canvas.height / 4)));
    glowB = target(glowA.w, glowA.h);
  };
  resize();

  // A lyric line's texture. big and maxW in device pixels; the result is measured in them too.
  // With words (each { text, joined }), it also says where each word starts and ends along the
  // line's reading order, so the light can follow them.
  const makeLine = (text, big, maxW, words) => {
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = lineFont(big);
    const rows = wrapRows(measure, text, maxW);
    const widths = rows.map((r) => measure.measureText(r).width);
    const stops = words ? wordStops(measure, rows, widths, words) : null;
    const blockW = Math.ceil(Math.max(1, ...widths));
    const lh = big * 1.1;
    const blockH = Math.ceil(rows.length * lh);
    const pad = Math.round(big * 0.7);
    const w = blockW + pad * 2;
    const h = blockH + pad * 2;

    const shapes = document.createElement('canvas');
    shapes.width = w; shapes.height = h;
    const sx = shapes.getContext('2d');
    sx.fillStyle = '#000'; sx.fillRect(0, 0, w, h);
    sx.font = lineFont(big); sx.textBaseline = 'middle'; sx.fillStyle = '#fff';
    rows.forEach((r, i) => sx.fillText(r, pad, pad + lh * (i + 0.5)));

    // Reading order, painted in each row's own letters (a gradient along the row) rather than in
    // horizontal bands: a band boundary cut through the tails of g, y and p, which then took the
    // next row's order and lit only when that row was sung. A stroke covers the letters' soft edges.
    const order = document.createElement('canvas');
    order.width = w; order.height = h;
    const ox = order.getContext('2d');
    ox.font = lineFont(big); ox.textBaseline = 'middle';
    ox.lineWidth = Math.max(2, big * 0.08); ox.lineJoin = 'round';
    const total = widths.reduce((s, v) => s + v, 0) || 1;
    const grey = (v) => { const c = Math.round(v * 255); return `rgb(${c},${c},${c})`; };
    let done = 0;
    rows.forEach((r, i) => {
      const from = done / total;
      done += widths[i];
      const g = ox.createLinearGradient(pad, 0, pad + widths[i], 0);
      g.addColorStop(0, grey(from));
      g.addColorStop(1, grey(done / total));
      ox.fillStyle = g; ox.strokeStyle = g;
      const y = pad + lh * (i + 0.5);
      ox.strokeText(r, pad, y);
      ox.fillText(r, pad, y);
    });

    const sharpT = texture(shapes);
    const orderT = texture(order);
    const bevel = blur(sharpT, w, h, big / 110, 2);
    // The glow: many fine passes at a quarter of the size. Fewer, wider passes skipped texels and
    // left the halo visibly stepped
    const quarter = target(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    draw(P.copy, quarter, { tex: sharpT });
    const soft = blur(quarter, quarter.w, quarter.h, Math.min(1.1, big / 150), Math.max(4, Math.round(big / 28)));
    freeTarget(quarter);
    const packed = target(w, h);
    draw(P.pack, packed, { sharp: sharpT, bevel, soft, order: orderT });
    gl.deleteTexture(sharpT);
    gl.deleteTexture(orderT);
    freeTarget(bevel);
    freeTarget(soft);
    return { packed, w, h, pad, blockW, blockH, rows: rows.length, stops };
  };
  const freeLine = (line) => { if (line) freeTarget(line.packed); };

  // items: [{ line, x, y, scale, alpha, glass, halo, litVisible, lit }] with x, y the top left of the
  // line's text block in device pixels
  // mood: the song's character, each 0..1 (see SCENE_FS)
  // drawScene, when given, draws the backdrop into the scene target after the light (a song's own
  // scene fading over it, or replacing it)
  // stage: how the lines stand in a song's scene: { tilt: [tan/focal, cos, pivotX, pivotY], mirror: [floorY, strength] }
  // tint: the colour in the lines' glow (the palette's first colour unless given); glowGain scales the glow
  const render = ({ t, beat = 0, intro = 1, dim = 1, palette, items = [], strength = 280, grain = 0, mood = {}, drawScene = null, stage = null, tint = null, glowGain = 1, disperse = 1 }) => {
    const [c1, c2, c3] = palette;
    draw(P.scene, scene, { t, beat, aspect: canvas.width / canvas.height, intro, dim, c1, c2, c3, energy: mood.energy ?? 0.5, valence: mood.valence ?? 0.5, acoustic: mood.acoustic ?? 0, minor: mood.minor ?? 0, lift: mood.lift ?? 0 });
    drawScene?.();
    const u = { scene, res: [canvas.width, canvas.height], strength: strength * (canvas.width / 2880), grain, c1, tint: tint || c1, glowGain, disperse, tilt: stage?.tilt || [0, 1, 0, 0], mirror: stage?.mirror || [-1, 0] };
    for (let i = 0; i < ITEMS; i++) {
      const it = items[i];
      if (!it || !it.line) {
        u[`tx${i}`] = empty; u[`bx${i}`] = [0, 0, 1, 1]; u[`pr${i}`] = [0, 0, 0, 0]; u[`tl${i}`] = [0, 0, 0, 0];
        continue;
      }
      const { line } = it;
      u[`tx${i}`] = line.packed;
      u[`bx${i}`] = [it.x - line.pad * it.scale, it.y - line.pad * it.scale, line.w * it.scale, line.h * it.scale];
      u[`pr${i}`] = [it.alpha, it.glass, it.halo, it.litVisible];
      u[`tl${i}`] = [1 / line.w, 1 / line.h, it.lit, 0];
    }
    // The glow: lit letters drawn small, then blurred in place a few times
    draw(P.glow, glowA, { ...u, res: [glowA.w, glowA.h], full: [canvas.width, canvas.height] });
    // A modest spread: wider, it washed over the unsung letters beside the sung ones
    for (let pass = 0; pass < 3; pass++) {
      draw(P.blur, glowB, { tex: glowA, dir: [1.0 / glowA.w, 0] });
      draw(P.blur, glowA, { tex: glowB, dir: [0, 1.0 / glowA.h] });
    }
    u.glow = glowA;
    draw(P.comp, null, u);
  };

  const lost = (e) => { e.preventDefault(); onLost?.('the WebGL context was lost'); };
  canvas.addEventListener('webglcontextlost', lost);

  return {
    gl,
    resize,
    makeLine,
    freeLine,
    render,
    // For a song's own scene: its program, drawn into the scene target
    compileProgram: compile,
    freeProgram: (p) => gl.deleteProgram(p.program),
    drawWith: draw,
    sceneTarget: () => scene,
    makeTarget: target,
    freeTarget,
    makeTexture: (source) => texture(source),
    emptyTexture: empty,
    destroy() {
      canvas.removeEventListener('webglcontextlost', lost);
      // Resources only, never loseContext(): the browser hands the same context back to the next
      // Zen on this canvas (React's development double-mount does exactly that), and a context lost
      // on purpose stays lost, so every shader after it failed
      freeTarget(scene); freeTarget(glowA); freeTarget(glowB);
      for (const p of Object.values(P)) gl.deleteProgram(p.program);
      gl.deleteBuffer(quad);
      gl.deleteTexture(empty);
    }
  };
}
