/**
 * VR mode (WebXR), tested target: Meta Quest Browser.
 *
 * VR reuses the whole drawing pipeline. Instead of a mouse ray hitting the
 * drawing wall, the brush tip is a point just in front of the controller, so
 * the user draws directly in mid-air. Everything downstream (snapping, depth
 * guides, tidy shapes, Smart help, logging) is unchanged.
 *
 * Controls (either hand):
 *   trigger        draw (the hand that last pulled the trigger is the "drawing hand")
 *   thumbstick ←→  previous / next colour      thumbstick ↑↓  bigger / smaller brush
 *   A / X          "Make it neat" when a tidy shape is offered
 *   B / Y          "Keep mine" when a shape is offered, otherwise Undo
 *   wrist palette  on the other hand: touch a ball with the brush tip to pick it
 *
 * The controllers vibrate briefly when the magnet snaps onto an endpoint: a
 * touch cue for depth, which is the hardest thing to judge in VR.
 */
import { Group, Mesh, MeshLambertMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import type { SceneContext } from '../app/scene';
import { settings } from '../app/state';
import type { Beautifier } from '../beautify/Beautifier';
import type { DrawingController } from '../drawing/DrawingController';
import { PALETTE } from '../drawing/palette';
import type { Snapper } from '../snapping/Snapper';
import type { Actions } from '../ui/actions';
import { VRLabel } from './VRLabel';
import { WristPalette } from './WristPalette';
import { AxisStepper, ButtonEdge, VR_STANDING_OFFSET_Z, XR_AXIS, XR_BUTTON } from './xrInput';

/** Brush tip position in the controller's pointing space: 5 cm in front of the hand. */
const TIP_OFFSET = new Vector3(0, 0, -0.05);

interface Hand {
  ray: Group; // "target ray" space: where the controller points
  grip: Group; // "grip" space: where the hand holds it (for the 3D model)
  source: XRInputSource | null;
  drawing: boolean;
  stickX: AxisStepper;
  stickY: AxisStepper;
  a: ButtonEdge;
  b: ButtonEdge;
  nib: Mesh;
}

export interface VRHooks {
  drawing: DrawingController;
  snapper: Snapper;
  beautifier: Beautifier;
  actions: Actions;
  onPresentingChange(presenting: boolean): void;
  trialText(): string | null;
  finishTrial(): void;
}

type HapticActuatorWithPulse = { pulse?: (intensity: number, ms: number) => Promise<boolean> };

export class VRMode {
  supported = false;
  private readonly hands: Hand[] = [];
  private drawHand: Hand | null = null;
  private readonly palette = new WristPalette();
  private readonly offerLabel = new VRLabel(0.03);
  private readonly messageLabel = new VRLabel(0.03);
  private messageUntil = 0;
  private readonly tmp = new Vector3();
  private readonly nibMat = new MeshLambertMaterial();

  constructor(
    private readonly ctx: SceneContext,
    private readonly hooks: VRHooks,
  ) {
    const xr = ctx.renderer.xr;
    xr.enabled = true;
    xr.setReferenceSpaceType('local-floor');
    xr.setFoveation(1); // render the edges of the view at lower resolution: big saving on Quest

    const models = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const ray = xr.getController(i);
      const grip = xr.getControllerGrip(i);
      grip.add(models.createControllerModel(grip));
      // A small coloured "nib" marks where the brush tip is.
      const nib = new Mesh(new SphereGeometry(0.006, 12, 8), this.nibMat);
      nib.position.copy(TIP_OFFSET);
      ray.add(nib);
      const hand: Hand = { ray, grip, source: null, drawing: false, stickX: new AxisStepper(), stickY: new AxisStepper(), a: new ButtonEdge(), b: new ButtonEdge(), nib };
      ray.addEventListener('connected', (e) => (hand.source = (e as unknown as { data: XRInputSource }).data));
      ray.addEventListener('disconnected', () => {
        if (hand.drawing) this.hooks.drawing.end();
        hand.drawing = false;
        hand.source = null;
      });
      ray.addEventListener('selectstart', () => this.triggerDown(hand));
      ray.addEventListener('selectend', () => this.triggerUp(hand));
      ctx.scene.add(ray, grip);
      this.hands.push(hand);
    }
    ctx.scene.add(this.offerLabel.sprite, this.messageLabel.sprite);

    hooks.snapper.onSnap = (phase) => this.pulse(this.drawHand ?? this.defaultHand(), phase === 'hover' ? 0.25 : 0.6, phase === 'hover' ? 15 : 40);
    const syncNib = () => this.nibMat.color.set(settings.get().color);
    settings.subscribe(syncNib);
    syncNib();

    xr.addEventListener('sessionstart', () => this.onStart());
    xr.addEventListener('sessionend', () => this.onEnd());
  }

  get presenting(): boolean {
    return this.ctx.renderer.xr.isPresenting;
  }

  /** Is immersive VR available in this browser (i.e. a headset is connected)? */
  async checkSupport(): Promise<boolean> {
    try {
      this.supported = !!(await navigator.xr?.isSessionSupported('immersive-vr'));
    } catch {
      this.supported = false; // e.g. blocked by permissions policy, or not a secure context
    }
    return this.supported;
  }

  async enter(): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR not available');
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await this.ctx.renderer.xr.setSession(session);
    // Stand the user a little back from the drawing area, facing it.
    const base = this.ctx.renderer.xr.getReferenceSpace();
    if (base) this.ctx.renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: 0, z: -VR_STANDING_OFFSET_Z })));
  }

  exit(): void {
    void this.ctx.renderer.xr.getSession()?.end();
  }

  /** Floating message ~1 m in front of the user (Smart help reasons, toasts). */
  showMessage(text: string, seconds = 5): void {
    if (!this.presenting) return;
    this.messageLabel.set(wrap(text, 34));
    this.messageUntil = performance.now() + seconds * 1000;
    this.placeMessage(true);
  }

  /** Per frame, while presenting. */
  update(): void {
    if (!this.presenting) return;
    const { drawing, beautifier, actions } = this.hooks;
    const active = this.drawHand ?? this.defaultHand();
    if (!active) return;

    // Brush tip of the active hand, in world space.
    active.ray.updateMatrixWorld(true);
    const tip = this.tmp.copy(TIP_OFFSET).applyMatrix4(active.ray.matrixWorld);
    if (active.drawing) drawing.extend(tip);
    else drawing.setTip(tip);
    this.hands.forEach((h) => (h.nib.visible = h === active));

    // Wrist palette lives on the other hand.
    const other = this.hands.find((h) => h !== active && h.source);
    if (other) {
      this.palette.attachTo(other.grip);
      this.palette.object.visible = true;
      if (!active.drawing) this.palette.update(tip);
    } else {
      this.palette.object.visible = false;
    }
    this.palette.setTrial(this.hooks.trialText());

    // Buttons and thumbsticks (on either controller).
    for (const h of this.hands) {
      const gp = h.source?.gamepad;
      if (!gp) continue;
      const sx = h.stickX.update(gp.axes[XR_AXIS.x] ?? 0);
      const sy = h.stickY.update(gp.axes[XR_AXIS.y] ?? 0);
      if (sx) {
        const i = PALETTE.findIndex((c) => c.hex === settings.get().color);
        actions.setColorIndex((i + sx + PALETTE.length) % PALETTE.length);
      }
      if (sy) actions.cycleSize(sy > 0 ? -1 : 1); // stick up (negative y) = bigger
      if (h.a.update(!!gp.buttons[XR_BUTTON.a]?.pressed) && beautifier.pending) beautifier.accept();
      if (h.b.update(!!gp.buttons[XR_BUTTON.b]?.pressed)) {
        if (beautifier.pending) beautifier.decline();
        else actions.undo();
      }
    }

    // Tidy-shape question floats above the candidate shape.
    const offer = beautifier.describePending();
    this.offerLabel.set(offer ? `${offer.text}\nA = make it neat   B = keep mine` : '');
    if (offer) this.offerLabel.sprite.position.copy(offer.anchor);

    if (this.messageLabel.sprite.visible) {
      if (performance.now() > this.messageUntil) this.messageLabel.set('');
      else this.placeMessage(false);
    }
  }

  private triggerDown(hand: Hand): void {
    this.drawHand = hand;
    // A trigger pull while touching the wrist palette is a click, not a stroke.
    if (this.palette.touching) {
      hand.ray.updateMatrixWorld(true);
      const tip = this.tmp.copy(TIP_OFFSET).applyMatrix4(hand.ray.matrixWorld);
      if (this.palette.update(tip) === 'done') this.hooks.finishTrial();
      return;
    }
    hand.ray.updateMatrixWorld(true);
    hand.drawing = true;
    this.hooks.drawing.begin(this.tmp.copy(TIP_OFFSET).applyMatrix4(hand.ray.matrixWorld));
  }

  private triggerUp(hand: Hand): void {
    if (!hand.drawing) return;
    hand.drawing = false;
    this.hooks.drawing.end();
  }

  /** Before anyone pulls a trigger, prefer the right hand. */
  private defaultHand(): Hand | null {
    return this.hands.find((h) => h.source?.handedness === 'right') ?? this.hands.find((h) => h.source) ?? null;
  }

  private pulse(hand: Hand | null, intensity: number, ms: number): void {
    const actuator = hand?.source?.gamepad?.hapticActuators?.[0] as HapticActuatorWithPulse | undefined;
    void actuator?.pulse?.(intensity, ms);
  }

  /** Keep the message in front of the user, gently following their gaze. */
  private placeMessage(snap: boolean): void {
    const cam = this.ctx.renderer.xr.getCamera();
    const head = cam.getWorldPosition(new Vector3());
    const dir = cam.getWorldDirection(new Vector3()).setY(0).normalize();
    const target = head.addScaledVector(dir, 1).add(new Vector3(0, -0.15, 0));
    const pos = this.messageLabel.sprite.position;
    if (snap) pos.copy(target);
    else pos.lerp(target, 0.05);
  }

  private onStart(): void {
    this.hooks.onPresentingChange(true);
  }

  private onEnd(): void {
    for (const h of this.hands) {
      if (h.drawing) this.hooks.drawing.end();
      h.drawing = false;
    }
    this.drawHand = null;
    this.offerLabel.set('');
    this.messageLabel.set('');
    (this.palette.object.parent as Object3D | null)?.remove(this.palette.object);
    this.hooks.onPresentingChange(false);
  }
}

/** Break text into lines of at most `max` characters for the VR label. */
function wrap(text: string, max: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
