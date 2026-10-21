/**
 * Study mode UI.
 *
 *   Setup panel  participant ID, condition (Helpers OFF / ON / Smart help),
 *                task, a checklist of what this participant has done, and a
 *                one-click "suggested next" that follows a counterbalanced order.
 *   Task bar     while a trial runs: the task, its condition, a timer, and
 *                Done / Cancel. It sits where the logo normally is.
 */
import { CONDITION_LABEL, type Condition, type InteractionLog, type TaskId } from '../logging/InteractionLog';
import type { StudyMode } from '../study/StudyMode';
import { suggestedOrder, TASK_ORDER, TASKS } from '../study/tasks';
import { h, icon } from './dom';
import { ICONS } from './icons';

const CONDITIONS: Condition[] = ['off', 'on', 'smart'];
const CONDITION_HINT: Record<Condition, string> = {
  off: 'No helpers at all.',
  on: 'Depth guides, magnet ends and tidy shapes all on.',
  smart: 'Helpers appear only when needed (adaptive).',
};

export interface StudyPanelHandle {
  panel: HTMLElement;
  open(): void;
  /** End the running trial (used by the VR wrist "Done" button). */
  finish(completed: boolean): void;
  /** "Draw a cube · 1:23" while a trial runs, else null (shown on the VR wrist). */
  trialText(): string | null;
}

