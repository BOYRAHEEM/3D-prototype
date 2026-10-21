/**
 * Performance test: `?stress=500` fills the scene with 500 random wavy strokes
 * so we can check the frame rate against the 60 fps target.
 */
import { Vector3 } from 'three';
import { PALETTE, BRUSH_SIZES, BRUSH_SIZE_ORDER } from '../drawing/palette';
import { createStroke, type Stroke } from '../drawing/StrokeMesh';

export function randomStrokes(count: number, seed = 1): Stroke[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const strokes: Stroke[] = [];
  for (let n = 0; n < count; n++) {
    const start = new Vector3((rnd() - 0.5) * 3, 0.3 + rnd() * 1.8, (rnd() - 0.5) * 3);
    const dir = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const len = 0.2 + rnd() * 0.8;
    const pts: Vector3[] = [];
    const samples = 40 + Math.floor(rnd() * 80); // typical hand strokes are 40–120 samples
    const wobble = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.3);
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      pts.push(start.clone().addScaledVector(dir, t * len).addScaledVector(wobble, Math.sin(t * Math.PI * 2)));
    }
    const color = PALETTE[Math.floor(rnd() * PALETTE.length)].hex;
    const size = BRUSH_SIZES[BRUSH_SIZE_ORDER[Math.floor(rnd() * 3)]].radius;
    strokes.push(createStroke(pts, color, size));
  }
  return strokes;
}
