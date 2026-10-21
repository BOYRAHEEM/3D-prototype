/**
 * The interaction log: one record per stroke and one per study trial.
 *
 * Everything stays in the browser (localStorage). Nothing is sent anywhere,
 * which keeps the prototype a static site and keeps participants' data on the
 * researcher's own machine until they export it as CSV/JSON.
 *
 * A stroke record is written when the stroke ends. Some facts are only known
 * later (whether a "tidy shape" offer was accepted), so records can be
 * updated afterwards by stroke id.
 */
import type { AssistToggles } from '../app/state';
import { loadJSON, saveJSON } from '../app/state';
import type { StrokeMetrics } from '../adaptive/metrics';
import { strokeErrorScore } from '../adaptive/metrics';
import type { BeautifyOutcome } from '../beautify/Beautifier';
import type { ShapeKind } from '../beautify/fit';

export type Condition = 'off' | 'on' | 'smart';
export type TaskId = 'cube' | 'house' | 'stars';

export const CONDITION_LABEL: Record<Condition, string> = { off: 'Helpers OFF', on: 'Helpers ON', smart: 'Smart help' };

export interface StrokeRecord {
  sessionId: string;
  participantId: string;
  /** Study condition, or 'free' outside study mode. */
  condition: Condition | 'free';
  taskId: TaskId | 'free';
  trialId: string;
  strokeId: number;
  strokeIndex: number;
  timestamp: string; // ISO 8601
  tSessionMs: number;
  durationMs: number;
  pointCount: number;
  pathLength: number;
  meanJitter: number;
  wobble: number;
  depthVariance: number;
  missedConnections: number;
  errorScore: number;
  snappedStart: boolean;
  snappedEnd: boolean;
  beautifyOffered: ShapeKind | '';
  beautifyFitError: number | null;
  beautifyOutcome: BeautifyOutcome | '';
  /** Helpers actually in effect while this stroke was drawn. */
  assistDepthGuides: boolean;
  assistSnapping: boolean;
  assistBeautify: boolean;
  assistSmartHelp: boolean;
  inputMode: 'desktop' | 'vr';
}

export interface TrialRecord {
  trialId: string;
  sessionId: string;
  participantId: string;
  condition: Condition;
  taskId: TaskId;
  startedAt: string;
  durationS: number;
  completed: boolean;
  strokeCount: number;
  undoCount: number;
  meanErrorScore: number;
  meanWobbleMm: number;
  meanJitterMm: number;
  missedConnections: number;
  /** % of stroke ends touching another stroke end in the final drawing. */
  connectedPct: number;
  /** Connect-the-stars only: mean distance from each star to the drawing (cm). */
  starErrorCm: number | null;
  starsHitPct: number | null;
  snapsUsed: number;
  beautifyAccepted: number;
  smartHelpChanges: number;
}

export const STROKE_COLUMNS: (keyof StrokeRecord)[] = [
  'sessionId', 'participantId', 'condition', 'taskId', 'trialId', 'strokeId', 'strokeIndex', 'timestamp', 'tSessionMs',
  'durationMs', 'pointCount', 'pathLength', 'meanJitter', 'wobble', 'depthVariance', 'missedConnections', 'errorScore',
  'snappedStart', 'snappedEnd', 'beautifyOffered', 'beautifyFitError', 'beautifyOutcome',
  'assistDepthGuides', 'assistSnapping', 'assistBeautify', 'assistSmartHelp', 'inputMode',
];

export const TRIAL_COLUMNS: (keyof TrialRecord)[] = [
  'trialId', 'sessionId', 'participantId', 'condition', 'taskId', 'startedAt', 'durationS', 'completed', 'strokeCount',
  'undoCount', 'meanErrorScore', 'meanWobbleMm', 'meanJitterMm', 'missedConnections', 'connectedPct', 'starErrorCm',
  'starsHitPct', 'snapsUsed', 'beautifyAccepted', 'smartHelpChanges',
];

