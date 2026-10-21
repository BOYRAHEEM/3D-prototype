/**
 * Adaptive help ("Smart help"): helpers that appear when needed and fade
 * away as the user improves.
 *
 * Idea (from scaffolding research in education): support should be
 * *contingent* (given when the learner struggles) and *faded* (withdrawn as
 * they become competent), rather than always on. Always-on guides clutter the
 * view and can become a crutch; never-on guides leave beginners stuck.
 *
 * How it decides:
 *   1. Each finished stroke yields two signals (see metrics.ts):
 *        missed: fraction of the stroke's ends that nearly met another end (0–1)
 *        wobble: wobble / WOBBLE_REF, capped at 1
 *   2. Each signal is smoothed with an exponential moving average (EMA), so
 *      one bad stroke doesn't trigger help and one good stroke doesn't remove it.
 *   3. Thresholds with *hysteresis* (turn on above a high mark, off only below
 *      a lower mark) plus a minimum number of strokes between changes stop
 *      helpers from flickering on and off.
 *
 *   missed connections → Depth guides + Magnet ends (a depth-judgement problem)
 *   wobbly strokes     → Tidy shapes (a motor-control problem)
 */
import { WOBBLE_REF, type StrokeMetrics } from './metrics';

export type ManagedHelper = 'depthGuides' | 'snapping' | 'beautify';

export interface AdaptiveChange {
  helpers: ManagedHelper[];
  on: boolean;
  /** Child-friendly explanation shown in the indicator and stored in the log. */
  reason: string;
}

export const ADAPTIVE_CONFIG = {
  alpha: 0.35, // EMA weight of the newest stroke
  warmup: 3, // strokes before the first decision
  minStrokesBetweenChanges: 4,
  missedOn: 0.4, // > alpha, so at least two bad strokes are needed
  missedOff: 0.1,
  wobbleOn: 0.6,
  wobbleOff: 0.3,
};

export class AdaptiveHelper {
  /** Which managed helpers Smart help currently has switched on. */
  readonly state: Record<ManagedHelper, boolean> = { depthGuides: false, snapping: false, beautify: false };
  emaMissed = 0;
  emaWobble = 0;
  strokes = 0;
  private lastChange = { depth: -Infinity, wobble: -Infinity };

  reset(): void {
    this.state.depthGuides = this.state.snapping = this.state.beautify = false;
    this.emaMissed = this.emaWobble = 0;
    this.strokes = 0;
    this.lastChange = { depth: -Infinity, wobble: -Infinity };
  }

  /** Feed one finished stroke; returns any helper changes it caused. */
  record(m: Pick<StrokeMetrics, 'wobble' | 'missedConnections'>): AdaptiveChange[] {
    const c = ADAPTIVE_CONFIG;
    const missed = Math.min(1, m.missedConnections / 2);
    const wob = Math.min(1, m.wobble / WOBBLE_REF);
    // Averages start at 0 ("assume competent"), so the first stroke only counts
    // for alpha (35%): one bad stroke on its own can never cross missedOn.
    this.emaMissed = c.alpha * missed + (1 - c.alpha) * this.emaMissed;
    this.emaWobble = c.alpha * wob + (1 - c.alpha) * this.emaWobble;
    this.strokes++;

    const changes: AdaptiveChange[] = [];
    if (this.strokes < c.warmup) return changes;

    // Depth problems → guides + snapping.
    const depthOn = this.state.depthGuides;
    const canChangeDepth = this.strokes - this.lastChange.depth >= c.minStrokesBetweenChanges;
    if (!depthOn && this.emaMissed > c.missedOn && canChangeDepth) {
      this.set(['depthGuides', 'snapping'], true, 'depth');
      changes.push({
        helpers: ['depthGuides', 'snapping'],
        on: true,
        reason: 'Some line ends just missed each other. Depth guides and magnet ends will help you join them up.',
      });
    } else if (depthOn && this.emaMissed < c.missedOff && canChangeDepth) {
      this.set(['depthGuides', 'snapping'], false, 'depth');
      changes.push({
        helpers: ['depthGuides', 'snapping'],
        on: false,
        reason: 'Great joining! The depth guides are fading away. You have got this.',
      });
    }

    // Wobbly strokes → tidy shapes.
    const tidyOn = this.state.beautify;
    const canChangeWobble = this.strokes - this.lastChange.wobble >= c.minStrokesBetweenChanges;
    if (!tidyOn && this.emaWobble > c.wobbleOn && canChangeWobble) {
      this.set(['beautify'], true, 'wobble');
      changes.push({ helpers: ['beautify'], on: true, reason: 'A few lines came out wobbly. Tidy shapes can straighten them for you.' });
    } else if (tidyOn && this.emaWobble < c.wobbleOff && canChangeWobble) {
      this.set(['beautify'], false, 'wobble');
      changes.push({ helpers: ['beautify'], on: false, reason: 'Your lines are nice and steady now, so tidy shapes is taking a rest.' });
    }
    return changes;
  }

  private set(helpers: ManagedHelper[], on: boolean, group: 'depth' | 'wobble'): void {
    helpers.forEach((h) => (this.state[h] = on));
    this.lastChange[group] = this.strokes;
  }
}
