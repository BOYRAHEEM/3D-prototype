/**
 * Study mode: runs one task trial at a time and produces a TrialRecord.
 *
 *   start()  clears the canvas (no undo back into the last trial), sets the
 *            log context so every stroke is tagged with participant, task and
 *            condition, shows the stars if needed, and starts the clock.
 *   finish() stops the clock, scores the final drawing, summarises the
 *            trial's strokes, and stores the TrialRecord.
 *
 * How the condition maps onto helpers lives in main.ts (effectiveAssist),
 * so the rest of the app has one place that decides what is switched on.
 */
import type { Scene } from 'three';
import { Emitter } from '../app/events';
import type { StrokeStore } from '../drawing/StrokeStore';
import type { Condition, InteractionLog, TaskId, TrialRecord } from '../logging/InteractionLog';
import type { Snapper } from '../snapping/Snapper';
import { StarField } from './StarField';
import { connectedPct, STAR_POSITIONS, starScores } from './tasks';

export interface ActiveTrial {
  trialId: string;
  participantId: string;
  condition: Condition;
  taskId: TaskId;
  startedAt: number; // performance.now()
  startedISO: string;
  undoCount: number;
  smartHelpChanges: number;
}

export class StudyMode {
  trial: ActiveTrial | null = null;
  readonly events = new Emitter<{ started: ActiveTrial; finished: TrialRecord }>();
  private readonly stars: StarField;

  constructor(
    private readonly log: InteractionLog,
    private readonly store: StrokeStore,
    scene: Scene,
    private readonly snapper: Snapper,
  ) {
    this.stars = new StarField(STAR_POSITIONS);
    scene.add(this.stars.object);
  }

  get elapsedS(): number {
    return this.trial ? (performance.now() - this.trial.startedAt) / 1000 : 0;
  }

  start(participantId: string, condition: Condition, taskId: TaskId): ActiveTrial {
    if (this.trial) this.finish(false);
    this.store.reset();
    const trial: ActiveTrial = {
      trialId: `${participantId}-${taskId}-${condition}-${Date.now().toString(36)}`,
      participantId,
      condition,
      taskId,
      startedAt: performance.now(),
      startedISO: new Date().toISOString(),
      undoCount: 0,
      smartHelpChanges: 0,
    };
    this.trial = trial;
    this.log.context = { participantId, condition, taskId, trialId: trial.trialId };
    const stars = taskId === 'stars';
    this.stars.setVisible(stars);
    this.snapper.extraTargets = stars ? STAR_POSITIONS : [];
    this.events.emit('started', trial);
    return trial;
  }

  /** End the trial. `completed` is false when the participant cancels. */
  finish(completed: boolean): TrialRecord | null {
    const t = this.trial;
    if (!t) return null;
    const durationS = this.elapsedS;
    const strokes = this.log.strokesOfTrial(t.trialId);
    const final = this.store.strokes.map((s) => ({ points: s.points, radius: s.radius }));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const stars = t.taskId === 'stars' ? starScores(final) : null;

    const record: TrialRecord = {
      trialId: t.trialId,
      sessionId: this.log.sessionId,
      participantId: t.participantId,
      condition: t.condition,
      taskId: t.taskId,
      startedAt: t.startedISO,
      durationS,
      completed,
      strokeCount: strokes.length,
      undoCount: t.undoCount,
      meanErrorScore: mean(strokes.map((s) => s.errorScore)),
      meanWobbleMm: mean(strokes.map((s) => s.wobble * 1000)),
      meanJitterMm: mean(strokes.map((s) => s.meanJitter * 1000)),
      missedConnections: strokes.reduce((a, s) => a + s.missedConnections, 0),
      connectedPct: connectedPct(final),
      starErrorCm: stars ? stars.errorCm : null,
      starsHitPct: stars ? stars.hitPct : null,
      snapsUsed: strokes.reduce((a, s) => a + Number(s.snappedStart) + Number(s.snappedEnd), 0),
      beautifyAccepted: strokes.filter((s) => s.beautifyOutcome === 'accepted').length,
      smartHelpChanges: t.smartHelpChanges,
    };
    this.log.addTrial(record);

    this.trial = null;
    this.log.context = { participantId: '', condition: 'free', taskId: 'free', trialId: '' };
    this.stars.setVisible(false);
    this.snapper.extraTargets = [];
    this.events.emit('finished', record);
    return record;
  }
}