const KEY = 'skydoodle.log.v1';
const MAX_STROKES = 10_000; // ~4 MB worst case; well inside localStorage limits

interface Stored {
  strokes: StrokeRecord[];
  trials: TrialRecord[];
}

/** Who/what the next stroke belongs to. Set by study mode. */
export interface LogContext {
  participantId: string;
  condition: Condition | 'free';
  taskId: TaskId | 'free';
  trialId: string;
}

export class InteractionLog {
  readonly sessionId = `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  strokes: StrokeRecord[];
  trials: TrialRecord[];
  context: LogContext = { participantId: '', condition: 'free', taskId: 'free', trialId: '' };

  private readonly sessionStart = performance.now();
  private strokeIndex = 0;
  private saveTimer = 0;

  constructor() {
    const stored = loadJSON<Stored>(KEY);
    this.strokes = stored?.strokes ?? [];
    this.trials = stored?.trials ?? [];
  }

  logStroke(input: {
    strokeId: number;
    metrics: StrokeMetrics;
    snaps: { start: boolean; end: boolean };
    assist: AssistToggles;
    inputMode: 'desktop' | 'vr';
  }): StrokeRecord {
    const { metrics: m, assist } = input;
    const rec: StrokeRecord = {
      sessionId: this.sessionId,
      ...this.context,
      strokeId: input.strokeId,
      strokeIndex: this.strokeIndex++,
      timestamp: new Date().toISOString(),
      tSessionMs: Math.round(performance.now() - this.sessionStart),
      durationMs: Math.round(m.durationMs),
      pointCount: m.pointCount,
      pathLength: m.pathLength,
      meanJitter: m.meanJitter,
      wobble: m.wobble,
      depthVariance: m.depthVariance,
      missedConnections: m.missedConnections,
      errorScore: strokeErrorScore(m),
      snappedStart: input.snaps.start,
      snappedEnd: input.snaps.end,
      beautifyOffered: '',
      beautifyFitError: null,
      beautifyOutcome: '',
      assistDepthGuides: assist.depthGuides,
      assistSnapping: assist.snapping,
      assistBeautify: assist.beautify,
      assistSmartHelp: assist.adaptive,
      inputMode: input.inputMode,
    };
    this.strokes.push(rec);
    if (this.strokes.length > MAX_STROKES) this.strokes.splice(0, this.strokes.length - MAX_STROKES);
    this.scheduleSave();
    return rec;
  }

  /** Fill in beautification facts once they are known. */
  updateBeautify(strokeId: number, patch: Partial<Pick<StrokeRecord, 'beautifyOffered' | 'beautifyFitError' | 'beautifyOutcome'>>): void {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].sessionId === this.sessionId && this.strokes[i].strokeId === strokeId) {
        Object.assign(this.strokes[i], patch);
        this.scheduleSave();
        return;
      }
    }
  }

  strokesOfTrial(trialId: string): StrokeRecord[] {
    return this.strokes.filter((s) => s.trialId === trialId);
  }

  addTrial(t: TrialRecord): void {
    this.trials.push(t);
    this.save();
  }

  clearAll(): void {
    this.strokes = [];
    this.trials = [];
    this.save();
  }

  toJSON(): object {
    return {
      app: 'SkyDoodle',
      exportedAt: new Date().toISOString(),
      units: { distances: 'metres (pathLength, meanJitter, wobble); depthVariance m²; trial wobble/jitter mm', time: 'ms (strokes), s (trials)' },
      trials: this.trials,
      strokes: this.strokes,
    };
  }

  /** Writing ~MBs to localStorage on every stroke would stutter, so batch saves. */
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 800);
  }

  save(): void {
    clearTimeout(this.saveTimer);
    saveJSON(KEY, { strokes: this.strokes, trials: this.trials } satisfies Stored);
  }
}
