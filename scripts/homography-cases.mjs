// Projection mapping maths: the warp that puts a rectangle of content onto a four-cornered
// patch of wall. Run with `node scripts/homography-cases.mjs`.
import { solveHomography, applyHomography, homographyToMatrix3d, isConvexQuad, quadBounds } from '../src/utils/homography.js';

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); console.log('  FAIL ', name); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const cornersLand = (w, h, dst) => {
  const H = solveHomography(w, h, dst);
  if (!H) return false;
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  return src.every(([x, y], k) => {
    const [X, Y] = applyHomography(H, x, y);
    return near(X, dst[k][0], 1e-4) && near(Y, dst[k][1], 1e-4);
  });
};

// Identity: the rectangle onto itself
{
  const H = solveHomography(400, 300, [[0, 0], [400, 0], [400, 300], [0, 300]]);
  check('identity solves', H && near(H[0], 1) && near(H[4], 1) && near(H[6], 0) && near(H[7], 0));
  check('identity matrix3d is the identity', homographyToMatrix3d(H) === 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
}

// Translation and scale
check('a moved, scaled rectangle lands on its corners', cornersLand(200, 100, [[50, 60], [450, 60], [450, 260], [50, 260]]));

// Perspective: the right wall of a corner, receding
check('a trapezoid (wall seen at an angle) lands on its corners', cornersLand(600, 400, [[100, 80], [700, 160], [700, 440], [100, 520]]));
check('an arbitrary convex quad lands on its corners', cornersLand(300, 300, [[120, 40], [880, 90], [820, 640], [60, 580]]));
check('a quad with fractional (viewport-relative) coordinates works too', cornersLand(1, 1, [[0.1, 0.1], [0.45, 0.2], [0.5, 0.9], [0.05, 0.8]]));

// The perspective terms are non-zero only when the quad is not a parallelogram
{
  const flat = solveHomography(100, 100, [[10, 10], [110, 20], [120, 120], [20, 110]]); // parallelogram
  check('a parallelogram needs no perspective', flat && near(flat[6], 0, 1e-9) && near(flat[7], 0, 1e-9));
  const tilted = solveHomography(100, 100, [[0, 0], [100, 30], [100, 70], [0, 100]]);
  check('a trapezoid does need perspective', tilted && Math.abs(tilted[6]) > 1e-6);
}

// Degenerate input
check('a zero-size source is rejected', solveHomography(0, 100, [[0, 0], [1, 0], [1, 1], [0, 1]]) === null);
check('three collinear corners are rejected', solveHomography(100, 100, [[0, 0], [100, 0], [200, 0], [0, 100]]) === null);
check('a missing corner is rejected', solveHomography(100, 100, [[0, 0], [100, 0], [100, 100]]) === null);
check('a non-numeric corner is rejected', solveHomography(100, 100, [[0, 0], [100, 0], [100, 100], [0, NaN]]) === null);
check('matrix3d of a failed solve is none', homographyToMatrix3d(null) === 'none');

// Convexity and bounds
check('a square is convex', isConvexQuad([[0, 0], [1, 0], [1, 1], [0, 1]]));
check('a bow-tie is not', !isConvexQuad([[0, 0], [1, 1], [1, 0], [0, 1]]));
check('a quad with no area is not', !isConvexQuad([[0, 0], [1, 0], [2, 0], [3, 0]]));
{
  const b = quadBounds([[120, 40], [880, 90], [820, 640], [60, 580]]);
  check('bounds cover the quad', b.left === 60 && b.top === 40 && b.width === 820 && b.height === 600);
}

// Text fitting (projector widgets size their text to the surface)
{
  const { fitFontSize } = await import('../src/utils/fitText.js');
  const short = fitFontSize('Hi', 1000, 300, 3);
  const long = fitFontSize('The Less I Know The Better', 1000, 300, 3);
  const epic = fitFontSize('A very long song title that goes on and on and on for quite some time indeed', 400, 120, 3);
  check('short text fills the height', short >= 250);
  check('a long title is smaller than a short one', long < short && long > 40);
  check('a very long title in a small box still fits three lines', epic >= 6 && epic * 1.05 * 3 <= 120 + 1);
  check('never below the floor', fitFontSize('x'.repeat(5000), 10, 10, 1) >= 6);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
console.log('');
