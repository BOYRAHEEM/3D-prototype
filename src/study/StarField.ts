/**
 * The numbered stars for the "Connect the stars" task.
 *
 * Each star is a Sprite (a flat picture that always faces the camera) with
 * perspective size attenuation, so far stars look smaller, the only depth
 * cue the unassisted condition gets apart from the floor grid.
 */
import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace, type Vector3 } from 'three';

export class StarField {
  readonly object = new Group();

  constructor(positions: readonly Vector3[]) {
    this.object.name = 'task-stars';
    positions.forEach((p, i) => {
      const sprite = new Sprite(new SpriteMaterial({ map: starTexture(i + 1), transparent: true, depthWrite: false }));
      sprite.position.copy(p);
      sprite.scale.setScalar(0.17); // big enough to read the number from the default view (~3 m)
      sprite.renderOrder = 5;
      this.object.add(sprite);
    });
    this.object.visible = false;
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }
}

function starTexture(n: number): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // Soft glow
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 230, 120, 0.9)');
  glow.addColorStop(1, 'rgba(255, 230, 120, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  // Five-pointed star
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 30 : 62;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(64 + r * Math.cos(a), 66 + r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = '#ffd23f';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#b8860b';
  g.stroke();
  // Number
  g.fillStyle = '#1d2648';
  g.font = '800 50px Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 72);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
