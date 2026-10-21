/**
 * The main on-screen controls:
 *   - top bar:     app name, theme + help buttons
 *   - left dock:   undo / redo / clear / save
 *   - bottom dock: 8 colours and 3 brush sizes
 *   - right dock:  drawing-wall controls (rotate, tilt, push, pull, ...)
 *
 * All buttons are at least 48×48 px with visible text labels, and every one
 * has its keyboard shortcut in its tooltip.
 */
import { settings } from '../app/state';
import { BRUSH_SIZE_ORDER, BRUSH_SIZES, PALETTE } from '../drawing/palette';
import type { StrokeStore } from '../drawing/StrokeStore';
import type { Actions } from './actions';
import { h, icon } from './dom';
import { ICONS } from './icons';

type IconName = keyof typeof ICONS;

export function toolButton(
  iconName: IconName,
  label: string,
  onClick: () => void,
  opts: { shortcut?: string; class?: string } = {},
): HTMLButtonElement {
  const title = opts.shortcut ? `${label} (${opts.shortcut})` : label;
  return h(
    'button',
    { class: `tool ${opts.class ?? ''}`, title, 'aria-label': title, onclick: onClick, type: 'button' },
    icon(ICONS[iconName]),
    h('span', { class: 'tool-label' }, label),
  );
}

export function createToolbar(root: HTMLElement, actions: Actions, store: StrokeStore): HTMLElement {
  // --- top bar -------------------------------------------------------------
  const themeBtn = toolButton('moon', 'Night', actions.toggleTheme, { shortcut: 'T', class: 'compact' });
  const topRight = h(
    'div',
    { class: 'dock top-right', role: 'toolbar', 'aria-label': 'App' },
    toolButton('sparkles', 'Helpers', actions.toggleAssistPanel, { shortcut: 'H', class: 'compact' }),
    themeBtn,
    toolButton('help', 'Help', actions.toggleHelp, { shortcut: '?', class: 'compact' }),
  );
  const brand = h(
    'div',
    { class: 'brand' },
    h('span', { class: 'brand-cloud', 'aria-hidden': 'true' }, '☁'),
    h('span', {}, 'Sky', h('b', {}, 'Doodle')),
  );

  // --- left dock: history + file -------------------------------------------
  const undoBtn = toolButton('undo', 'Undo', actions.undo, { shortcut: 'Ctrl+Z' });
  const redoBtn = toolButton('redo', 'Redo', actions.redo, { shortcut: 'Ctrl+Y' });
  const clearBtn = toolButton('trash', 'Clear', actions.clear, { shortcut: 'Delete' });
  const left = h(
    'div',
    { class: 'dock left', role: 'toolbar', 'aria-label': 'Edit', 'aria-orientation': 'vertical' },
    undoBtn,
    redoBtn,
    clearBtn,
    h('hr', {}),
    toolButton('download', 'Save 3D', actions.exportGlb, { shortcut: 'Ctrl+S' }),
    // Study tools are hidden while a trial runs (CSS: body.in-trial .study-tools).
    h('hr', { class: 'study-tools' }),
    toolButton('flag', 'Study', actions.openStudy, { class: 'study-tools' }),
    toolButton('chart', 'Results', actions.openResults, { class: 'study-tools' }),
  );

  // --- bottom dock: colours + sizes ------------------------------------------
  const swatches = PALETTE.map((c, i) =>
    h('button', {
      class: 'swatch',
      type: 'button',
      style: `--swatch:${c.hex}`,
      title: `${c.name} (${i + 1})`,
      'aria-label': `${c.name} colour`,
      onclick: () => actions.setColorIndex(i),
    }),
  );
  const sizes = BRUSH_SIZE_ORDER.map((id) =>
    h(
      'button',
      {
        class: `size size-${id}`,
        type: 'button',
        title: `${BRUSH_SIZES[id].label} brush ([ / ])`,
        'aria-label': `${BRUSH_SIZES[id].label} brush`,
        onclick: () => settings.set({ size: id }),
      },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
    ),
  );
  const bottom = h(
    'div',
    { class: 'dock bottom', role: 'toolbar', 'aria-label': 'Brush' },
    h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour' }, ...swatches),
    h('div', { class: 'divider', 'aria-hidden': 'true' }),
    h('div', { class: 'sizes', role: 'group', 'aria-label': 'Brush size' }, ...sizes),
  );

  // --- right dock: drawing wall -----------------------------------------------
  const right = h(
    'div',
    { class: 'dock right', role: 'toolbar', 'aria-label': 'Drawing wall', 'aria-orientation': 'vertical' },
    h('div', { class: 'dock-title' }, 'Drawing wall'),
    h(
      'div',
      { class: 'grid2' },
      toolButton('rotateLeft', 'Turn', () => actions.planeRotate(-1), { shortcut: 'Q / ←' }),
      toolButton('rotateRight', 'Turn', () => actions.planeRotate(1), { shortcut: 'E / →' }),
      toolButton('tiltUp', 'Tilt', () => actions.planeTilt(-1), { shortcut: '↑' }),
      toolButton('tiltDown', 'Tilt', () => actions.planeTilt(1), { shortcut: '↓' }),
      toolButton('pushAway', 'Away', () => actions.planePush(0.1), { shortcut: 'W / scroll up' }),
      toolButton('pullCloser', 'Closer', () => actions.planePush(-0.1), { shortcut: 'S / scroll down' }),
      toolButton('flat', 'Flat', actions.planeToggleFlat, { shortcut: 'F' }),
      toolButton('eye', 'Face me', actions.planeFaceCamera, { shortcut: 'V' }),
    ),
    toolButton('home', 'Reset wall', actions.planeReset, { shortcut: 'R', class: 'wide' }),
  );

  root.append(brand, topRight, left, bottom, right);

  // --- keep buttons in sync with state -------------------------------------------
  const sync = () => {
    const s = settings.get();
    swatches.forEach((b, i) => {
      const on = PALETTE[i].hex === s.color;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    sizes.forEach((b, i) => {
      const on = BRUSH_SIZE_ORDER[i] === s.size;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const dark = s.theme === 'dark';
    const themeLabel = dark ? 'Day' : 'Night';
    themeBtn.replaceChildren(icon(dark ? ICONS.sun : ICONS.moon), h('span', { class: 'tool-label' }, themeLabel));
    themeBtn.title = `${themeLabel} sky (T)`;
    themeBtn.setAttribute('aria-label', `Switch to ${themeLabel.toLowerCase()} sky (T)`);
  };
  const syncHistory = () => {
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
    clearBtn.disabled = store.strokes.length === 0;
  };
  settings.subscribe(sync);
  store.onChange(syncHistory);
  sync();
  syncHistory();
  return root;
}
