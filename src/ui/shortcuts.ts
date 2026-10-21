/**
 * Keyboard shortcuts, defined once as data.
 *
 * The same table drives the keydown handler *and* the Help panel, so the help
 * text can never drift out of date with the real bindings.
 */
import type { AssistToggles } from '../app/state';
import { isTyping } from '../drawing/DesktopInput';
import type { Actions } from './actions';
import { h, icon } from './dom';
import { ICONS } from './icons';

interface Shortcut {
  keys: string;
  label: string;
  group: 'Drawing' | 'Drawing wall' | 'Camera' | 'App';
  match?: (e: KeyboardEvent) => boolean;
  run?: (e: KeyboardEvent) => void;
}

const ctrl = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
const ASSIST_KEYS: Record<string, keyof AssistToggles> = { g: 'depthGuides', m: 'snapping', b: 'beautify', a: 'adaptive' };
const key = (k: string) => (e: KeyboardEvent) => plain(e) && e.key.toLowerCase() === k;

export function buildShortcuts(a: Actions): Shortcut[] {
  return [
    { keys: '1 – 8', label: 'Pick a colour', group: 'Drawing', match: (e) => plain(e) && /^[1-8]$/.test(e.key), run: (e) => a.setColorIndex(Number(e.key) - 1) },
    { keys: '[  ]', label: 'Smaller / bigger brush', group: 'Drawing', match: (e) => plain(e) && (e.key === '[' || e.key === ']'), run: (e) => a.cycleSize(e.key === ']' ? 1 : -1) },
    { keys: 'Ctrl+Z', label: 'Undo', group: 'Drawing', match: (e) => ctrl(e) && !e.shiftKey && e.key.toLowerCase() === 'z', run: a.undo },
    { keys: 'Ctrl+Y / Ctrl+Shift+Z', label: 'Redo', group: 'Drawing', match: (e) => ctrl(e) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')), run: a.redo },
    { keys: 'Delete', label: 'Clear everything (undo brings it back)', group: 'Drawing', match: (e) => plain(e) && e.key === 'Delete', run: a.clear },
    { keys: 'Ctrl+S', label: 'Save as 3D file (.glb)', group: 'Drawing', match: (e) => ctrl(e) && e.key.toLowerCase() === 's', run: a.exportGlb },

    { keys: 'Q / E  or  ← / →', label: 'Turn the wall', group: 'Drawing wall', match: (e) => plain(e) && ['q', 'e', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase()), run: (e) => a.planeRotate(['q', 'arrowleft'].includes(e.key.toLowerCase()) ? -1 : 1) },
    { keys: '↑ / ↓', label: 'Tilt the wall', group: 'Drawing wall', match: (e) => plain(e) && (e.key === 'ArrowUp' || e.key === 'ArrowDown'), run: (e) => a.planeTilt(e.key === 'ArrowUp' ? -1 : 1) },
    { keys: 'Scroll  or  W / S', label: 'Push the wall away / closer', group: 'Drawing wall', match: (e) => key('w')(e) || key('s')(e), run: (e) => a.planePush(e.key.toLowerCase() === 'w' ? 0.1 : -0.1) },
    { keys: 'F', label: 'Lay the wall flat / stand it up', group: 'Drawing wall', match: key('f'), run: a.planeToggleFlat },
    { keys: 'V', label: 'Turn the wall to face me', group: 'Drawing wall', match: key('v'), run: a.planeFaceCamera },
    { keys: 'R', label: 'Reset the wall', group: 'Drawing wall', match: key('r'), run: a.planeReset },

    { keys: 'Right-drag  or  Space + drag', label: 'Look around', group: 'Camera' },
    { keys: 'Middle-drag', label: 'Slide the view', group: 'Camera' },
    { keys: 'Ctrl + scroll  or  pinch', label: 'Zoom', group: 'Camera' },

    { keys: 'H', label: 'Open the Helpers panel', group: 'App', match: key('h'), run: a.toggleAssistPanel },
    {
      keys: 'G / M / B / A',
      label: 'Switch a helper on or off (Depth guides, Magnet ends, Tidy shapes, Smart help)',
      group: 'App',
      match: (e) => plain(e) && e.key.toLowerCase() in ASSIST_KEYS,
      run: (e) => a.toggleAssist(ASSIST_KEYS[e.key.toLowerCase()]),
    },
    { keys: 'T', label: 'Day / night sky', group: 'App', match: key('t'), run: a.toggleTheme },
    { keys: '?', label: 'Show / hide this help', group: 'App', match: (e) => e.key === '?', run: a.toggleHelp },
    { keys: 'Esc', label: 'Close any open panel', group: 'App' },
  ];
}

export function installShortcuts(shortcuts: Shortcut[]): void {
  window.addEventListener('keydown', (e) => {
    // Holding a key repeats only for "continuous" moves (arrows, W/S/Q/E).
    if (isTyping(e) || (e.repeat && !/^Arrow|^[wsqe]$/i.test(e.key))) return;
    const s = shortcuts.find((sc) => sc.match?.(e));
    if (!s?.run) return;
    e.preventDefault();
    s.run(e);
  });
}

/** A modal-ish panel listing every shortcut, grouped. */
export function createHelpPanel(root: HTMLElement, shortcuts: Shortcut[], onClose: () => void, onTour: () => void): HTMLElement {
  const groups = [...new Set(shortcuts.map((s) => s.group))];
  const panel = h(
    'div',
    { class: 'panel help', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'help-title', hidden: true },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { id: 'help-title' }, 'How to draw in the sky'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close help', onclick: onClose }, icon(ICONS.close)),
    ),
    h(
      'p',
      { class: 'lead' },
      'Your pencil draws on the see-through blue wall. Move the wall to draw nearer or further away. ',
      'That is how you draw in 3D!',
    ),
    h(
      'div',
      { class: 'help-grid' },
      ...groups.map((g) =>
        h(
          'section',
          {},
          h('h3', {}, g),
          h(
            'dl',
            {},
            ...shortcuts
              .filter((s) => s.group === g)
              .flatMap((s) => [h('dt', {}, h('kbd', {}, s.keys)), h('dd', {}, s.label)]),
          ),
        ),
      ),
    ),
    h('div', { class: 'help-actions' }, h('button', { class: 'btn', type: 'button', onclick: onTour }, 'Show the 3-step tour again')),
  );
  root.appendChild(panel);
  return panel;
}
