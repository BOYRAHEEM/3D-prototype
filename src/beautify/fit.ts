/**
 * Shape fitting for stroke beautification. Pure maths, no scene or DOM, so
 * it is unit-tested in fit.test.ts.
 *
 * Given the points of a hand-drawn 3D stroke, decide whether it is "close
 * to" a straight line, a circle or an arc, and if so produce a clean version.
 *
 * Pipeline:
 *   1. Resample the stroke to evenly spaced points, so slow (dense) parts of a
 *      stroke don't outweigh fast (sparse) parts.
 *   2. LINE:   compare the points to the straight segment start→end.
 *   3. PLANE:  find the best-fit plane (PCA: the direction of least variance
 *              is the plane's normal). Circles and arcs must be nearly flat.
 *   4. CIRCLE: project onto that plane and fit a circle with the Kåsa
 *              algebraic least-squares method (one small linear solve, no
 *              iteration). The swept angle around the centre says whether
 *              it is a full circle (≥ 300°) or an arc.
 *   5. Each candidate gets a *normalised* error (RMS deviation divided by the
 *      shape's size), so a 2 cm wobble counts more on a small circle than on
 *      a long line. A shape is offered only if its error is under a threshold.
 *
 * Clean shapes keep the user's exact start and end points wherever possible,
 * so connections made with snapping survive beautification.
 */
import { Vector3 } from 'three';

export type ShapeKind = 'line' | 'circle' | 'arc';

export interface ShapeFit {
  kind: ShapeKind;
  /** Clean replacement points. */
  points: Vector3[];
  /** Normalised RMS error (dimensionless, ~0 = perfect). */
  error: number;
  /** error / threshold for this kind: < 1 means "close enough". */
  score: number;
}

/** Thresholds (normalised RMS error) tuned on synthetic tests + hand drawing. */
export const THRESHOLDS = {
  line: 0.035, // RMS distance from the chord, as a fraction of its length
  circle: 0.085, // RMS radial error, as a fraction of the radius
  arc: 0.06,
  planarity: 0.15, // RMS distance from the best plane, as a fraction of the radius
};

const MIN_LENGTH = 0.06; // strokes shorter than 6 cm are left alone (dots, dashes)
const RESAMPLE_N = 64;

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

