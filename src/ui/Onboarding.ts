/**
 * First-time onboarding: three short cards, shown once.
 *
 * Kept to three steps on purpose: young users skip long tutorials. Each step
 * teaches exactly one idea (draw; move the wall for depth; helpers exist),
 * with one picture and one or two sentences. It can be replayed from Help.
 *
 * Keyboard: → / Enter next, ← back, Esc skip.
 */
import { loadJSON, saveJSON } from '../app/state';
import { h, icon } from './dom';
import { ICONS } from './icons';

const SEEN_KEY = 'skydoodle.onboarded';

interface Step {
  title: string;
  text: string;
  art: string[];
}

const STEPS: Step[] = [
  {
    title: 'Draw in the sky',
    text: 'Hold the mouse button (or one finger) and draw. Your lines float in 3D space!',
    art: ['M8 34c6-12 12-18 18-10s10 2 14-8', 'M38 14l4-4', 'M34 18l2-2'],
  },
  {
    title: 'Move the wall to go deeper',
    text: 'You draw on the see-through blue wall. Scroll to push it away or pull it closer, and press Q or E to turn it. Right-drag to look around.',
    art: ['M14 10l20 6v24l-20-6z', 'M24 4v8', 'M20 8l4-4 4 4', 'M24 44v-6', 'M20 40l4 4 4-4'],
  },
  {
    title: 'Helpers are here for you',
    text: 'Shadows show how far away your pencil is, magnet ends join lines, and tidy shapes can neaten wobbly ones. Switch them on and off with the Helpers button.',
    art: ['M24 6l3.6 9.4L37 19l-9.4 3.6L24 32l-3.6-9.4L11 19l9.4-3.6z', 'M36 30l1.6 4.4L42 36l-4.4 1.6L36 42l-1.6-4.4L30 36l4.4-1.6z'],
  },
];

export function createOnboarding(root: HTMLElement): { open(): void; maybeShowFirstTime(): void } {
  let step = 0;
  const art = h('div', { class: 'onb-art', 'aria-hidden': 'true' });
  const title = h('h2', { id: 'onb-title' });
  const text = h('p', { class: 'onb-text', id: 'onb-text' });
  const dots = h('div', { class: 'onb-dots', 'aria-hidden': 'true' }, ...STEPS.map(() => h('span', {})));
  const counter = h('span', { class: 'sr-only' });
  const back = h('button', { class: 'btn', type: 'button', onclick: () => go(step - 1) }, 'Back');
  const next = h('button', { class: 'btn primary big', type: 'button', onclick: () => go(step + 1) });

  const card = h(
    'div',
    { class: 'panel onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-title', 'aria-describedby': 'onb-text' },
    h('button', { class: 'icon-btn onb-skip', type: 'button', 'aria-label': 'Skip the tour', onclick: close }, icon(ICONS.close)),
    art,
    counter,
    title,
    text,
    dots,
    h('div', { class: 'onb-actions' }, back, next),
  );
  const overlay = h('div', { class: 'onb-overlay', hidden: true }, card);
  root.appendChild(overlay);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(step + 1);
    else if (e.key === 'ArrowLeft') go(step - 1);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation(); // don't let the drawing shortcuts see these keys
  });

  function render(): void {
    const s = STEPS[step];
    const svg = icon(s.art);
    svg.setAttribute('viewBox', '0 0 48 48');
    art.replaceChildren(svg);
    title.textContent = s.title;
    text.textContent = s.text;
    counter.textContent = `Step ${step + 1} of ${STEPS.length}`;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === step));
    back.hidden = step === 0;
    next.textContent = step === STEPS.length - 1 ? "Let's draw!" : 'Next';
    next.focus();
  }

  function go(i: number): void {
    if (i >= STEPS.length) return close();
    step = Math.max(0, i);
    render();
  }

  function open(): void {
    step = 0;
    overlay.hidden = false;
    render();
  }

  function close(): void {
    overlay.hidden = true;
    saveJSON(SEEN_KEY, true);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  return {
    open,
    maybeShowFirstTime() {
      if (!loadJSON<boolean>(SEEN_KEY)) open();
    },
  };
}
