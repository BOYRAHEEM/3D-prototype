/**
 * Floor shadows for every stroke (part of the depth guides).
 *
 * Each stroke's geometry is drawn a second time, squashed to almost zero
 * height at floor level. The result looks like the drawing's shadow under an
 * overhead sun, so the user can read where each stroke is in plan view,
 * e.g. whether the two sides of a cube really line up front-to-back.
 *
 * The flattening is done by scaling the whole batch (one transform for all
 * shadows), and all shadows share one draw call via StrokeBatch.
 */
import { MeshBasicMaterial } from 'three';
import { StrokeBatch } from '../drawing/StrokeBatch';
import type { StoreChange } from '../drawing/StrokeStore';

const OPACITY = 0.16;

export class StrokeShadows {
  private readonly mat = new MeshBasicMaterial({ color: 0x1d2648, transparent: true, opacity: OPACITY, depthWrite: false });
  private readonly batch = new StrokeBatch(this.mat, 'stroke-shadows');

  constructor() {
    const o = this.object;
    o.scale.set(1, 0.001, 1); // squash everything onto the floor
    o.position.y = 0.004; // just above the grid
    o.renderOrder = -2;
    // The squashed bounding volumes confuse per-stroke culling; shadows are cheap, so skip it.
    o.perObjectFrustumCulled = false;
  }

  get object() {
    return this.batch.mesh;
  }

  /** Mirror the stroke store: add/remove shadows as strokes come and go. */
  apply(changes: StoreChange[]): void {
    for (const { kind, stroke } of changes) {
      if (kind === 'add') this.batch.add(stroke.id, stroke.mesh.geometry);
      else this.batch.remove(stroke.id);
    }
  }

  /** Follow the guides' fade so shadows appear/disappear together with them. */
  setIntensity(a: number): void {
    this.mat.opacity = OPACITY * a;
    this.object.visible = a > 0.01;
  }

  setTheme(dark: boolean): void {
    this.mat.color.set(dark ? 0xbfd2ff : 0x1d2648); // moonlit glow at night
  }
}
