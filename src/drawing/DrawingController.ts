/**
 * The drawing pipeline, independent of *how* the brush is moved.
 *
 * Input sources (mouse on a plane, a VR controller in mid-air) only report a
 * stream of brush-tip positions plus "pressed / released". This class turns
 * that stream into strokes:
 *
 *   setTip(p)  → brush hovering at p (guides and snapping look at this)
 *   begin(p)   → trigger/mouse pressed: start a stroke
 *   extend(p)  → moved while pressed: add samples, refresh the live preview
 *   end()      → released: build the final stroke and add it to the store
 *
 * Because desktop and VR feed the same pipeline, every assistance feature
 * (guides, snapping, beautification, adaptive help, logging) works in both.
 */
import { Mesh, MeshStandardMaterial, Scene, SphereGeometry, Vector3 } from 'three';
import { Emitter } from '../app/events';
import { currentRadius, settings } from '../app/state';
import { StrokeBuilder } from './StrokeBuilder';
import { buildStrokeGeometry, createStroke, getPreviewMaterial, type Stroke } from './StrokeMesh';
import type { StrokeStore } from './StrokeStore';

export interface StrokeEndInfo {
  stroke: Stroke;
  /** Timestamp (ms, performance.now) of every sample. */
  times: number[];
  startTime: number;
  endTime: number;
}

/**
 * Optional hooks other modules plug in to modify the tip position (snapping)
 * or react before a stroke is committed (beautification).
 */
export interface DrawingHooks {
  /** May return a different position, e.g. a snapped endpoint. */
  filterTip?: (p: Vector3, phase: 'hover' | 'begin' | 'move' | 'end') => Vector3;
}

export class DrawingController {
  readonly events = new Emitter<{
    strokeStart: Vector3;
    strokeEnd: StrokeEndInfo;
  }>();
  readonly hooks: DrawingHooks = {};

  /** Current brush-tip position (world space) and whether it is meaningful. */
  readonly tip = new Vector3();
  tipVisible = false;

  private readonly builder = new StrokeBuilder();
  private readonly cursor: Mesh;
  private readonly cursorMat: MeshStandardMaterial;
  private preview: Mesh | null = null;
  private previewDirty = false;

  constructor(
    private readonly scene: Scene,
    private readonly store: StrokeStore,
  ) {
    this.cursorMat = new MeshStandardMaterial({ transparent: true, opacity: 0.85, emissiveIntensity: 0.25 });
    this.cursor = new Mesh(new SphereGeometry(1, 20, 14), this.cursorMat);
    this.cursor.name = 'brush-cursor';
    this.cursor.visible = false;
    scene.add(this.cursor);
    this.syncCursorStyle();
    settings.subscribe(() => this.syncCursorStyle());
  }

  get drawing(): boolean {
    return this.builder.active;
  }

  /** Points of the in-progress stroke (read-only view, for guides). */
  get livePoints(): readonly Vector3[] {
    return this.builder.points;
  }

  setTip(p: Vector3 | null): void {
    if (!p) {
      this.tipVisible = false;
      return;
    }
    this.tip.copy(this.filter(p, this.drawing ? 'move' : 'hover'));
    this.tipVisible = true;
  }

  begin(p: Vector3): void {
    const q = this.filter(p, 'begin');
    this.tip.copy(q);
    this.tipVisible = true;
    this.builder.begin(q, performance.now(), Math.max(0.004, currentRadius() * 0.5));
    this.previewDirty = true;
    this.events.emit('strokeStart', q.clone());
  }

  extend(p: Vector3): void {
    if (!this.drawing) return;
    const q = this.filter(p, 'move');
    this.tip.copy(q);
    if (this.builder.add(q, performance.now())) this.previewDirty = true;
  }

  end(): void {
    if (!this.drawing) return;
    // Let snapping adjust the final point (e.g. lock onto a nearby endpoint).
    const last = this.builder.points[this.builder.points.length - 1];
    this.builder.setEndpoint('end', this.filter(last, 'end'));

    const { color } = settings.get();
    const stroke = createStroke(this.builder.points, color, currentRadius());
    const times = [...this.builder.times];
    const endTime = performance.now();
    this.builder.reset();
    this.removePreview();

    this.store.add(stroke);
    this.events.emit('strokeEnd', { stroke, times, startTime: times[0], endTime });
  }

  /** Abort the current stroke without saving it (e.g. a second finger touched down). */
  cancel(): void {
    this.builder.reset();
    this.removePreview();
  }

  /** Called once per frame from the render loop. */
  update(): void {
    this.cursor.visible = this.tipVisible;
    this.cursor.position.copy(this.tip);

    // Rebuild the live tube at most once per frame, and only if new samples arrived.
    if (this.previewDirty && this.drawing) {
      this.previewDirty = false;
      const geo = buildStrokeGeometry(this.builder.points, currentRadius());
      if (this.preview) {
        this.preview.geometry.dispose();
        this.preview.geometry = geo;
      } else {
        this.preview = new Mesh(geo, getPreviewMaterial(settings.get().color));
        this.preview.name = 'live-stroke';
        this.scene.add(this.preview);
      }
    }
  }

  private filter(p: Vector3, phase: 'hover' | 'begin' | 'move' | 'end'): Vector3 {
    return this.hooks.filterTip ? this.hooks.filterTip(p, phase) : p;
  }

  private removePreview(): void {
    if (!this.preview) return;
    this.scene.remove(this.preview);
    this.preview.geometry.dispose();
    this.preview = null;
  }

  private syncCursorStyle(): void {
    const { color } = settings.get();
    this.cursorMat.color.set(color);
    this.cursorMat.emissive.set(color);
    this.cursor.scale.setScalar(currentRadius() * 1.35);
  }
}
