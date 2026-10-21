/**
 * A small performance read-out: frames per second, draw calls, triangles and
 * stroke count. Shown with `?debug` or `?stress=N` in the URL, or toggled with
 * the backtick key (`). Used to check the "60 fps with 500 strokes" target.
 */
import type { WebGLRenderer } from 'three';
import { h } from './dom';

export class FpsMeter {
  readonly el: HTMLElement;
  private frames = 0;
  private last = performance.now();
  private fps = 0;
  private worstMs = 0;
  private prevFrame = performance.now();

  constructor(root: HTMLElement, private readonly renderer: WebGLRenderer, visible: boolean) {
    this.el = h('div', { class: 'fps', 'aria-hidden': 'true', hidden: !visible });
    root.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') this.el.hidden = !this.el.hidden;
    });
  }

  /** Call once per frame *after* rendering so renderer.info is populated. */
  tick(strokes: number): void {
    const now = performance.now();
    this.worstMs = Math.max(this.worstMs, now - this.prevFrame);
    this.prevFrame = now;
    this.frames++;
    if (now - this.last < 500) return;
    this.fps = (this.frames * 1000) / (now - this.last);
    this.frames = 0;
    this.last = now;
    if (!this.el.hidden) {
      const info = this.renderer.info.render;
      this.el.textContent = `${this.fps.toFixed(0)} fps · worst ${this.worstMs.toFixed(0)} ms · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${strokes} strokes`;
    }
    this.worstMs = 0;
  }

  get value(): number {
    return this.fps;
  }
}
