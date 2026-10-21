/**
 * Text in VR. A headset shows no HTML, so messages ("Looks like a circle!")
 * are drawn onto a canvas and shown as a Sprite (a picture that always faces
 * the viewer). The canvas is redrawn only when the text changes.
 */
import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

export class VRLabel {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private text = '';

  /** @param heightM  height of one line of text, in metres */
  constructor(private readonly heightM = 0.035) {
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(new SpriteMaterial({ map: this.texture, transparent: true, depthTest: false }));
    this.sprite.renderOrder = 20; // always readable, even behind strokes
    this.sprite.visible = false;
  }

  /** Show text; lines are separated by "\n". Empty text hides the label. */
  set(text: string): void {
    this.sprite.visible = text.length > 0;
    if (text === this.text) return;
    this.text = text;
    if (!text) return;

    const lines = text.split('\n');
    const g = this.canvas.getContext('2d')!;
    const fontPx = 64;
    g.font = `800 ${fontPx}px Nunito, system-ui, sans-serif`;
    const width = Math.min(1024, Math.max(...lines.map((l) => g.measureText(l).width)) + 96);
    const height = lines.length * fontPx * 1.3 + 56;
    this.canvas.width = Math.ceil(width);
    this.canvas.height = Math.ceil(height);
    // Resizing a canvas resets its context state, so set the font again.
    g.font = `800 ${fontPx}px Nunito, system-ui, sans-serif`;
    g.fillStyle = 'rgba(27, 31, 77, 0.92)';
    roundRect(g, 0, 0, this.canvas.width, this.canvas.height, 48);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, this.canvas.width / 2, 28 + fontPx * 1.3 * (i + 0.5)));

    // A new canvas size needs a fresh GPU texture.
    this.texture.dispose();
    this.texture.needsUpdate = true;
    const aspect = this.canvas.width / this.canvas.height;
    const h = this.heightM * (lines.length * 1.3 + 0.9);
    this.sprite.scale.set(h * aspect, h, 1);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
