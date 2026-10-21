/**
 * The wrist palette: VR's replacement for the colour/size toolbar.
 *
 * A small arc of colour balls and three size balls floats above the
 * *non-drawing* hand, like a painter's palette. Touching a ball with the
 * brush tip selects it: no menus, no pointing rays, which suits young users.
 *
 * During a study trial a "Done" button and the timer appear too. Done needs
 * a trigger *click* while touching it (not just a touch), so it can't be hit
 * by accident while drawing.
 */
import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { settings } from '../app/state';
import { BRUSH_SIZE_ORDER, BRUSH_SIZES, PALETTE, type BrushSizeId } from '../drawing/palette';
import { VRLabel } from './VRLabel';

const TOUCH = 0.022; // metres between brush tip and ball centre to count as touching
const BALL = 0.014;

interface Ball {
  mesh: Mesh;
  kind: 'color' | 'size' | 'done';
  value: string;
}

export class WristPalette {
  readonly object = new Group();
  private readonly balls: Ball[] = [];
  private readonly doneBall: Ball;
  private readonly timerLabel = new VRLabel(0.018);
  private readonly tmp = new Vector3();
  private hovered: Ball | null = null;

  constructor() {
    this.object.name = 'wrist-palette';
    // Sit just above the back of the hand, tilted towards the face.
    this.object.position.set(0, 0.05, 0.03);
    this.object.rotation.x = -Math.PI / 4;

    const geo = new SphereGeometry(BALL, 16, 12);
    PALETTE.forEach((c, i) => {
      const angle = Math.PI * (0.15 + (0.7 * i) / (PALETTE.length - 1));
      const mesh = new Mesh(geo, new MeshLambertMaterial({ color: c.hex, emissive: c.hex, emissiveIntensity: 0.15 }));
      mesh.position.set(Math.cos(angle) * 0.075, Math.sin(angle) * 0.04, 0);
      this.add(mesh, 'color', c.hex);
    });
    BRUSH_SIZE_ORDER.forEach((id, i) => {
      const r = BRUSH_SIZES[id].radius;
      const mesh = new Mesh(new SphereGeometry(Math.max(0.006, r * 0.8), 12, 10), new MeshLambertMaterial({ color: 0xffffff }));
      mesh.position.set((i - 1) * 0.04, -0.005, 0.01);
      this.add(mesh, 'size', id);
    });
    const done = new Mesh(new SphereGeometry(0.018, 16, 12), new MeshLambertMaterial({ color: 0x1fbf75, emissive: 0x1fbf75, emissiveIntensity: 0.3 }));
    done.position.set(0.09, -0.03, 0.01);
    this.doneBall = this.add(done, 'done', 'done');
    done.visible = false;

    const doneLabel = new VRLabel(0.012);
    doneLabel.set('Done');
    doneLabel.sprite.position.set(0.09, -0.06, 0.01);
    done.userData.label = doneLabel;
    this.object.add(doneLabel.sprite);
    this.timerLabel.sprite.position.set(0, -0.05, 0.01);
    this.object.add(this.timerLabel.sprite);

    // Selection ring shown on the current colour and size.
    settings.subscribe(() => this.syncSelection());
    this.syncSelection();
  }

  /** Move the palette to the other hand when the drawing hand changes. */
  attachTo(parent: Object3D): void {
    if (this.object.parent !== parent) parent.add(this.object);
  }

  /** Show the study controls (or hide them with null). */
  setTrial(timerText: string | null): void {
    const on = timerText !== null;
    this.doneBall.mesh.visible = on;
    (this.doneBall.mesh.userData.label as VRLabel).set(on ? 'Done' : '');
    this.timerLabel.set(timerText ?? '');
  }

  /**
   * Per frame: hover-select colours and sizes under the brush tip.
   * Returns 'done' if the tip is touching the Done button (the caller
   * decides whether a trigger click happened).
   */
  update(tip: Vector3): 'done' | null {
    this.object.updateMatrixWorld(true);
    // The balls are closer together than the touch radius, so pick the *nearest* one.
    let hit: Ball | null = null;
    let best = TOUCH;
    for (const b of this.balls) {
      if (!b.mesh.visible) continue;
      const d = b.mesh.getWorldPosition(this.tmp).distanceTo(tip);
      if (d < best) {
        best = d;
        hit = b;
      }
    }
    if (hit !== this.hovered) {
      this.hovered?.mesh.scale.setScalar(1);
      hit?.mesh.scale.setScalar(1.35);
      this.hovered = hit;
      if (hit?.kind === 'color') settings.set({ color: hit.value });
      if (hit?.kind === 'size') settings.set({ size: hit.value as BrushSizeId });
    }
    return hit?.kind === 'done' ? 'done' : null;
  }

  /** True when the tip is over any palette ball: a trigger press there is a click, not a stroke. */
  get touching(): boolean {
    return this.hovered !== null;
  }

  private add(mesh: Mesh, kind: Ball['kind'], value: string): Ball {
    const ball = { mesh, kind, value };
    this.balls.push(ball);
    this.object.add(mesh);
    return ball;
  }

  private syncSelection(): void {
    const s = settings.get();
    for (const b of this.balls) {
      const selected = (b.kind === 'color' && b.value === s.color) || (b.kind === 'size' && b.value === s.size);
      let ring = b.mesh.userData.ring as Mesh | undefined;
      if (!ring && b.kind !== 'done') {
        ring = new Mesh(
          new SphereGeometry(1, 12, 8),
          new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        const geo = b.mesh.geometry as SphereGeometry;
        ring.scale.setScalar(geo.parameters.radius * 1.5);
        b.mesh.add(ring);
        b.mesh.userData.ring = ring;
      }
      if (ring) ring.visible = selected;
    }
  }
}
