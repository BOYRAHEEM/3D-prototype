/**
 * Study tasks and how each finished drawing is scored.
 *
 * The three tasks exercise the core 3D-sketching skill at rising difficulty:
 *
 *   cube   12 edges that must meet at 8 corners: tests joining lines in depth.
 *   house  a cube plus a roof: more joins, including slanted ones.
 *   stars  six glowing stars float at *different depths*; connect them in
 *          order. Unlike the other two it has a ground truth, so accuracy can
 *          be measured directly as the distance from each star to the drawing.
 *
 * Scores are computed from the final drawing (after any tidy-shape swaps),
 * because that is what the participant actually produced.
 */
import { Vector3 } from 'three';
import type { TaskId } from '../logging/InteractionLog';

export interface TaskDef {
  id: TaskId;
  title: string;
  instruction: string;
  /** Simple line-art preview, as SVG path data in a 48×48 box. */
  preview: string[];
}

export const TASKS: Record<TaskId, TaskDef> = {
  cube: {
    id: 'cube',
    title: 'Draw a cube',
    instruction: 'Draw all 12 edges of a box. Try to make the corners meet!',
    preview: ['M10 18h22v22H10z', 'M10 18l8-8h22l-8 8', 'M40 10v22l-8 8'],
  },
  house: {
    id: 'house',
    title: 'Draw a house',
    instruction: 'Draw a box for the walls, then a pointy roof on top.',
    preview: ['M10 24h22v18H10z', 'M10 24l11-12 11 12', 'M32 24l8-8v18l-8 8', 'M21 12l8-8 11 12'],
  },
  stars: {
    id: 'stars',
    title: 'Connect the stars',
    instruction: 'Draw lines from star 1 to star 6, in order. Some stars are far away and some are close!',
    preview: ['M8 36l12-20 10 14 10-22', 'M8 36h.01M20 16h.01M30 30h.01M40 8h.01'],
  },
};

export const TASK_ORDER: TaskId[] = ['cube', 'house', 'stars'];

/**
 * Star positions: a zig-zag path that also moves forwards and backwards in
 * depth (z from −0.35 to +0.35 m), so that judging depth is required.
 */
export const STAR_POSITIONS: Vector3[] = [
  new Vector3(-0.6, 1.45, -0.3),
  new Vector3(-0.3, 0.95, 0.3),
  new Vector3(0.0, 1.55, -0.1),
  new Vector3(0.25, 0.85, -0.35),
  new Vector3(0.45, 1.4, 0.35),
  new Vector3(0.7, 1.0, 0.0),
];

/** A star counts as "reached" if the drawing passes within this distance. */
export const STAR_HIT_DISTANCE = 0.04;

export interface ScoredStroke {
  points: readonly Vector3[];
  radius: number;
}

/**
 * Percentage of stroke ends that touch another stroke (its end or anywhere
 * along it) or close their own loop. 100% means every line is joined up.
 */
export function connectedPct(strokes: readonly ScoredStroke[]): number {
  let ends = 0;
  let connected = 0;
  strokes.forEach((s, i) => {
    if (s.points.length < 2) return; // dots have no ends to join
    for (const end of [s.points[0], s.points[s.points.length - 1]]) {
      ends++;
      const other = s.points[0] === end ? s.points[s.points.length - 1] : s.points[0];
      // A closed loop's ends touch each other.
      if (end.distanceTo(other) <= s.radius * 2 && s.points.length > 4) {
        connected++;
        continue;
      }
      const touches = strokes.some(
        (t, j) => j !== i && t.points.some((q) => q.distanceTo(end) <= s.radius + t.radius + 0.002),
      );
      if (touches) connected++;
    }
  });
  return ends === 0 ? 0 : (connected / ends) * 100;
}

/** Distance from each star to the nearest point of the drawing. */
export function starScores(strokes: readonly ScoredStroke[], stars = STAR_POSITIONS): { errorCm: number; hitPct: number } {
  if (strokes.length === 0) return { errorCm: NaN, hitPct: 0 };
  const dists = stars.map((star) => {
    let best = Infinity;
    for (const s of strokes) for (const p of s.points) best = Math.min(best, p.distanceTo(star));
    return best;
  });
  const hits = dists.filter((d) => d <= STAR_HIT_DISTANCE).length;
  return { errorCm: (dists.reduce((a, b) => a + b, 0) / dists.length) * 100, hitPct: (hits / stars.length) * 100 };
}

/**
 * Counterbalanced order for a participant: odd-numbered participants start
 * each task with helpers OFF, even-numbered with helpers ON, so learning
 * effects (getting better on the second try) don't all favour one condition.
 */
export function suggestedOrder(participantId: string): { task: TaskId; condition: 'off' | 'on' }[] {
  const n = parseInt(participantId.replace(/\D/g, ''), 10);
  const offFirst = Number.isNaN(n) || n % 2 === 1;
  return TASK_ORDER.flatMap((task) =>
    offFirst
      ? [{ task, condition: 'off' as const }, { task, condition: 'on' as const }]
      : [{ task, condition: 'on' as const }, { task, condition: 'off' as const }],
  );
}
