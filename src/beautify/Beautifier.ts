/**
 * Stroke beautification ("Tidy shapes"): offers, never forces.
 *
 * After a stroke ends, fit.ts checks whether it is close to a line, circle or
 * arc. If it is, we *offer* the clean shape:
 *
 *   - the user's original stroke stays on screen, but faded (a "ghost"), so
 *     it is clear what would be replaced;
 *   - the clean candidate pulses gently on top of it;
 *   - a speech bubble asks "Looks like a circle! Make it neat / Keep mine".
 *
 * Accepting swaps the strokes as one undoable step. Declining, or simply
 * carrying on drawing, keeps the original. Keeping the user in control
 * matters for young creators: an app that silently "corrects" their drawing
 * tells them their own work was wrong.
 */
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three';
import { Emitter } from '../app/events';
import type { StrokeBatch } from '../drawing/StrokeBatch';
import { buildStrokeGeometry, createStroke, type Stroke } from '../drawing/StrokeMesh';
import type { StrokeStore } from '../drawing/StrokeStore';
import { h } from '../ui/dom';
import { classifyStroke, type ShapeFit, type ShapeKind } from './fit';

export type BeautifyOutcome = 'accepted' | 'declined' | 'ignored';

export interface BeautifyOffer {
  original: Stroke;
  fit: ShapeFit;
}

const NAMES: Record<ShapeKind, string> = { line: 'a straight line', circle: 'a circle', arc: 'a curve' };

export class Beautifier {
  enabled = true;
  readonly events = new Emitter<{
    offered: BeautifyOffer;
    resolved: { offer: BeautifyOffer; outcome: BeautifyOutcome; replacement: Stroke | null };
  }>();

  private offer: (BeautifyOffer & { candidate: Mesh; ghost: Mesh }) | null = null;
  private readonly ghostMat = new MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false });
  private readonly candidateMat = new MeshLambertMaterial();
  private readonly bubble: HTMLElement;
  private readonly bubbleText: HTMLElement;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly store: StrokeStore,
    private readonly batch: StrokeBatch,
    private readonly camera: PerspectiveCamera,
    uiRoot: HTMLElement,
  ) {
    this.bubbleText = h('span', { class: 'bubble-text' });
    this.bubble = h(
      'div',
      { class: 'bubble', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Tidy shape suggestion', hidden: true },
      h('span', { class: 'bubble-spark', 'aria-hidden': 'true' }, '✨'),
      this.bubbleText,
      h('div', { class: 'bubble-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => this.accept() }, 'Make it neat', h('kbd', {}, 'Enter')),
        h('button', { class: 'btn', type: 'button', onclick: () => this.decline() }, 'Keep mine', h('kbd', {}, 'Esc')),
      ),
    );
    uiRoot.appendChild(this.bubble);

    window.addEventListener('keydown', (e) => {
      if (!this.offer || (e.target as HTMLElement)?.tagName === 'BUTTON') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.accept();
      } else if (e.key === 'Escape') {
        this.decline();
      }
    });
  }

  get pending(): BeautifyOffer | null {
    return this.offer;
  }

  /** For VR: the question to show, and the top of the candidate shape to show it above. */
  describePending(): { text: string; anchor: Vector3 } | null {
    if (!this.offer) return null;
    const geo = this.offer.candidate.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    return { text: `Looks like ${NAMES[this.offer.fit.kind]}!`, anchor: bs.center.clone().add(new Vector3(0, bs.radius + 0.06, 0)) };
  }

  /** Called when a stroke has just been committed. Returns the offer, if any. */
  consider(stroke: Stroke): BeautifyOffer | null {
    this.dismiss();
    if (!this.enabled) return null;
    const fit = classifyStroke(stroke.points);
    if (!fit) return null;

    // Fade the original: hide its batched copy and draw a translucent ghost instead.
    this.batch.setVisible(stroke.id, false);
    this.ghostMat.color.set(stroke.color);
    const ghost = new Mesh(stroke.mesh.geometry, this.ghostMat);
    ghost.renderOrder = 1;

    const color = new Color(stroke.color);
    this.candidateMat.color.copy(color);
    this.candidateMat.emissive.copy(color);
    const candidate = new Mesh(buildStrokeGeometry(fit.points, stroke.radius), this.candidateMat);
    candidate.name = 'beautify-candidate';

    this.scene.add(ghost, candidate);
    this.offer = { original: stroke, fit, ghost, candidate };
    this.bubbleText.textContent = `Looks like ${NAMES[fit.kind]}!`;
    this.bubble.hidden = false;
    this.events.emit('offered', { original: stroke, fit });
    return this.offer;
  }

  accept(): void {
    const o = this.offer;
    if (!o) return;
    const replacement = createStroke(o.fit.points, o.original.color, o.original.radius);
    this.close();
    this.store.replace(o.original, replacement);
    this.events.emit('resolved', { offer: o, outcome: 'accepted', replacement });
  }

  decline(): void {
    this.resolveKeeping('declined');
  }

  /** Close without a decision (e.g. the user started a new stroke): keeps the original. */
  dismiss(): void {
    this.resolveKeeping('ignored');
  }

  /** Per-frame: pulse the candidate and keep the bubble next to the stroke. */
  update(dt: number, canvas: HTMLCanvasElement): void {
    if (!this.offer) return;
    this.time += dt;
    this.candidateMat.emissiveIntensity = 0.25 + 0.2 * Math.sin(this.time * 5);

    const geo = this.offer.candidate.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    // Prefer just above the shape; if that would leave the screen, go just
    // below it, so the bubble never hides the shape it is talking about.
    const rect = canvas.getBoundingClientRect();
    const toScreen = (dy: number) => {
      const v = new Vector3(bs.center.x, bs.center.y + dy, bs.center.z).project(this.camera);
      return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
    };
    const top = toScreen(bs.radius);
    const bottom = toScreen(-bs.radius);
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const minY = 84; // below the top bar
    const maxY = rect.height - bh - 110; // above the colour dock
    // Try above, then below, then beside (right, then left) the shape.
    let x = top.x - bw / 2;
    let y = top.y - bh - 16;
    if (y < minY) y = bottom.y + 16;
    if (y > maxY) {
      const rScreen = Math.abs(bottom.y - top.y) / 2;
      const midY = (top.y + bottom.y) / 2;
      y = midY - bh / 2;
      x = top.x + rScreen + 24;
      if (x + bw > rect.width - 16) x = top.x - rScreen - 24 - bw;
    }
    if (top.behind) {
      x = rect.width / 2 - bw / 2;
      y = minY;
    }
    // Keep clear of the side toolbars on wide screens (they are ~150 px wide).
    const side = rect.width > 700 ? 175 : 16;
    x = Math.max(side, Math.min(rect.width - bw - side, x));
    y = Math.max(minY, Math.min(maxY, y));
    this.bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private resolveKeeping(outcome: 'declined' | 'ignored'): void {
    const o = this.offer;
    if (!o) return;
    this.close();
    this.batch.setVisible(o.original.id, true);
    this.events.emit('resolved', { offer: o, outcome, replacement: null });
  }

  private close(): void {
    const o = this.offer;
    if (!o) return;
    this.scene.remove(o.ghost, o.candidate);
    o.candidate.geometry.dispose(); // the ghost shares the original's geometry: not ours to free
    this.offer = null;
    this.bubble.hidden = true;
  }
}
