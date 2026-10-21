/**
 * Fast "which stroke point is nearest to here?" queries.
 *
 * Checking every point of every stroke each frame would be 500 strokes × ~100
 * points = 50,000 distance checks per frame. Instead we drop each point into a
 * 3D grid of cubic cells (a *spatial hash*). A query only looks at cells near
 * the brush tip, growing outward ring by ring and stopping as soon as no
 * unvisited cell could contain anything closer than the best match so far.
 */
import { Vector3 } from 'three';

export interface IndexedPoint {
  x: number;
  y: number;
  z: number;
  strokeId: number;
  /** Index of the point within its stroke. */
  index: number;
}

export interface NearestResult {
  point: Vector3;
  strokeId: number;
  index: number;
  distance: number;
}

const OFFSET = 512; // cell coordinates are shifted so they are non-negative in the key

export class SpatialIndex {
  private cells = new Map<number, IndexedPoint[]>();
  private byStroke = new Map<number, number[]>(); // strokeId → keys of cells it occupies

  constructor(private readonly cellSize = 0.12) {}

  get strokeCount(): number {
    return this.byStroke.size;
  }

  insert(strokeId: number, points: readonly Vector3[]): void {
    this.remove(strokeId);
    const keys = new Set<number>();
    points.forEach((p, index) => {
      const key = this.keyOf(p.x, p.y, p.z);
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push({ x: p.x, y: p.y, z: p.z, strokeId, index });
      keys.add(key);
    });
    this.byStroke.set(strokeId, [...keys]);
  }

  remove(strokeId: number): void {
    const keys = this.byStroke.get(strokeId);
    if (!keys) return;
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      const kept = cell.filter((e) => e.strokeId !== strokeId);
      if (kept.length) this.cells.set(key, kept);
      else this.cells.delete(key);
    }
    this.byStroke.delete(strokeId);
  }

  clear(): void {
    this.cells.clear();
    this.byStroke.clear();
  }

  /** Nearest indexed point within `maxDistance`, optionally skipping some strokes. */
  nearest(p: Vector3, maxDistance: number, skip?: (strokeId: number) => boolean): NearestResult | null {
    const cs = this.cellSize;
    const ci = Math.floor(p.x / cs);
    const cj = Math.floor(p.y / cs);
    const ck = Math.floor(p.z / cs);
    const maxRing = Math.ceil(maxDistance / cs);

    let best: IndexedPoint | null = null;
    let bestD2 = maxDistance * maxDistance;

    for (let r = 0; r <= maxRing; r++) {
      // Every point in ring r is at least (r - 1) cells away, so once that
      // lower bound exceeds the best distance found, no further ring can win.
      const minPossible = (r - 1) * cs;
      if (best && minPossible > 0 && minPossible * minPossible > bestD2) break;

      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (let k = ck - r; k <= ck + r; k++) {
            // Only visit the shell of the cube; the inside was done in earlier rings.
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
            const cell = this.cells.get(this.key(i, j, k));
            if (!cell) continue;
            for (const e of cell) {
              if (skip?.(e.strokeId)) continue;
              const dx = e.x - p.x;
              const dy = e.y - p.y;
              const dz = e.z - p.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bestD2) {
                bestD2 = d2;
                best = e;
              }
            }
          }
        }
      }
    }

    return best
      ? { point: new Vector3(best.x, best.y, best.z), strokeId: best.strokeId, index: best.index, distance: Math.sqrt(bestD2) }
      : null;
  }

  private keyOf(x: number, y: number, z: number): number {
    const cs = this.cellSize;
    return this.key(Math.floor(x / cs), Math.floor(y / cs), Math.floor(z / cs));
  }

  /** Pack three cell coordinates (each within ±512) into one integer map key. */
  private key(i: number, j: number, k: number): number {
    return ((i + OFFSET) * 1024 + (j + OFFSET)) * 1024 + (k + OFFSET);
  }
}
