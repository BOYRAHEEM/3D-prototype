import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { connectedPct, STAR_POSITIONS, starScores, suggestedOrder } from './tasks';

const seg = (a: Vector3, b: Vector3, n = 20) => ({ points: Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n)), radius: 0.01 });

describe('connectedPct', () => {
  it('is 100% for a closed triangle made of three joined lines', () => {
    const A = new Vector3(0, 0, 0);
    const B = new Vector3(0.3, 0, 0);
    const C = new Vector3(0.15, 0.3, 0);
    expect(connectedPct([seg(A, B), seg(B, C), seg(C, A)])).toBe(100);
  });

  it('counts a near-miss in depth as not connected', () => {
    const A = new Vector3(0, 0, 0);
    const B = new Vector3(0.3, 0, 0);
    const B2 = new Vector3(0.3, 0, 0.05); // 5 cm behind B
    const C = new Vector3(0.3, 0.3, 0);
    expect(connectedPct([seg(A, B), seg(B2, C)])).toBe(0);
  });

  it('counts T-junctions (an end touching the middle of another line)', () => {
    const base = seg(new Vector3(-0.2, 0, 0), new Vector3(0.2, 0, 0));
    const stem = seg(new Vector3(0, 0, 0), new Vector3(0, 0.3, 0));
    expect(connectedPct([base, stem])).toBe(25); // 1 of 4 ends joined: the stem's bottom
  });
});

describe('starScores', () => {
  it('scores a perfect star path as 100% hit with ~0 error', () => {
    const strokes = STAR_POSITIONS.slice(1).map((p, i) => seg(STAR_POSITIONS[i], p));
    const s = starScores(strokes);
    expect(s.hitPct).toBe(100);
    expect(s.errorCm).toBeLessThan(0.01);
  });

  it('measures how far a flat drawing misses stars at other depths', () => {
    const flat = STAR_POSITIONS.slice(1).map((p, i) => seg(STAR_POSITIONS[i].clone().setZ(0), p.clone().setZ(0)));
    const s = starScores(flat);
    expect(s.hitPct).toBeLessThan(50);
    expect(s.errorCm).toBeGreaterThan(10);
  });
});

describe('suggestedOrder', () => {
  it('counterbalances by participant number', () => {
    expect(suggestedOrder('P01')[0].condition).toBe('off');
    expect(suggestedOrder('P02')[0].condition).toBe('on');
    expect(suggestedOrder('P02')).toHaveLength(6);
  });
});
