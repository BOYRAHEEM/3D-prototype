import { describe, expect, it } from 'vitest';
import { AxisStepper, ButtonEdge } from './xrInput';

describe('AxisStepper', () => {
  it('fires once per flick, not every frame', () => {
    const s = new AxisStepper();
    const frames = [0, 0.5, 0.8, 0.9, 1, 0.9, 0.5, 0.2, 0, 0.75, 0.75];
    expect(frames.map((v) => s.update(v))).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it('reports direction and needs a return to centre before firing again', () => {
    const s = new AxisStepper();
    expect(s.update(-0.9)).toBe(-1);
    expect(s.update(0.9)).toBe(0); // still disarmed: no return through the dead zone
    expect(s.update(0.1)).toBe(0);
    expect(s.update(0.9)).toBe(1);
  });
});

describe('ButtonEdge', () => {
  it('reports only the press moment', () => {
    const b = new ButtonEdge();
    expect([false, true, true, false, true].map((d) => b.update(d))).toEqual([false, true, false, false, true]);
  });
});
