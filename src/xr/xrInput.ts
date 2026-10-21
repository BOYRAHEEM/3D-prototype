/**
 * Pure helpers for VR controller input (unit-tested; no WebXR needed).
 *
 * WebXR controllers report buttons and thumbsticks through a Gamepad object
 * using the "xr-standard" layout:
 *
 *   buttons[0] trigger      buttons[1] squeeze (grip)
 *   buttons[3] stick press  buttons[4] A / X     buttons[5] B / Y
 *   axes[2]    stick left/right   axes[3] stick up/down
 *
 * A thumbstick is analogue (−1…1), but "next colour" should happen once per
 * flick, not 72 times a second. AxisStepper turns the axis into discrete
 * steps with hysteresis: fire when pushed past 0.7, re-arm only after
 * returning inside 0.3.
 */

export const XR_BUTTON = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 } as const;
export const XR_AXIS = { x: 2, y: 3 } as const;

export class AxisStepper {
  private armed = true;
  constructor(
    private readonly fire = 0.7,
    private readonly rearm = 0.3,
  ) {}

  /** Returns −1, 0 or +1 for this frame. */
  update(value: number): -1 | 0 | 1 {
    if (this.armed && Math.abs(value) >= this.fire) {
      this.armed = false;
      return value > 0 ? 1 : -1;
    }
    if (!this.armed && Math.abs(value) <= this.rearm) this.armed = true;
    return 0;
  }
}

/** Detects the moment a button goes from up to down (one event per press). */
export class ButtonEdge {
  private wasDown = false;
  update(down: boolean): boolean {
    const pressed = down && !this.wasDown;
    this.wasDown = down;
    return pressed;
  }
}

/**
 * Where the user stands at the start of a VR session: a little back from
 * the drawing area (which is centred on the world origin), so the stars and
 * a fresh drawing are at a comfortable arm's length.
 */
export const VR_STANDING_OFFSET_Z = 0.8;
