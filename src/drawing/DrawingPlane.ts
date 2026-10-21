/**
 * The movable drawing plane (desktop mode).
 *
 * A mouse only gives us 2D positions, but we need 3D points. The classic answer
 * (used by tools like Mental Canvas and SketchUp's "drawing axes") is to draw
 * *onto a surface*: cast a ray from the camera through the mouse pixel and
 * see where it hits a plane. The user controls depth by moving that plane:
 *
 *   - yaw   (rotate around the vertical axis)   Q / E, ← / →
 *   - pitch (tilt from vertical to horizontal)  ↑ / ↓
 *   - offset (push away / pull closer)          scroll wheel, W / S
 *
 * The visible quad is only a hint: rays hit the *infinite* mathematical plane,
 * so the user can draw past its edges.
 */
import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Quaternion,
  Ray,
  Vector3,
} from 'three';

const SIZE = 2.4; // metres, edge length of the visible quad
const STEP_ANGLE = MathUtils.degToRad(15);
const HOME = new Vector3(0, 1.2, 0);

export class DrawingPlane {
  readonly object = new Group();
  /** The infinite plane used for ray intersection. Kept in sync with `object`. */
  readonly plane = new Plane();

  private yaw = 0; // radians around world Y
  private pitch = 0; // radians: 0 = upright wall, ±90° = flat like a table
  private readonly center = HOME.clone();
  private readonly fill: MeshBasicMaterial;
  private readonly lines: LineBasicMaterial;

  constructor() {
    this.fill = new MeshBasicMaterial({
      color: 0x7fb2ff,
      transparent: true,
      opacity: 0.08,
      side: DoubleSide,
      depthWrite: false,
    });
    this.lines = new LineBasicMaterial({ color: 0x3a86ff, transparent: true, opacity: 0.35, depthWrite: false });

    const quad = new Mesh(new PlaneGeometry(SIZE, SIZE), this.fill);
    quad.renderOrder = -1; // draw before strokes so strokes are never hidden behind it
    this.object.add(quad);
    this.object.add(new LineLoop(squareGeometry(SIZE / 2), this.lines));
    this.object.add(new LineSegments(gridGeometry(SIZE / 2, 8), this.lines));
    this.object.name = 'drawing-plane';
    this.update();
  }

  /** World-space unit normal of the plane (the +Z axis of the quad). */
  get normal(): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(this.object.quaternion);
  }

  get position(): Vector3 {
    return this.center.clone();
  }

  /** Where does the ray hit the plane? Returns null if the ray is parallel / points away. */
  intersect(ray: Ray, target = new Vector3()): Vector3 | null {
    return ray.intersectPlane(this.plane, target);
  }

  rotate(steps: number): void {
    this.yaw += steps * STEP_ANGLE;
    this.update();
  }

  tilt(steps: number): void {
    this.pitch = MathUtils.clamp(this.pitch + steps * STEP_ANGLE, -Math.PI / 2, Math.PI / 2);
    this.update();
  }

  /** Flip between upright (wall) and flat (table) orientation. */
  toggleFlat(): void {
    this.pitch = Math.abs(this.pitch) > Math.PI / 4 ? 0 : -Math.PI / 2;
    this.update();
  }

  /**
   * Move the plane along its normal, in the direction *away from* `viewDir`'s
   * viewer when amount > 0. Using the camera's view direction means "push"
   * always feels like "further from me", whichever side of the plane you are on.
   */
  push(amount: number, viewDir: Vector3): void {
    const n = this.normal;
    const sign = Math.sign(n.dot(viewDir)) || 1;
    this.center.addScaledVector(n, amount * sign);
    // Keep the plane within a sensible room-sized box.
    this.center.clamp(new Vector3(-5, 0.02, -5), new Vector3(5, 4, 5));
    this.update();
  }

  /** Turn the plane to face the camera (yaw only), keeping its centre. */
  faceDirection(viewDir: Vector3): void {
    this.yaw = Math.atan2(-viewDir.x, -viewDir.z);
    this.pitch = 0;
    this.update();
  }

  /** Move the plane so it passes through `point` (used e.g. to continue from a stroke). */
  moveTo(point: Vector3): void {
    this.center.copy(point);
    this.update();
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.center.copy(HOME);
    this.update();
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  setTheme(dark: boolean): void {
    this.fill.color.set(dark ? 0x9fc3ff : 0x7fb2ff);
    this.fill.opacity = dark ? 0.06 : 0.08;
    this.lines.color.set(dark ? 0xa9c8ff : 0x3a86ff);
  }

  private update(): void {
    this.object.position.copy(this.center);
    this.object.quaternion.copy(new Quaternion().setFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ')));
    this.object.updateMatrixWorld(true);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.center);
  }
}

function squareGeometry(h: number): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0], 3),
  );
}

function gridGeometry(h: number, divisions: number): BufferGeometry {
  const v: number[] = [];
  for (let i = 1; i < divisions; i++) {
    const t = -h + (2 * h * i) / divisions;
    v.push(t, -h, 0, t, h, 0, -h, t, 0, h, t, 0);
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(v, 3));
}
