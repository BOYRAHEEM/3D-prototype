/**
 * The sky in VR. On a monitor the sky is a CSS gradient behind a transparent
 * canvas, but a headset has no page behind it, so in VR we show a huge
 * inverted sphere whose vertex colours fade from the sky colour overhead to
 * the horizon colour, matching the day/night theme.
 */
import { BackSide, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';

const THEMES = {
  light: { top: '#8fd0ff', horizon: '#fff4fb' },
  dark: { top: '#070b2a', horizon: '#3a2470' },
};

export class SkyDome {
  readonly mesh: Mesh;
  private readonly geometry = new SphereGeometry(40, 32, 16);

  constructor() {
    this.geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(this.geometry.attributes.position.count * 3), 3));
    this.mesh = new Mesh(this.geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }));
    this.mesh.name = 'sky-dome';
    this.mesh.renderOrder = -10;
    this.mesh.visible = false; // desktop uses the CSS sky
    this.setTheme(false);
  }

  setTheme(dark: boolean): void {
    const t = THEMES[dark ? 'dark' : 'light'];
    const top = new Color(t.top);
    const horizon = new Color(t.horizon);
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      // Height on the sphere: 0 at the horizon (and below), 1 straight up.
      const h = Math.max(0, pos.getY(i) / 40);
      c.copy(horizon).lerp(top, Math.pow(h, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
}
