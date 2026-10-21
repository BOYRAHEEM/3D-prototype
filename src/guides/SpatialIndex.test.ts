import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SpatialIndex } from './SpatialIndex';

/** Brute-force reference answer to compare the grid search against. */
function bruteNearest(sets: Map<number, Vector3[]>, p: Vector3, max: number) {
  let best: { id: number; d: number } | null = null;
  for (const [id, pts] of sets) {
    for (const q of pts) {
      const d = q.distanceTo(p);
      if (d <= max && (!best || d < best.d)) best = { id, d };
    }
  }
  return best;
}

describe('SpatialIndex', () => {
  it('matches brute force on random data', () => {
    const idx = new SpatialIndex(0.1);
    const sets = new Map<number, Vector3[]>();
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let id = 1; id <= 40; id++) {
      const pts = Array.from({ length: 30 }, () => new Vector3(rnd(), rnd() + 1, rnd()));
      sets.set(id, pts);
      idx.insert(id, pts);
    }
    for (let t = 0; t < 200; t++) {
      const p = new Vector3(rnd() * 1.2, rnd() * 1.2 + 1, rnd() * 1.2);
      const got = idx.nearest(p, 0.5);
      const want = bruteNearest(sets, p, 0.5);
      if (!want) expect(got).toBeNull();
      else expect(got?.distance).toBeCloseTo(want.d, 9);
    }
  });

  it('forgets removed strokes and honours the skip filter', () => {
    const idx = new SpatialIndex();
    idx.insert(1, [new Vector3(0, 0, 0)]);
    idx.insert(2, [new Vector3(0.3, 0, 0)]);
    expect(idx.nearest(new Vector3(0.01, 0, 0), 1)?.strokeId).toBe(1);
    expect(idx.nearest(new Vector3(0.01, 0, 0), 1, (id) => id === 1)?.strokeId).toBe(2);
    idx.remove(1);
    expect(idx.nearest(new Vector3(0.01, 0, 0), 1)?.strokeId).toBe(2);
    expect(idx.nearest(new Vector3(0.01, 0, 0), 0.1)).toBeNull();
    expect(idx.strokeCount).toBe(1);
  });
});