export function pathLength(pts: readonly Vector3[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  return len;
}

/** Resample a polyline to `n` points evenly spaced along its length. */
export function resample(pts: readonly Vector3[], n: number): Vector3[] {
  if (pts.length < 2) return pts.map((p) => p.clone());
  const total = pathLength(pts);
  const step = total / (n - 1);
  const out = [pts[0].clone()];
  let seg = 1;
  let segStart = 0; // distance along the path where segment `seg` begins
  for (let k = 1; k < n - 1; k++) {
    const target = k * step;
    while (seg < pts.length - 1 && segStart + pts[seg].distanceTo(pts[seg - 1]) < target) {
      segStart += pts[seg].distanceTo(pts[seg - 1]);
      seg++;
    }
    const a = pts[seg - 1];
    const b = pts[seg];
    const segLen = a.distanceTo(b) || 1;
    out.push(a.clone().lerp(b, Math.min(1, (target - segStart) / segLen)));
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

function centroid(pts: readonly Vector3[]): Vector3 {
  const c = new Vector3();
  pts.forEach((p) => c.add(p));
  return c.divideScalar(pts.length);
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / Math.max(1, values.length));
}

/**
 * Eigen-decomposition of a symmetric 3×3 matrix with the Jacobi method:
 * repeatedly rotate away the largest off-diagonal entry until the matrix is
 * diagonal. Returns eigenvalues ascending with matching unit eigenvectors.
 */
export function symmetricEigen3(m: number[][]): { values: number[]; vectors: Vector3[] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    // Find the largest off-diagonal element.
    let p = 0;
    let q = 1;
    if (Math.abs(a[0][2]) > Math.abs(a[p][q])) [p, q] = [0, 2];
    if (Math.abs(a[1][2]) > Math.abs(a[p][q])) [p, q] = [1, 2];
    if (Math.abs(a[p][q]) < 1e-12) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k];
      const aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const pairs = [0, 1, 2].map((i) => ({ value: a[i][i], vector: new Vector3(v[0][i], v[1][i], v[2][i]).normalize() }));
  pairs.sort((x, y) => x.value - y.value);
  return { values: pairs.map((x) => x.value), vectors: pairs.map((x) => x.vector) };
}

// ---------------------------------------------------------------------------
// Plane + circle fitting
// ---------------------------------------------------------------------------

export interface PlaneFit {
  center: Vector3;
  normal: Vector3;
  /** Orthonormal in-plane axes. */
  u: Vector3;
  v: Vector3;
  /** RMS distance of the points from the plane. */
  rms: number;
}

/** Best-fit plane by PCA: the eigenvector with the smallest eigenvalue is the normal. */
export function fitPlane(pts: readonly Vector3[]): PlaneFit {
  const c = centroid(pts);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const d = new Vector3();
  for (const p of pts) {
    d.subVectors(p, c);
    const arr = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += arr[i] * arr[j];
  }
  const { vectors } = symmetricEigen3(cov);
  const normal = vectors[0];
  const u = vectors[2]; // direction of greatest spread
  const v = new Vector3().crossVectors(normal, u).normalize();
  const dist = pts.map((p) => d.subVectors(p, c).dot(normal));
  return { center: c, normal, u, v, rms: rms(dist) };
}

export interface CircleFit2D {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Kåsa circle fit. A circle satisfies x² + y² + D·x + E·y + F = 0, which is
 * *linear* in D, E, F, so least squares is a 3×3 linear system. Centre is
 * (−D/2, −E/2), radius √(cx² + cy² − F).
 */
export function fitCircle2D(xy: readonly [number, number][]): CircleFit2D | null {
  // Normal equations AᵀA·[D E F]ᵀ = Aᵀb with rows [x, y, 1] and b = −(x² + y²).
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0;
  let bx = 0, by = 0, b1 = 0;
  for (const [x, y] of xy) {
    const z = -(x * x + y * y);
    sxx += x * x; sxy += x * y; sx += x;
    syy += y * y; sy += y; n++;
    bx += x * z; by += y * z; b1 += z;
  }
  const sol = solve3(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [bx, by, b1],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  return r2 > 0 ? { cx, cy, r: Math.sqrt(r2) } : null;
}

/** Circle through three 2D points (circumcircle), or null if they are collinear. */
export function circleThrough3(a: [number, number], b: [number, number], c: [number, number]): CircleFit2D | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/** Cramer's rule for a 3×3 system. */
function solve3(m: number[][], b: number[]): number[] | null {
  const det = (x: number[][]) =>
    x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
    x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
    x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  const D = det(m);
  if (Math.abs(D) < 1e-18) return null;
  return [0, 1, 2].map((col) => det(m.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))) / D);
}

/** Total signed angle swept around (cx, cy), following the points in order. */
export function sweptAngle(xy: readonly [number, number][], cx: number, cy: number): number {
  let total = 0;
  let prev = Math.atan2(xy[0][1] - cy, xy[0][0] - cx);
  for (let i = 1; i < xy.length; i++) {
    const ang = Math.atan2(xy[i][1] - cy, xy[i][0] - cx);
    let d = ang - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = ang;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function lineCandidate(pts: readonly Vector3[], length: number): ShapeFit | null {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = a.distanceTo(b);
  // A line must be fairly direct: the chord at least 90% of the path length.
  if (chord < MIN_LENGTH || chord / length < 0.9) return null;
  const dir = new Vector3().subVectors(b, a).normalize();
  const tmp = new Vector3();
  const dists = pts.map((p) => {
    tmp.subVectors(p, a);
    return tmp.sub(dir.clone().multiplyScalar(tmp.dot(dir))).length();
  });
  const error = rms(dists) / chord;
  const n = Math.max(2, Math.ceil(chord / 0.02));
  const clean = Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n));
  return { kind: 'line', points: clean, error, score: error / THRESHOLDS.line };
}

function circularCandidate(pts: readonly Vector3[], length: number): ShapeFit | null {
  const plane = fitPlane(pts);
  const xy = pts.map((p) => {
    const d = p.clone().sub(plane.center);
    return [d.dot(plane.u), d.dot(plane.v)] as [number, number];
  });
  const circle = fitCircle2D(xy);
  if (!circle) return null;
  const { cx, cy, r } = circle;
  // Reject absurd fits: a nearly straight stroke "fits" a gigantic circle.
  if (r < 0.02 || r > length) return null;
  if (plane.rms / r > THRESHOLDS.planarity) return null;

  const radial = xy.map(([x, y]) => Math.hypot(x - cx, y - cy) - r);
  const error = rms(radial) / r;
  const sweep = sweptAngle(xy, cx, cy);
  const absSweep = Math.abs(sweep);
  const toWorld = (x: number, y: number) =>
    plane.center.clone().addScaledVector(plane.u, x).addScaledVector(plane.v, y);

  if (absSweep >= (300 * Math.PI) / 180) {
    // Full circle: start where the user started, go round in their direction.
    const a0 = Math.atan2(xy[0][1] - cy, xy[0][0] - cx);
    const dirSign = Math.sign(sweep);
    const n = 72;
    const clean = Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + dirSign * ((i % n) / n) * Math.PI * 2;
      return toWorld(cx + r * Math.cos(t), cy + r * Math.sin(t));
    });
    return { kind: 'circle', points: clean, error, score: error / THRESHOLDS.circle };
  }

  if (absSweep >= (40 * Math.PI) / 180) {
    // Arc: rebuild it through the exact start, end and (projected) middle so
    // that snapped endpoints stay connected.
    const mid = xy[Math.floor(xy.length / 2)];
    const ma = Math.atan2(mid[1] - cy, mid[0] - cx);
    const midOnCircle: [number, number] = [cx + r * Math.cos(ma), cy + r * Math.sin(ma)];
    const arc = circleThrough3(xy[0], midOnCircle, xy[xy.length - 1]);
    if (!arc) return null;
    const s = sweptAngle([xy[0], midOnCircle, xy[xy.length - 1]], arc.cx, arc.cy);
    const a0 = Math.atan2(xy[0][1] - arc.cy, xy[0][0] - arc.cx);
    // Out-of-plane offsets of the true endpoints, blended along the arc,
    // put the clean arc's ends exactly on the user's ends.
    const offA = pts[0].clone().sub(plane.center).dot(plane.normal);
    const offB = pts[pts.length - 1].clone().sub(plane.center).dot(plane.normal);
    const n = Math.max(8, Math.ceil((Math.abs(s) * arc.r) / 0.02));
    const clean = Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const ang = a0 + s * t;
      return toWorld(arc.cx + arc.r * Math.cos(ang), arc.cy + arc.r * Math.sin(ang)).addScaledVector(
        plane.normal,
        offA + (offB - offA) * t,
      );
    });
    clean[0].copy(pts[0]);
    clean[n].copy(pts[pts.length - 1]);
    return { kind: 'arc', points: clean, error, score: error / THRESHOLDS.arc };
  }
  return null;
}

/**
 * Classify a stroke. Returns the best-scoring shape whose error is under its
 * threshold, or null if the stroke is not close to any simple shape (most
 * free-form doodles).
 */
export function classifyStroke(raw: readonly Vector3[]): ShapeFit | null {
  if (raw.length < 6) return null;
  const length = pathLength(raw);
  if (length < MIN_LENGTH) return null;

  const pts = resample(raw, RESAMPLE_N);
  // Keep the true endpoints (resampling already does, but be explicit).
  pts[0].copy(raw[0]);
  pts[pts.length - 1].copy(raw[raw.length - 1]);

  const candidates = [lineCandidate(pts, length), circularCandidate(pts, length)].filter(
    (c): c is ShapeFit => !!c && c.score < 1,
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}