export function createStudyPanel(
  root: HTMLElement,
  study: StudyMode,
  log: InteractionLog,
  hooks: { onClose: () => void; beforeFinish: () => void },
): StudyPanelHandle {
  let condition: Condition = 'off';
  let task: TaskId = 'cube';

  // ---- setup panel ------------------------------------------------------------
  const pid = h('input', {
    id: 'study-pid',
    class: 'text-input',
    type: 'text',
    maxlength: 20,
    autocomplete: 'off',
    spellcheck: 'false',
    value: nextParticipantId(log),
  });
  const condButtons = CONDITIONS.map((c) =>
    h('button', { class: 'seg', type: 'button', 'aria-pressed': 'false', onclick: () => ((condition = c), sync()) },
      h('strong', {}, CONDITION_LABEL[c]), h('span', {}, CONDITION_HINT[c])),
  );
  const taskButtons = TASK_ORDER.map((id) =>
    h('button', { class: 'task-card', type: 'button', 'aria-pressed': 'false', onclick: () => ((task = id), sync()) },
      taskIcon(id), h('strong', {}, TASKS[id].title)),
  );
  const progress = h('div', { class: 'study-progress' });
  const suggestion = h('div', { class: 'study-suggest' });
  const instruction = h('p', { class: 'study-instruction' });

  const panel = h(
    'div',
    { class: 'panel study', role: 'dialog', 'aria-labelledby': 'study-title', hidden: true },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'study-title' }, 'Study mode'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close study mode', onclick: hooks.onClose }, icon(ICONS.close))),
    h('p', { class: 'lead' },
      'Run a mini user study: each participant draws the same tasks with helpers OFF and ON. ',
      'Everything is saved on this computer only. Export it from the Results page.'),
    h('label', { class: 'field-label', for: 'study-pid' }, 'Participant ID'),
    h('div', { class: 'pid-row' }, pid, progress),
    suggestion,
    h('div', { class: 'field-label', id: 'cond-label' }, 'Condition'),
    h('div', { class: 'segs', role: 'group', 'aria-labelledby': 'cond-label' }, ...condButtons),
    h('div', { class: 'field-label', id: 'task-label' }, 'Task'),
    h('div', { class: 'task-cards', role: 'group', 'aria-labelledby': 'task-label' }, ...taskButtons),
    instruction,
    h('div', { class: 'study-actions' },
      h('button', { class: 'btn primary big', type: 'button', onclick: startTrial }, icon(ICONS.flag), 'Start task'),
      h('span', { class: 'muted' }, 'The canvas will be cleared.')),
  );
  root.appendChild(panel);
  pid.addEventListener('input', () => sync());

  // ---- task bar (during a trial) -------------------------------------------------
  const tbTitle = h('strong', {});
  const tbCond = h('span', { class: 'chip' });
  const tbTime = h('span', { class: 'timer', 'aria-label': 'Time' }, '0:00');
  const tbHint = h('span', { class: 'taskbar-hint' });
  const taskbar = h(
    'div',
    { class: 'taskbar', role: 'region', 'aria-label': 'Current study task', hidden: true },
    h('div', { class: 'taskbar-main' }, tbTitle, tbCond, tbTime),
    h('div', { class: 'taskbar-row' },
      tbHint,
      h('div', { class: 'taskbar-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => finish(true) }, 'Done ✓'),
        h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel'))),
  );
  root.appendChild(taskbar);

  let timer = 0;
  function startTrial(): void {
    const id = pid.value.trim() || 'P00';
    study.start(id, condition, task);
    panel.hidden = true;
    tbTitle.textContent = TASKS[task].title;
    tbCond.textContent = CONDITION_LABEL[condition];
    tbCond.dataset.cond = condition;
    tbHint.textContent = TASKS[task].instruction;
    taskbar.hidden = false;
    document.body.classList.add('in-trial');
    clearInterval(timer);
    timer = window.setInterval(() => (tbTime.textContent = clock(study.elapsedS)), 250);
  }

  function finish(completed: boolean): void {
    hooks.beforeFinish();
    study.finish(completed);
    clearInterval(timer);
    taskbar.hidden = true;
    document.body.classList.remove('in-trial');
    // Back to setup, pre-selecting the suggested next trial.
    open();
  }

  function sync(): void {
    condButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(CONDITIONS[i] === condition)));
    taskButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(TASK_ORDER[i] === task)));
    instruction.textContent = `Instructions for the participant: “${TASKS[task].instruction}”`;

    const id = pid.value.trim() || 'P00';
    const done = new Set(log.trials.filter((t) => t.participantId === id && t.completed).map((t) => `${t.taskId}:${t.condition}`));
    const order = suggestedOrder(id);
    progress.replaceChildren(
      ...order.map((o) => {
        const key = `${o.task}:${o.condition}`;
        return h('span', { class: `dot-chip${done.has(key) ? ' done' : ''}`, title: `${TASKS[o.task].title} · ${CONDITION_LABEL[o.condition]}${done.has(key) ? ' (done)' : ''}` },
          `${done.has(key) ? '✓ ' : ''}${o.task} ${o.condition.toUpperCase()}`);
      }),
    );
    const next = order.find((o) => !done.has(`${o.task}:${o.condition}`));
    suggestion.replaceChildren(
      next
        ? h('span', {}, 'Suggested next: ', h('strong', {}, `${TASKS[next.task].title} · ${CONDITION_LABEL[next.condition]}`), ' ',
            h('button', { class: 'link-btn', type: 'button', onclick: () => ((task = next.task), (condition = next.condition), sync()) }, 'Use this'))
        : h('span', {}, '✅ This participant has done every task in both conditions.'),
    );
  }

  function open(): void {
    const id = pid.value.trim();
    const order = suggestedOrder(id);
    const done = new Set(log.trials.filter((t) => t.participantId === id && t.completed).map((t) => `${t.taskId}:${t.condition}`));
    const next = order.find((o) => !done.has(`${o.task}:${o.condition}`));
    if (next) {
      task = next.task;
      condition = next.condition;
    }
    sync();
    panel.hidden = false;
  }

  sync();
  return {
    panel,
    open,
    finish: (completed) => study.trial && finish(completed),
    trialText: () => (study.trial ? `${TASKS[study.trial.taskId].title}
${clock(study.elapsedS)}` : null),
  };
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** P01, P02, …: one more than the highest participant number logged so far. */
function nextParticipantId(log: InteractionLog): string {
  const nums = log.trials.map((t) => parseInt(t.participantId.replace(/\D/g, ''), 10)).filter((n) => !Number.isNaN(n));
  const n = nums.length ? Math.max(...nums) : 0;
  return `P${String(n + 1).padStart(2, '0')}`;
}

function taskIcon(id: TaskId): SVGSVGElement {
  const svg = icon(TASKS[id].preview);
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.classList.add('task-icon');
  return svg;
}
