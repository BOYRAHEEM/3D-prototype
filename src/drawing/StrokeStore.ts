/**
 * All finished strokes, plus undo/redo.
 *
 * Undo uses the *command pattern*: every change (add a stroke, replace one
 * with its beautified version, clear everything) is an object that knows how
 * to `apply()` and `revert()` itself. Undo pops a command and reverts it; redo
 * re-applies it. Because "clear" is also a command, Clear is undoable, so the
 * app never needs an "Are you sure?" dialog that would scare young users.
 */
import { Group } from 'three';
import { disposeStroke, type Stroke } from './StrokeMesh';

interface Command {
  apply(): void;
  revert(): void;
  /** Called when the command can never be redone/undone again, so GPU memory can be freed. */
  discard(wasApplied: boolean): void;
}

const MAX_HISTORY = 200;

export type StoreChange = { kind: 'add' | 'remove'; stroke: Stroke };

export class StrokeStore {
  /**
   * Parent of every stroke's own Mesh. It is not rendered directly (main.ts
   * draws strokes through a StrokeBatch); it is the clean root for .glb export.
   */
  readonly group = new Group();
  private list: Stroke[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(changes: StoreChange[]) => void>();
  private pending: StoreChange[] = [];

  constructor() {
    this.group.name = 'SkyDoodle';
  }

  get strokes(): readonly Stroke[] {
    return this.list;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Subscribe to stroke additions/removals (spatial index, logging and UI listen here). */
  onChange(fn: (changes: StoreChange[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(stroke: Stroke): void {
    this.run({
      apply: () => this.attach(stroke),
      revert: () => this.detach(stroke),
      discard: (applied) => !applied && disposeStroke(stroke),
    });
  }

  /** Swap one stroke for another (used by beautification) as a single undo step. */
  replace(oldStroke: Stroke, newStroke: Stroke): void {
    this.run({
      apply: () => {
        this.detach(oldStroke);
        this.attach(newStroke);
      },
      revert: () => {
        this.detach(newStroke);
        this.attach(oldStroke);
      },
      discard: (applied) => disposeStroke(applied ? oldStroke : newStroke),
    });
  }

  clear(): void {
    if (this.list.length === 0) return;
    const removed = [...this.list];
    this.run({
      apply: () => removed.forEach((s) => this.detach(s)),
      revert: () => removed.forEach((s) => this.attach(s)),
      discard: (applied) => applied && removed.forEach(disposeStroke),
    });
  }

  /**
   * Remove everything *and* forget the history (used when a study trial
   * starts, so a participant can't undo back into the previous trial).
   */
  reset(): void {
    this.undoStack.forEach((c) => c.discard(true));
    this.redoStack.forEach((c) => c.discard(false));
    this.undoStack = [];
    this.redoStack = [];
    [...this.list].forEach((s) => {
      this.detach(s);
      disposeStroke(s);
    });
    this.flush();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.revert();
    this.redoStack.push(cmd);
    this.flush();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.apply();
    this.undoStack.push(cmd);
    this.flush();
  }

  private run(cmd: Command): void {
    cmd.apply();
    this.undoStack.push(cmd);
    // A new action makes the redo branch unreachable.
    this.redoStack.forEach((c) => c.discard(false));
    this.redoStack = [];
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()!.discard(true);
    this.flush();
  }

  private attach(s: Stroke): void {
    this.list.push(s);
    this.group.add(s.mesh);
    this.pending.push({ kind: 'add', stroke: s });
  }

  private detach(s: Stroke): void {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    this.group.remove(s.mesh);
    this.pending.push({ kind: 'remove', stroke: s });
  }

  private flush(): void {
    const changes = this.pending;
    this.pending = [];
    this.listeners.forEach((fn) => fn(changes));
  }
}
