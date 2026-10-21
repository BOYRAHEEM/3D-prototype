/**
 * Per-stroke measurements. Used for two things:
 *   - adaptive help: deciding whether the user is struggling;
 *   - logging: the numbers behind the study results.
 *
 * All functions are pure (points in, numbers out) and unit-tested.
 *
 * Definitions (all distances in metres):
 *
 *   meanJitter     High-frequency shake. The stroke is resampled every 5 mm
 *                  and for each point we measure how far it sits from the
 *                  midpoint of its two neighbours (a discrete 2nd derivative).
 *                  A smooth curve gives ~0; tremor gives larger values.
 *
 *   wobble         Lower-frequency waviness. RMS distance between the stroke
 *                  and a smoothed copy of itself (moving average over ±2.5 cm).
 *                  This is what makes a line "look wobbly".
 *
 *   depthVariance  Variance of the points' distance from the viewer along the
 *                  view direction (m²). How much the stroke moves in depth:
 *                  intended for frontal strokes, unintended depth drift is the
 *                  typical 3D-sketching error, especially in VR.
 *
 *   missedConnections  Number of this stroke's ends (0–2) that stop *near*
 *                  another stroke's end without touching it: closer than
 *                  MISS_MAX but further than the tubes' combined thickness.
 *                  That near-miss pattern signals that depth was misjudged.
 */
import { Vector3 } from 'three';
import { pathLength, resample } from '../beautify/fit';

export const MISS_MAX = 0.12;
/** Wobble (m) we treat as "clearly wobbly" (normalised score 1). */
export const WOBBLE_REF = 0.004;

export interface StrokeMetrics {
  pointCount: number;
  pathLength: number;
  durationMs: number;
  meanJitter: number;
  wobble: number;
  depthVariance: number;
  missedConnections: number;
  /** Distance from each end to the nearest other endpoint (null if none within MISS_MAX). */
  endGaps: [number | null, number | null];
}

function resampleBySpacing(points: readonly Vector3[], spacing: number): Vector3[] {
  const len = pathLength(points);
  const n = Math.min(2000, Math.max(3, Math.ceil(len / spacing) + 1));
  return resample(points, n);
}

export function meanJitter(points: readonly Vector3[]): number {
  if (points.length < 3) return 0;
  const p = resampleBySpacing(points, 0.005);
  if (p.length < 3) return 0;
  const mid = new Vector3();
  let sum = 0;
  for (let i = 1; i < p.length - 1; i++) {
    mid.addVectors(p[i - 1], p[i + 1]).multiplyScalar(0.5);
    sum += p[i].distanceTo(mid);
  }
  return sum / (p.length - 2);
}

export function wobble(points: readonly Vector3[]): number {
  if (points.length < 3) return 0;
  const p = resampleBySpacing(points, 0.005);
  const half = 5; // ±5 samples × 5 mm = ±2.5 cm window
  if (p.length < half * 2 + 1) return 0;
  const avg = new Vector3();
  let sumSq = 0;
  let n = 0;
  // Skip the ends, where the window would be lopsided.
  for (let i = half; i < p.length - half; i++) {
    avg.set(0, 0, 0);
    for (let k = -half; k <= half; k++) avg.add(p[i + k]);
    avg.divideScalar(half * 2 + 1);
    sumSq += p[i].distanceToSquared(avg);
    n++;
  }
  return Math.sqrt(sumSq / n);
}

export function depthVariance(points: readonly Vector3[], eye: Vector3, viewDir: Vector3): number {
  if (points.length < 2) return 0;
  const dir = viewDir.clone().normalize();
  const tmp = new Vector3();
  const depths = points.map((p) => tmp.subVectors(p, eye).dot(dir));
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  return depths.reduce((a, d) => a + (d - mean) ** 2, 0) / depths.length;
}

/** A gap counts as a miss if the ends nearly meet but visibly don't touch. */
export function isMiss(gap: number | null, brushRadius: number): boolean {
  return gap !== null && gap > brushRadius * 1.5 && gap < MISS_MAX;
}

/**
 * One number per stroke, 0 (clean) … 1 (struggling), combining wobble and
 * missed connections. Each half saturates so a single terrible stroke can't
 * dominate the running average.
 */
export function strokeErrorScore(m: Pick<StrokeMetrics, 'wobble' | 'missedConnections'>): number {
  return 0.5 * Math.min(1, m.wobble / WOBBLE_REF) + 0.5 * Math.min(1, m.missedConnections / 1);
}

/** Assemble all metrics for one stroke. `endGaps` come from the snapper's endpoint search. */
export function computeStrokeMetrics(input: {
  points: readonly Vector3[];
  durationMs: number;
  endGaps: [number | null, number | null];
  brushRadius: number;
  eye: Vector3;
  viewDir: Vector3;
}): StrokeMetrics {
  const { points, endGaps, brushRadius } = input;
  return {
    pointCount: points.length,
    pathLength: pathLength(points),
    durationMs: input.durationMs,
    meanJitter: meanJitter(points),
    wobble: wobble(points),
    depthVariance: depthVariance(points, input.eye, input.viewDir),
    missedConnections: endGaps.filter((g) => isMiss(g, brushRadius)).length,
    endGaps,
  };
}
