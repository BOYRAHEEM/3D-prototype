/**
 * The Smart help indicator: a small pill at the top of the screen that says
 * *why* help appeared or went away.
 *
 * Transparency matters here: if helpers silently pop in and out, the app
 * feels unpredictable, and a child may think they broke something. So every
 * change shows a short reason ("Some line ends just missed each other…").
 * The full reason is shown for a few seconds, then the pill shrinks to a
 * compact status ("Smart help: depth guides on") that can be tapped to read
 * the reason again.
 */
import type { AdaptiveChange, ManagedHelper } from '../adaptive/AdaptiveHelper';
import { h } from './dom';

const LABEL: Record<ManagedHelper, string> = { depthGuides: 'depth guides', snapping: 'magnet ends', beautify: 'tidy shapes' };
const EXPANDED_MS = 7000;

export class AdaptiveIndicator {
  private readonly el: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly text: HTMLElement;
  private lastReason = '';
  private active: ManagedHelper[] = [];
  private collapseTimer = 0;

  constructor(root: HTMLElement) {
    this.icon = h('span', { class: 'adaptive-icon', 'aria-hidden': 'true' });
    this.text = h('span', { class: 'adaptive-text' });
    this.el = h(
      'button',
      {
        class: 'adaptive',
        type: 'button',
        hidden: true,
        'aria-live': 'polite',
        title: 'Why did help change? (click to read again)',
        onclick: () => (this.el.classList.contains('expanded') ? this.collapse() : this.expand()),
      },
      this.icon,
      this.text,
    );
    root.appendChild(this.el);
  }

  /** Smart help was switched on or off by the user. */
  setEnabled(enabled: boolean): void {
    this.active = [];
    if (enabled) {
      this.show('🧭', 'Smart help is on. Helpers will appear if drawing gets tricky, and fade away as you get better.');
    } else {
      this.hide();
    }
  }

  /** Report helper changes made by AdaptiveHelper. */
  report(changes: AdaptiveChange[], state: Record<ManagedHelper, boolean>): void {
    if (!changes.length) return;
    this.active = (Object.keys(state) as ManagedHelper[]).filter((k) => state[k]);
    const last = changes[changes.length - 1];
    this.show(last.on ? '💡' : '🌟', changes.map((c) => c.reason).join(' '));
  }

  private show(icon: string, reason: string): void {
    this.lastReason = reason;
    this.icon.textContent = icon;
    this.el.hidden = false;
    this.expand();
  }

  private expand(): void {
    this.text.textContent = this.lastReason;
    this.el.classList.add('expanded');
    clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => this.collapse(), EXPANDED_MS);
  }

  private collapse(): void {
    this.el.classList.remove('expanded');
    if (this.active.length === 0) {
      // Nothing to show any more: keep a tiny "Smart help" badge.
      this.text.textContent = 'Smart help';
      return;
    }
    this.text.textContent = `Smart help: ${this.active.map((k) => LABEL[k]).join(' + ')} on`;
  }

  private hide(): void {
    clearTimeout(this.collapseTimer);
    this.el.hidden = true;
  }
}
