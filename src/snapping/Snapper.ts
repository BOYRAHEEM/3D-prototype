/**
 * Smart snapping ("Magnet ends").
 *
 * The most common failure in 3D sketching is the near-miss: two lines that
 * look connected from one angle but are centimetres apart in depth. Snapping
 * fixes this at the moment of intent:
 *
 *   hover  If the brush tip comes within SNAP_RADIUS of a stroke's endpoint,
 *          a glowing marker appears and the tip *jumps* to the endpoint, so
 *          the user feels the "magnet" before they press.
 *   begin  A stroke started while snapped starts exactly on that endpoint.
 *   move   While drawing, the marker shows where the end will snap, but the
 *          tip is not moved (that would make drawing feel sticky).
 *   end    On release near an endpoint, the stroke's last point is moved
 *          exactly onto it. This includes the stroke's *own* start point,
 *          so closed shapes (circles, a house outline) close perfectly.
 *
 * Snapping is a filter on the tip position (DrawingController.hooks.filterTip),
 * so it works the same for the mouse and for VR controllers.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { currentRadius } from '../app/state';
import type { DrawingController } from '../drawing/DrawingController';
import type { StrokeStore } from '../drawing/StrokeStore';

/** Distance (metres) within which the tip is pulled onto an endpoint. */
export const SNAP_RADIUS = 0.05;

export interface EndpointHit {
  point: Vector3;
  /** Stroke id; -1 = start of the live stroke; -3 = an extra target (star). */
  strokeId: number;
  which: 'start' | 'end';
  distance: number;
}

export class Snapper {
  enabled = true;
  readonly object = new Group();
  /** What happened during the current/last stroke (read by logging). */
  readonly strokeSnaps = { start: false, end: false };
  /** Extra points to snap to, e.g. the stars in the "connect the stars" task. */
  extraTargets: Vector3[] = [];
  /** Called when the magnet "grabs" (VR uses it for a controller vibration). */
  onSnap?: (phase: 'hover' | 'begin' | 'end') => void;

  private target: EndpointHit | null = null;
  private readonly glow: Sprite;
  private readonly core: Mesh;
  private flash = 0; // >0 while the "connected!" pulse is playing
  private time = 0;

  constructor(
    private readonly store: StrokeStore,
    private readonly drawing: DrawingController,
  ) {
    this.object.name = 'snap-marker';
    this.glow = new Sprite(
      new SpriteMaterial({ map: glowTexture(), color: 0xfff3b0, blending: AdditiveBlending, depthTest: false, transparent: true }),
    );
    this.glow.renderOrder = 10;
    this.core = new Mesh(
      new SphereGeometry(1, 16, 10),
      new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.core.renderOrder = 11;
    this.object.add(this.glow, this.core);
    this.object.visible = false;

    drawing.hooks.filterTip = (p, phase) => this.filter(p, phase);
  }

  /** Radius scales a little with brush size so big brushes feel equally "magnetic". */
  radius(brushRadius: number): number {
    return SNAP_RADIUS + brushRadius;
  }

  /**
   * Nearest endpoint to `p` among finished strokes (and optionally the start
   * of the live stroke). Used by snapping and by "missed connection" metrics,
   * so it runs whether or not snapping is enabled.
   */
  nearestEndpoint(p: Vector3, maxDistance: number, includeLiveStart = false, excludeStrokeId = -2): EndpointHit | null {
    let best: EndpointHit | null = null;
    const consider = (point: Vector3, strokeId: number, which: 'start' | 'end') => {
      const d = point.distanceTo(p);
      if (d <= maxDistance && (!best || d < best.distance)) best = { point, strokeId, which, distance: d };
    };
    for (const s of this.store.strokes) {
      if (s.id === excludeStrokeId) continue;
      consider(s.points[0], s.id, 'start');
      if (s.points.length > 1) consider(s.points[s.points.length - 1], s.id, 'end');
    }
    for (const t of this.extraTargets) consider(t, -3, 'start');
    if (includeLiveStart && this.drawing.livePoints.length > 0) consider(this.drawing.livePoints[0], -1, 'start');
    return best;
  }

  private filter(p: Vector3, phase: 'hover' | 'begin' | 'move' | 'end'): Vector3 {
    if (phase === 'begin') {
      this.strokeSnaps.start = false;
      this.strokeSnaps.end = false;
    }
    if (!this.enabled) {
      this.target = null;
      return p;
    }
    const r = this.radius(currentRadius());
    // Closing onto the live stroke's own start only makes sense once the
    // stroke has gone somewhere (otherwise every stroke would snap shut instantly).
    const live = this.drawing.livePoints;
    const canClose = (phase === 'move' || phase === 'end') && live.length > 4 && this.livePathLongEnough(r);
    const prev = this.target;
    this.target = this.nearestEndpoint(p, r, canClose);

    if (!this.target) return p;
    switch (phase) {
      case 'hover':
        if (!prev || !prev.point.equals(this.target.point)) this.onSnap?.('hover');
        return this.target.point.clone();
      case 'begin':
        this.strokeSnaps.start = true;
        this.flash = 1;
        this.onSnap?.('begin');
        return this.target.point.clone();
      case 'move':
        return p; // preview only
      case 'end':
        this.strokeSnaps.end = true;
        this.flash = 1;
        this.onSnap?.('end');
        return this.target.point.clone();
    }
  }

  private livePathLongEnough(r: number): boolean {
    const live = this.drawing.livePoints;
    let len = 0;
    for (let i = 1; i < live.length && len <= r * 4; i++) len += live[i].distanceTo(live[i - 1]);
    return len > r * 4;
  }

  /** Per-frame: animate the marker. */
  update(dt: number, tipVisible: boolean): void {
    const brushRadius = currentRadius();
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);

    const show = this.enabled && tipVisible && !!this.target;
    this.object.visible = show || this.flash > 0;
    if (this.target) this.object.position.copy(this.target.point);
    if (!this.object.visible) return;

    const pulse = 1 + Math.sin(this.time * 8) * 0.12;
    // Clearly bigger than the brush cursor, so the "magnet" is unmistakable.
    const base = Math.max(0.09, brushRadius * 6);
    this.glow.scale.setScalar(base * pulse * (1 + this.flash * 1.5));
    (this.glow.material as SpriteMaterial).opacity = show ? 1 : this.flash;
    this.core.scale.setScalar(Math.max(0.008, brushRadius * 0.7));
  }
}

function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}
