/**
 * Turning a list of sampled points into a smooth 3D tube.
 *
 * 1. The raw points are threaded onto a centripetal Catmull-Rom spline.
 *    Catmull-Rom passes *through* every sample (so the stroke goes exactly where
 *    the user drew) while giving smooth curves between samples. The centripetal
 *    variant avoids loops and overshoots on sharp corners.
 * 2. three.js' TubeGeometry sweeps a circle along that spline.
 * 3. Two small spheres cap the open tube ends, and everything is merged into a
 *    single geometry, so each stroke costs exactly one draw call.
 *
 * Materials are cached per colour, so 500 strokes in 8 colours share 8 materials.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Stroke {
  id: number;
  /** Sampled (unsmoothed) points in world space: the user's actual input. */
  points: Vector3[];
  color: string;
  radius: number;
  mesh: Mesh;
}

const RADIAL_SEGMENTS = 6;
const MAX_TUBULAR_SEGMENTS = 256;
const SEGMENT_LENGTH = 0.012; // metres per tube ring

let nextId = 1;
const materials = new Map<string, MeshStandardMaterial>();

/**
 * On-screen look, matching the batched renderer in main.ts (Lambert), so a
 * stroke does not change shade when the live preview becomes a finished stroke.
 */
const previewMaterials = new Map<string, MeshLambertMaterial>();
export function getPreviewMaterial(color: string): MeshLambertMaterial {
  let m = previewMaterials.get(color);
  if (!m) previewMaterials.set(color, (m = new MeshLambertMaterial({ color: new Color(color) })));
  return m;
}

/** Export look: glTF's native PBR material, so .glb files open well everywhere. */
export function getMaterial(color: string): MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color: new Color(color), roughness: 0.45, metalness: 0.0 });
    m.name = `stroke-${color}`;
    materials.set(color, m);
  }
  return m;
}

/** Build the tube geometry for a polyline. Works for any point count ≥ 1. */
export function buildStrokeGeometry(points: Vector3[], radius: number): BufferGeometry {
  if (points.length < 2) {
    // A single click makes a dot.
    const dot = new SphereGeometry(radius * 1.2, 12, 8);
    const p = points[0] ?? new Vector3();
    dot.translate(p.x, p.y, p.z);
    return dot;
  }

  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const length = curve.getLength();
  // About one ring per centimetre (or per ~1.5 samples, whichever is more)
  // looks smooth at drawing distance while keeping 500 strokes well under
  // a million triangles.
  const tubular = Math.min(
    MAX_TUBULAR_SEGMENTS,
    Math.max(4, Math.ceil(length / SEGMENT_LENGTH), Math.ceil(points.length / 1.5)),
  );
  const tube = new TubeGeometry(curve, tubular, radius, RADIAL_SEGMENTS, false);

  const capA = new SphereGeometry(radius, RADIAL_SEGMENTS + 2, 6);
  const capB = capA.clone();
  const a = points[0];
  const b = points[points.length - 1];
  capA.translate(a.x, a.y, a.z);
  capB.translate(b.x, b.y, b.z);

  const merged = mergeGeometries([tube, capA, capB]);
  tube.dispose();
  capA.dispose();
  capB.dispose();
  merged.computeBoundingSphere();
  return merged;
}

export function createStroke(points: Vector3[], color: string, radius: number): Stroke {
  const pts = points.map((p) => p.clone());
  const mesh = new Mesh(buildStrokeGeometry(pts, radius), getMaterial(color));
  const id = nextId++;
  mesh.name = `stroke-${id}`;
  mesh.userData.strokeId = id;
  return { id, points: pts, color, radius, mesh };
}

export function disposeStroke(stroke: Stroke): void {
  stroke.mesh.geometry.dispose();
}
