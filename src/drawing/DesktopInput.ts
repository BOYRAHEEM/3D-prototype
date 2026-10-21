/**
 * Mouse / trackpad / touch input for desktop mode.
 *
 *   left-drag            draw on the drawing plane
 *   right-drag           orbit the camera (handled by OrbitControls)
 *   Space + left-drag    orbit too (for trackpads without a right button)
 *   scroll wheel         push / pull the drawing plane
 *   Ctrl + scroll        zoom the camera (trackpad pinch sends this too)
 *   one finger           draw;  two fingers: orbit + zoom
 *
 * Each pointer position becomes a 3D point by raycasting from the camera
 * through the pixel onto the drawing plane.
 */
import { MOUSE, Raycaster, Vector2, Vector3 } from 'three';
import type { SceneContext } from '../app/scene';
import type { DrawingController } from './DrawingController';
import type { DrawingPlane } from './DrawingPlane';

export class DesktopInput {
  enabled = true;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly touches = new Set<number>();
  private drawingPointer: number | null = null;
  private spaceHeld = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly plane: DrawingPlane,
    private readonly drawing: DrawingController,
  ) {
    const el = ctx.renderer.domElement;
    el.style.touchAction = 'none'; // we handle all gestures ourselves
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', () => !this.drawing.drawing && this.drawing.setTip(null));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => this.setSpace(false));
  }

  /** Camera forward vector, used so "push" always means "away from me". */
  viewDirection(): Vector3 {
    return this.ctx.camera.getWorldDirection(new Vector3());
  }

  private project(e: PointerEvent | MouseEvent): Vector3 | null {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.ctx.camera);
    return this.plane.intersect(this.raycaster.ray, this.hit);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      this.touches.add(e.pointerId);
      // A second finger means "orbit", so throw away the stroke the first finger started.
      if (this.touches.size > 1) {
        this.drawing.cancel();
        this.drawingPointer = null;
        return;
      }
    }
    if (e.button !== 0 || this.spaceHeld) return;
    const p = this.project(e);
    if (!p) return;
    this.drawingPointer = e.pointerId;
    // Capture keeps the stroke going even if the pointer leaves the canvas.
    // It can throw for pointers the browser no longer tracks, which must not block drawing.
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* drawing still works without capture */
    }
    this.drawing.begin(p);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (this.drawingPointer === e.pointerId) {
      // Coalesced events recover the samples the browser merged between frames,
      // which makes fast strokes noticeably smoother.
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ce of events.length ? events : [e]) {
        const p = this.project(ce);
        if (p) this.drawing.extend(p);
      }
      const p = this.project(e);
      if (p) this.drawing.setTip(p);
    } else if (e.pointerType !== 'touch') {
      this.drawing.setTip(this.project(e));
    }
  };

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    if (this.drawingPointer !== e.pointerId) return;
    this.drawingPointer = null;
    this.drawing.end();
    if (e.pointerType === 'touch') this.drawing.setTip(null);
  };

  private onCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    if (this.drawingPointer !== e.pointerId) return;
    this.drawingPointer = null;
    this.drawing.cancel();
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    // Normalise line/page scrolling to pixels so all mice feel similar.
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey || e.metaKey) {
      this.ctx.dolly(px * 0.002);
    } else {
      // Scroll up (negative delta) pushes the plane away from the viewer.
      this.plane.push(-px * 0.0015, this.viewDirection());
      // Keep the cursor glued to the plane as it moves.
      const p = this.project(e);
      if (p && this.drawingPointer === null) this.drawing.setTip(p);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !isTyping(e)) {
      e.preventDefault();
      this.setSpace(e.type === 'keydown');
    }
  };

  /** While Space is held, the left mouse button orbits instead of drawing. */
  private setSpace(held: boolean): void {
    this.spaceHeld = held;
    this.ctx.controls.mouseButtons.LEFT = held ? MOUSE.ROTATE : null;
    this.ctx.renderer.domElement.style.cursor = held ? 'grab' : 'crosshair';
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
