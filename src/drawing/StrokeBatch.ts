/**
 * Draws many strokes in a single draw call.
 *
 * Every separate Mesh costs one "draw call": the CPU telling the GPU "draw
 * this now". At 500 strokes, plus 500 floor shadows, that is ~1000 calls per
 * frame. Too many for a standalone headset like the Quest, and a big slice of
 * the frame budget even on a laptop.
 *
 * three.js' BatchedMesh packs many geometries into one shared vertex buffer
 * and draws them together (via the WEBGL_multi_draw extension). Each stroke
 * gets its own entry with its own colour, can be removed or hidden
 * individually, and is still frustum-culled on its own.
 *
 * This class wraps BatchedMesh with what it lacks for a drawing app:
 * automatic growth when the buffers fill up, and lookup by stroke id.
 */
import { BatchedMesh, Color, type BufferGeometry, type Material } from 'three';

interface Entry {
  geometryId: number;
  instanceId: number;
}

export class StrokeBatch {
  mesh: BatchedMesh;
  private readonly entries = new Map<number, Entry>();
  private readonly tmpColor = new Color();

  constructor(material: Material, name: string) {
    // Start with room for ~150 typical strokes; grows automatically.
    this.mesh = new BatchedMesh(256, 150_000, 400_000, material);
    this.mesh.name = name;
  }

  add(strokeId: number, geometry: BufferGeometry, color?: string): void {
    this.remove(strokeId);
    this.ensureCapacity(geometry.getAttribute('position').count, geometry.getIndex()?.count ?? 0);
    const geometryId = this.mesh.addGeometry(geometry);
    const instanceId = this.mesh.addInstance(geometryId);
    if (color) this.mesh.setColorAt(instanceId, this.tmpColor.set(color));
    this.entries.set(strokeId, { geometryId, instanceId });
    this.invalidateBounds();
  }

  remove(strokeId: number): void {
    const e = this.entries.get(strokeId);
    if (!e) return;
    this.mesh.deleteInstance(e.instanceId);
    this.mesh.deleteGeometry(e.geometryId);
    this.entries.delete(strokeId);
    this.invalidateBounds();
  }

  setVisible(strokeId: number, visible: boolean): void {
    const e = this.entries.get(strokeId);
    if (e) this.mesh.setVisibleAt(e.instanceId, visible);
  }

  has(strokeId: number): boolean {
    return this.entries.has(strokeId);
  }

  /**
   * BatchedMesh caches the bounding sphere of the *whole batch* the first
   * time it is frustum-culled, and does not update it when entries are added.
   * If that first frame happened while the batch was empty, the cached sphere
   * is empty too and every later stroke gets culled (invisible). Clearing the
   * cache makes three.js recompute it on the next frame.
   */
  private invalidateBounds(): void {
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
  }

  /**
   * Deleting a geometry leaves a hole in the shared buffer. When space runs
   * out we first compact (`optimize`), and only if that is not enough do we
   * double the buffer size.
   */
  private ensureCapacity(vertices: number, indices: number): void {
    const m = this.mesh;
    if (m.instanceCount >= m.maxInstanceCount) m.setInstanceCount(m.maxInstanceCount * 2);

    if (m.unusedVertexCount < vertices || m.unusedIndexCount < indices) m.optimize();
    if (m.unusedVertexCount < vertices || m.unusedIndexCount < indices) {
      const usedV = maxCount(m, 'vertex') - m.unusedVertexCount;
      const usedI = maxCount(m, 'index') - m.unusedIndexCount;
      m.setGeometrySize(Math.max(usedV * 2, usedV + vertices * 2), Math.max(usedI * 2, usedI + indices * 2));
    }
  }
}

/** BatchedMesh keeps its buffer sizes private; read them from the geometry instead. */
function maxCount(m: BatchedMesh, kind: 'vertex' | 'index'): number {
  return kind === 'vertex' ? (m.geometry.getAttribute('position')?.count ?? 0) : (m.geometry.getIndex()?.count ?? 0);
}
