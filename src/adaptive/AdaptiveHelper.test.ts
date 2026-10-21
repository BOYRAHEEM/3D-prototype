import { describe, expect, it } from 'vitest';
import { AdaptiveHelper } from './AdaptiveHelper';
import { WOBBLE_REF } from './metrics';

const clean = { wobble: 0, missedConnections: 0 };
const missing = { wobble: 0, missedConnections: 2 };
const wobbly = { wobble: WOBBLE_REF * 1.5, missedConnections: 0 };

describe('AdaptiveHelper', () => {
  it('stays quiet for a user who draws cleanly', () => {
    const a = new AdaptiveHelper();
    for (let i = 0; i < 20; i++) expect(a.record(clean)).toEqual([]);
    expect(a.state).toEqual({ depthGuides: false, snapping: false, beautify: false });
  });

  it('does not react to a single bad stroke', () => {
    const a = new AdaptiveHelper();
    [clean, clean, clean, missing, clean, clean].forEach((m) => a.record(m));
    expect(a.state.depthGuides).toBe(false);
  });

  it('turns depth help on for repeated near-misses, with a reason', () => {
    const a = new AdaptiveHelper();
    const changes = [missing, missing, missing].flatMap((m) => a.record(m));
    expect(a.state.depthGuides).toBe(true);
    expect(a.state.snapping).toBe(true);
    expect(changes[0].on).toBe(true);
    expect(changes[0].reason).toMatch(/missed/);
  });

  it('fades depth help out after sustained improvement, not immediately', () => {
    const a = new AdaptiveHelper();
    [missing, missing, missing].forEach((m) => a.record(m));
    a.record(clean);
    expect(a.state.depthGuides).toBe(true); // one good stroke is not enough
    for (let i = 0; i < 8; i++) a.record(clean);
    expect(a.state.depthGuides).toBe(false);
  });

  it('does not flicker when performance hovers around the threshold', () => {
    const a = new AdaptiveHelper();
    let flips = 0;
    let prev = false;
    for (let i = 0; i < 40; i++) {
      a.record(i % 2 ? missing : clean);
      if (a.state.depthGuides !== prev) flips++;
      prev = a.state.depthGuides;
    }
    expect(flips).toBeLessThanOrEqual(1);
  });

  it('wobble triggers tidy shapes independently of depth help', () => {
    const a = new AdaptiveHelper();
    [wobbly, wobbly, wobbly].forEach((m) => a.record(m));
    expect(a.state.beautify).toBe(true);
    expect(a.state.depthGuides).toBe(false);
  });
});
