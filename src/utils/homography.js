// Projection mapping: a flat rectangle of content drawn onto a four-cornered patch of wall.
//
// A projective transform (homography) maps the rectangle's corners onto any convex quad. CSS
// can apply one directly as matrix3d, so each surface is an ordinary element the browser
// warps for us; no WebGL and no per-frame work.

// Solves the 8 unknowns of the homography taking (0,0) (w,0) (w,h) (0,h) to the four `dst`
// corners, given in the same order (top-left, top-right, bottom-right, bottom-left).
// Returns the 3x3 matrix as a flat row-major array, or null for a degenerate quad.
export function solveHomography(w, h, dst) {
  if (!(w > 0) || !(h > 0) || !Array.isArray(dst) || dst.length !== 4) return null;
  // A rectangle can only ever land on a convex quad with area; anything else has no solution
  // worth drawing (and a near-singular system would return nonsense rather than fail)
  if (!isConvexQuad(dst)) return null;
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  // Eight equations in a b c d e f g i (the matrix is [[a b c] [d e f] [g i 1]])
  const rows = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k];
    const [X, Y] = dst[k];
    if (![X, Y].every(Number.isFinite)) return null;
    rows.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    rows.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  const solution = gaussianElimination(rows);
  if (!solution) return null;
  const [a, b, c, d, e, f, g, i] = solution;
  return [a, b, c, d, e, f, g, i, 1];
}

// Gauss-Jordan with partial pivoting on an augmented 8x9 system
function gaussianElimination(rows) {
  const n = rows.length;
  const m = rows.map((r) => r.slice());
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((r) => r[n]);
}

// Applies a homography to a point
export function applyHomography(H, x, y) {
  const [a, b, c, d, e, f, g, i, j] = H;
  const wv = g * x + i * y + j;
  return [(a * x + b * y + c) / wv, (d * x + e * y + f) / wv];
}

// The CSS transform for an element of size w x h at (0,0) with transform-origin 0 0, so that
// its corners land on `dst`. matrix3d is column-major; the homography's z row and column are
// the identity, and its perspective terms go in the fourth row.
export function homographyToMatrix3d(H) {
  if (!H) return 'none';
  const [a, b, c, d, e, f, g, i] = H;
  const v = [a, d, 0, g, b, e, 0, i, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${v.map((n) => (Math.abs(n) < 1e-12 ? 0 : Number(n.toFixed(8)))).join(',')})`;
}

export function cssWarp(w, h, dst) {
  return homographyToMatrix3d(solveHomography(w, h, dst));
}

// A quad is drawable when its corners run the same way round (no bow-tie) and it has area
export function isConvexQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = corners[k];
    const [x1, y1] = corners[(k + 1) % 4];
    const [x2, y2] = corners[(k + 2) % 4];
    const cross = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// Axis-aligned bounds of a quad, for sizing the content box it is drawn from
export function quadBounds(corners) {
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

// The inverse, for going the other way: from a point on the screen back to where it sits on the
// flat rectangle the wall was drawn from. Null when the matrix has no inverse.
export function invertHomography(H) {
  if (!H) return null;
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d
  ].map((n) => n / det);
  // Normalise so the last entry is 1, the form applyHomography expects
  const k = inv[8];
  return Math.abs(k) < 1e-12 ? inv : inv.map((n) => n / k);
}

// Whether a point lies inside a convex quad (corners in order round the shape)
export function pointInQuad(corners, x, y) {
  if (!isConvexQuad(corners)) return false;
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = corners[k];
    const [x1, y1] = corners[(k + 1) % 4];
    const cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
