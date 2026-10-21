import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { depthVariance, isMiss, meanJitter, strokeErrorScore, wobble } from './metrics';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}
const line = (n = 100, len = 0.5) => Array.from({ length: n }, (_, i) => new Vector3((i / (n - 1)) * len, 1, 0));
const noisy = (pts: Vector3[], amount: number, seed = 3) => {
  const r = rng(seed);
  return pts.map((p) => p.clone().add(new Vector3(0, r() * amount, r() * amount)));
};

describe('metrics', () => {
  it('a perfect line has no jitter and no wobble', () => {
    expect(meanJitter(line())).toBeLessThan(1e-9);
    expect(wobble(line())).toBeLessThan(1e-9);
  });

  it('jitter and wobble grow with noise', () => {
    const small = noisy(line(), 0.001);
    const big = noisy(line(), 0.006);
    expect(meanJitter(big)).toBeGreaterThan(meanJitter(small) * 2);
    expect(wobble(big)).toBeGreaterThan(wobble(small) * 2);
  });

  it('a smooth large circle barely registers as wobbly', () => {
    const circle = Array.from({ length: 200 }, (_, i) => {
      const t = (i / 199) * Math.PI * 2;
      return new Vector3(0.25 * Math.cos(t), 1 + 0.25 * Math.sin(t), 0);
    });
    expect(wobble(circle)).toBeLessThan(0.001);
  });

  it('depth variance is zero for a stroke facing the viewer, positive when it recedes', () => {
    const eye = new Vector3(0, 1, 3);
    const dir = new Vector3(0, 0, -1);
    expect(depthVariance(line(), eye, dir)).toBeLessThan(1e-12);
    const receding = line().map((p) => new Vector3(0, 1, -p.x));
    expect(depthVariance(receding, eye, dir)).toBeCloseTo(0.5 ** 2 / 12, 2); // uniform spread over 0.5 m
  });

  it('classifies near-misses by gap size', () => {
    expect(isMiss(null, 0.016)).toBe(false);
    expect(isMiss(0.01, 0.016)).toBe(false); // tubes overlap: looks connected
    expect(isMiss(0.05, 0.016)).toBe(true);
    expect(isMiss(0.3, 0.016)).toBe(false); // far away: not trying to connect
  });

  it('error score is bounded 0..1', () => {
    expect(strokeErrorScore({ wobble: 0, missedConnections: 0 })).toBe(0);
    expect(strokeErrorScore({ wobble: 1, missedConnections: 2 })).toBe(1);
  });
});
