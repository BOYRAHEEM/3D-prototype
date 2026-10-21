/**
 * Short, friendly status messages ("Saved!", "Cleared, press Undo to bring it back").
 * Uses an aria-live region so screen readers announce them too.
 */
import { h } from './dom';

let region: HTMLElement | null = null;
let mirror: ((message: string) => void) | null = null;

/** Also send every toast somewhere else (VR shows them as floating text). */
export function mirrorToasts(fn: (message: string) => void): void {
  mirror = fn;
}

export function toast(message: string, ms = 2600): void {
  mirror?.(message);
  if (!region) {
    region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.getElementById('ui')!.appendChild(region);
  }
  const t = h('div', { class: 'toast' }, message);
  region.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}
