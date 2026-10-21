/**
 * The "Helpers" panel: one switch per assistance feature.
 *
 * Names are written for young users ("Magnet ends" rather than "endpoint
 * snapping"); the technical names are used in logs, README and DESIGN.md.
 */
import { settings, type AssistToggles } from '../app/state';
import { h, icon } from './dom';
import { ICONS } from './icons';

export const ASSIST_INFO: Record<keyof AssistToggles, { title: string; text: string; key: string }> = {
  depthGuides: { title: 'Depth guides', text: 'Shadows and a line to the floor show how far away your pencil is.', key: 'G' },
  snapping: { title: 'Magnet ends', text: 'Line ends stick together when you get close.', key: 'M' },
  beautify: { title: 'Tidy shapes', text: 'Offers a neat line, circle or arc after a wobbly one.', key: 'B' },
  adaptive: { title: 'Smart help', text: 'Turns helpers on when drawing gets tricky, and off as you improve.', key: 'A' },
};

export const ASSIST_ORDER: (keyof AssistToggles)[] = ['depthGuides', 'snapping', 'beautify', 'adaptive'];

export function toggleAssist(k: keyof AssistToggles): void {
  const assist = settings.get().assist;
  settings.set({ assist: { ...assist, [k]: !assist[k] } });
}

export interface AssistPanelHandle {
  panel: HTMLElement;
  /** Lock every switch (study mode) with an explanation, or unlock with null. */
  setLocked(reason: string | null): void;
  /**
   * Show the helpers that are *actually* active. With Smart help on, the
   * three helpers it manages show its choices and can't be flipped by hand.
   */
  render(effective: AssistToggles, smartHelpOn: boolean): void;
}

export function createAssistPanel(root: HTMLElement, onClose: () => void): AssistPanelHandle {
  const switches = ASSIST_ORDER.map((k) => {
    const info = ASSIST_INFO[k];
    const sw = h(
      'button',
      { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', onclick: () => toggleAssist(k), id: `assist-${k}` },
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
      h('span', { class: 'switch-text' }, h('strong', {}, info.title, ' ', h('kbd', {}, info.key)), h('span', {}, info.text)),
    );
    return { k, sw };
  });

  const note = h('p', { class: 'assist-lock', hidden: true });
  const autoNote = h('p', { class: 'assist-auto', hidden: true }, 'Smart help is choosing the helpers above for you.');
  const panel = h(
    'div',
    { class: 'panel assist', role: 'dialog', 'aria-labelledby': 'assist-title', hidden: true },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { id: 'assist-title' }, 'Helpers'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close helpers', onclick: onClose }, icon(ICONS.close)),
    ),
    note,
    ...switches.slice(0, 3).map((s) => s.sw),
    autoNote,
    switches[3].sw,
  );
  root.appendChild(panel);

  let locked = false;
  let smart = false;
  const applyDisabled = () => {
    for (const { k, sw } of switches) sw.disabled = locked || (smart && k !== 'adaptive');
  };

  return {
    panel,
    // Study mode locks the switches so a participant can't change their condition mid-task.
    setLocked(reason) {
      locked = !!reason;
      note.hidden = !reason;
      note.textContent = reason ?? '';
      applyDisabled();
    },
    render(effective, smartHelpOn) {
      smart = smartHelpOn;
      autoNote.hidden = !smartHelpOn;
      for (const { k, sw } of switches) {
        sw.setAttribute('aria-checked', String(effective[k]));
        sw.classList.toggle('auto', smartHelpOn && k !== 'adaptive');
      }
      applyDisabled();
    },
  };
}
