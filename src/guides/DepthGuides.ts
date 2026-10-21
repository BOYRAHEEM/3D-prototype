/**
 * Depth guides: visual cues that make the brush tip's position in 3D readable.
 *
 * Judging depth is the main difficulty in 3D sketching: on a flat screen (and
 * even in VR) people misjudge how far away the tip is, so strokes that "look"
 * connected miss each other by centimetres. These guides borrow cues that
 * architects and animators use:
 *
 *   1. Drop line   a thin vertical pole from the tip down to the floor.
 *                  Its length shows height; where it lands shows floor position.
 *   2. Tip shadow  a soft blob on the floor under the tip (like a noon sun).
 *                  It gets bigger and fainter the higher the tip is.
 *   3. Reach line  a line from the tip to the nearest point on an existing
 *                  stroke, with a marker on that point. It turns green when
 *                  the tip is close enough to touch, so "am I in front of or
 *                  behind that stroke?" becomes visible.
 *
 * All guides share one opacity, `intensity`, which eases towards a target.
 * That makes them fade in and out smoothly instead of popping, which matters
 * when adaptive help turns them on or off automatically (Step 4).
 */
import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { NearestResult, SpatialIndex } from './SpatialIndex';

/** Beyond this distance the reach line is hidden: the nearest stroke is "far". */
const REACH_RANGE = 0.6;
/** Within this distance the tip counts as touching a stroke. */
const TOUCH_DISTANCE = 0.03;

export class DepthGuides {
  readonly object = new Group();
  /** Current visibility 0..1 (eases towards `target`). */
  intensity = 0;
  /** Latest nearest-stroke result, also useful to other modules (logging). */
  nearest: NearestResult | null = null;

  private target = 0;
  private fadeRate = 7.5;
  private readonly poleMat = new MeshBasicMaterial({ color: 0x3a6ff7, transparent: true, depthWrite: false });
  private readonly shadowMat: MeshBasicMaterial;
  private readonly reachMat = new MeshBasicMaterial({ color: 0xff9f1c, transparent: true, depthWrite: false });
  private readonly markerMat = new MeshBasicMaterial({ color: 0xff9f1c, transparent: true, depthWrite: false });
  private readonly pole: Mesh;
  private readonly foot: Mesh;
  private readonly shadow: Mesh;
  private readonly reach: Mesh;
  private readonly marker: Mesh;

  constructor(private readonly index: SpatialIndex) {
    this.object.name = 'depth-guides';

    // Unit-height cylinder whose base is at y=0, so scaling Y sets its length.
    const poleGeo = new CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    this.pole = new Mesh(poleGeo, this.poleMat);

    this.foot = new Mesh(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.poleMat);

    this.shadowMat = new MeshBasicMaterial({ map: softDiscTexture(), transparent: true, depthWrite: false, color: 0x1d2648 });
    this.shadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMat);
    this.shadow.renderOrder = -2;

    // The reach line is a cylinder along +Y from 0 to 1, rotated/scaled each frame.
    this.reach = new Mesh(poleGeo, this.reachMat);
    this.marker = new Mesh(new SphereGeometry(1, 16, 10), this.markerMat);

    this.object.add(this.pole, this.foot, this.shadow, this.reach, this.marker);
    this.object.visible = false;
  }

  /**
   * Turn guides on/off; they fade rather than pop. Manual toggles fade
   * quickly (0.4 s); adaptive help fades out slowly so the change is gentle.
   */
  setActive(on: boolean, fadeSeconds = 0.4): void {
    this.target = on ? 1 : 0;
    this.fadeRate = 3 / fadeSeconds; // an exponential ease is ~95% done after 3 time constants
  }

  get active(): boolean {
    return this.target > 0;
  }

  setTheme(dark: boolean): void {
    this.poleMat.color.set(dark ? 0x8fb0ff : 0x3a6ff7);
    // At night a dark shadow would vanish on the dark floor, so it becomes a moonlit glow.
    this.shadowMat.color.set(dark ? 0xbfd2ff : 0x1d2648);
  }

  /**
   * Per-frame update.
   * @param tip      brush tip in world space
   * @param visible  false when the pointer is off-canvas / controller untracked
   * @param radius   current brush radius (guides scale with the brush)
   * @param dt       seconds since last frame
   * @param skip     strokes to ignore for the reach line (e.g. none for now)
   */
  update(tip: Vector3, visible: boolean, radius: number, dt: number, skip?: (id: number) => boolean): void {
    // Exponential ease towards the target (see setActive for the duration).
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt * this.fadeRate));
    if (Math.abs(this.target - this.intensity) < 0.002) this.intensity = this.target;

    const show = visible && this.intensity > 0.01;
    this.object.visible = show;
    this.nearest = visible ? this.index.nearest(tip, REACH_RANGE, skip) : null;
    if (!show) return;

    const a = this.intensity;
    const height = Math.max(0, tip.y);

    // 1. Drop line: thin pole from floor to tip, plus a small dome where it lands.
    const poleR = Math.max(0.004, radius * 0.3);
    this.pole.position.set(tip.x, 0, tip.z);
    this.pole.scale.set(poleR, height, poleR);
    this.poleMat.opacity = 0.55 * a;
    this.foot.position.set(tip.x, 0.002, tip.z);
    this.foot.scale.setScalar(poleR * 3);

    // 2. Soft shadow: wider and fainter as the tip rises.
    const size = 0.12 + height * 0.12 + radius * 4;
    this.shadow.position.set(tip.x, 0.003, tip.z);
    this.shadow.scale.set(size, 1, size);
    this.shadowMat.opacity = a * Math.max(0.12, 0.5 - height * 0.15);

    // 3. Reach line to the nearest existing stroke point.
    const n = this.nearest;
    const reachOn = !!n && n.distance > radius * 0.5;
    this.reach.visible = reachOn;
    this.marker.visible = !!n;
    if (n) {
      const touching = n.distance < TOUCH_DISTANCE + radius;
      const colour = touching ? 0x1fbf75 : 0xff9f1c;
      this.reachMat.color.set(colour);
      this.markerMat.color.set(colour);
      // Fainter the further away the stroke is.
      const closeness = 1 - n.distance / REACH_RANGE;
      this.reachMat.opacity = a * (0.25 + 0.65 * closeness);
      this.markerMat.opacity = a * (0.5 + 0.5 * closeness);
      this.marker.position.copy(n.point);
      this.marker.scale.setScalar(Math.max(0.008, radius * 0.9));

      if (reachOn) {
        const dir = new Vector3().subVectors(n.point, tip);
        const len = dir.length();
        this.reach.position.copy(tip);
        this.reach.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
        const r = Math.max(0.004, radius * 0.3);
        this.reach.scale.set(r, len, r);
      }
    }
  }
}

/** A radial-gradient texture: dark centre fading to transparent edges. */
function softDiscTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}
