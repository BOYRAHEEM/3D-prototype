import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { classifyStroke, fitCircle2D, fitPlane, resample, symmetricEigen3 } from './fit';

// Seeded random numbers so tests are repeatable.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Add hand-like wobble: smooth low-frequency drift plus small jitter. */
function wobble(pts: Vector3[], amount: number, seed = 7): Vector3[] {
  const r = rng(seed);
  const phase = [r() * 3, r() * 3, r() * 3];
  return pts.map((p, i) => {
    const t = i / pts.length;
    return p
      .clone()
      .add(
        new Vector3(
          Math.sin(t * 9 + phase[0]) * amount + r() * amount * 0.4,
          Math.sin(t * 7 + phase[1]) * amount + r() * amount * 0.4,
          Math.sin(t * 8 + phase[2]) * amount + r() * amount * 0.4,
        ),
      );
  });
}

/** Rotate + move points so tests cover arbitrary 3D orientations. */
function place(pts: Vector3[], rot = new Euler(0.4, 0.9, 0.2), offset = new Vector3(0.3, 1.2, -0.4)): Vector3[] {
  const q = new Quaternion().setFromEuler(rot);
  return pts.map((p) => p.clone().applyQuaternion(q).add(offset));
}

const line = (len: number, n = 60) => Array.from({ length: n }, (_, i) => new Vector3((i / (n - 1)) * len, 0, 0));
const arc = (r: number, degrees: number, n = 80) =>
  Array.from({ length: n }, (_, i) => {
    const t = ((i / (n - 1)) * degrees * Math.PI) / 180;
    return new Vector3(r * Math.cos(t), r * Math.sin(t), 0);
  });
const polyline = (corners: Vector3[], perSide = 25) =>
  corners.slice(1).flatMap((c, k) => Array.from({ length: perSide }, (_, i) => corners[k].clone().lerp(c, i / perSide))).concat([corners.at(-1)!]);

describe('helpers', () => {
  it('eigen-decomposes a diagonal matrix', () => {
    const { values, vectors } = symmetricEigen3([
      [3, 0, 0],
      [0, 1, 0],
      [0, 0, 2],
    ]);
    expect(values.map((v) => +v.toFixed(6))).toEqual([1, 2, 3]);
    expect(Math.abs(vectors[0].y)).toBeCloseTo(1);
  });

  it('finds the normal of a tilted plane', () => {
    const pts = place(arc(0.3, 360));
    const plane = fitPlane(pts);
    const expected = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromEuler(new Euler(0.4, 0.9, 0.2)));
    expect(Math.abs(plane.normal.dot(expected))).toBeCloseTo(1, 5);
    expect(plane.rms).toBeLessThan(1e-9);
  });

  it('fits an exact circle', () => {
    const c = fitCircle2D(Array.from({ length: 20 }, (_, i) => [2 + 3 * Math.cos(i), -1 + 3 * Math.sin(i)] as [number, number]));
    expect(c!.cx).toBeCloseTo(2);
    expect(c!.cy).toBeCloseTo(-1);
    expect(c!.r).toBeCloseTo(3);
  });

  it('resamples to evenly spaced points', () => {
    const uneven = [0, 0.01, 0.02, 0.5, 1].map((x) => new Vector3(x, 0, 0));
    const out = resample(uneven, 5);
    expect(out.map((p) => +p.x.toFixed(6))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('classifyStroke', () => {
  it('recognises a wobbly straight line', () => {
    const fit = classifyStroke(place(wobble(line(0.8), 0.012)));
    expect(fit?.kind).toBe('line');
  });

  it('keeps the exact endpoints of a line', () => {
    const raw = place(wobble(line(0.6), 0.008));
    const fit = classifyStroke(raw)!;
    expect(fit.points[0].distanceTo(raw[0])).toBeLessThan(1e-9);
    expect(fit.points.at(-1)!.distanceTo(raw.at(-1)!)).toBeLessThan(1e-9);
  });

  it('recognises a wobbly circle in a tilted plane', () => {
    const fit = classifyStroke(place(wobble(arc(0.25, 365), 0.012)));
    expect(fit?.kind).toBe('circle');
  });

  it('recognises a wobbly half circle as an arc, with exact endpoints', () => {
    const raw = place(wobble(arc(0.3, 180), 0.01));
    const fit = classifyStroke(raw)!;
    expect(fit.kind).toBe('arc');
    expect(fit.points[0].distanceTo(raw[0])).toBeLessThan(1e-9);
    expect(fit.points.at(-1)!.distanceTo(raw.at(-1)!)).toBeLessThan(1e-9);
  });

  it('leaves a square alone (not a circle)', () => {
    const s = 0.4;
    const square = polyline([new Vector3(0, 0, 0), new Vector3(s, 0, 0), new Vector3(s, s, 0), new Vector3(0, s, 0), new Vector3(0, 0, 0)]);
    expect(classifyStroke(place(wobble(square, 0.004)))).toBeNull();
  });

  it('leaves an L-shaped corner alone', () => {
    const l = polyline([new Vector3(0, 0.4, 0), new Vector3(0, 0, 0), new Vector3(0.4, 0, 0)]);
    expect(classifyStroke(place(l))).toBeNull();
  });

  it('leaves a zig-zag alone', () => {
    const z = polyline([0, 1, 2, 3, 4, 5].map((i) => new Vector3(i * 0.1, i % 2 ? 0.1 : 0, 0)), 8);
    expect(classifyStroke(place(z))).toBeNull();
  });

  it('leaves a very messy line alone', () => {
    expect(classifyStroke(place(wobble(line(0.5), 0.06)))).toBeNull();
  });

  it('ignores tiny strokes', () => {
    expect(classifyStroke(line(0.03))).toBeNull();
  });
});
