/**
 * Export the drawing as a binary glTF (.glb) file.
 *
 * glTF is the "JPEG of 3D": it opens in Blender, Windows 3D Viewer, online
 * viewers, Unity/Unreal importers, and can be dropped straight into a web page.
 * Only the stroke group is exported, not the grid, plane or guides.
 */
import type { Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { downloadBlob } from '../ui/download';

export async function exportGlb(root: Object3D, filename = 'skydoodle.glb'): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true });
  downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), filename);
}
