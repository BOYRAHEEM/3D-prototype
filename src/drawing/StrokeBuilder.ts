/**
 * Collects the points of the stroke currently being drawn.
 *
 * Pointer and controller events arrive at irregular rates (60–1000 Hz) and can
 * report the same spot many times. We keep a sample only once the brush has
 * moved at least `minSpacing` from the last kept sample. That gives evenly
 * spaced points (good for the spline and for later shape fitting) and drops
 * tiny hand tremor below the spacing threshold.
 *
 * Each kept sample also stores a timestamp, which logging uses for duration
 * and speed.
 */
import { Vector3 } from 'three';

export class StrokeBuilder {
  readonly points: Vector3[] = [];
  readonly times: number[] = [];
  private minSpacing = 0.005;

  get active(): boolean {
    return this.points.length > 0;
  }

  get startTime(): number {
    return this.times[0] ?? 0;
  }

  begin(p: Vector3, time: number, minSpacing: number): void {
    this.reset();
    this.minSpacing = minSpacing;
    this.points.push(p.clone());
    this.times.push(time);
  }

  /** Returns true if the point was far enough from the last one to be kept. */
  add(p: Vector3, time: number): boolean {
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceTo(p) < this.minSpacing) return false;
    this.points.push(p.clone());
    this.times.push(time);
    return true;
  }

  /** Replace the very first or last point (used by snapping to lock onto an endpoint). */
  setEndpoint(which: 'start' | 'end', p: Vector3): void {
    const i = which === 'start' ? 0 : this.points.length - 1;
    if (i >= 0) this.points[i].copy(p);
  }

  reset(): void {
    this.points.length = 0;
    this.times.length = 0;
  }
}
