/**
 * Results page: compare conditions across completed study trials.
 *
 * Chart form: for each measure, one column per condition showing the *mean*,
 * a whisker for ±1 standard deviation, and every individual trial as a dot.
 * With small samples the dots matter most: they show the spread and outliers
 * that a mean alone would hide.
 *
 * Accessibility: conditions are named on the x-axis (never colour alone),
 * every mark has a hover tooltip, and the full numbers are in the summary
 * table below the charts.
 */
import { CONDITION_LABEL, STROKE_COLUMNS, TRIAL_COLUMNS, type Condition, type InteractionLog, type TaskId, type TrialRecord } from '../logging/InteractionLog';
import { toCSV } from '../logging/csv';
import { cohensD, fmt, summarize, welchT, type Summary } from '../logging/stats';
import { TASK_ORDER, TASKS } from '../study/tasks';
import { downloadText, fileStamp } from './download';
import { h, icon } from './dom';
import { ICONS } from './icons';

const CONDITIONS: Condition[] = ['off', 'on', 'smart'];
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Measure {
  key: string;
  title: string;
  unit: string;
  digits: number;
  /** Which direction is better, for the reader ("lower is better"). */
  better: 'lower' | 'higher' | null;
  get: (t: TrialRecord) => number | null;
  chart: boolean;
}

const MEASURES: Measure[] = [
  { key: 'time', title: 'Task time', unit: 's', digits: 1, better: 'lower', get: (t) => t.durationS, chart: true },
  { key: 'error', title: 'Stroke error', unit: 'score 0–1', digits: 2, better: 'lower', get: (t) => t.meanErrorScore, chart: true },
  { key: 'connected', title: 'Line ends joined', unit: '%', digits: 0, better: 'higher', get: (t) => t.connectedPct, chart: true },
  { key: 'stars', title: 'Distance to stars', unit: 'cm', digits: 1, better: 'lower', get: (t) => t.starErrorCm, chart: true },
  { key: 'wobble', title: 'Wobble', unit: 'mm', digits: 2, better: 'lower', get: (t) => t.meanWobbleMm, chart: false },
  { key: 'missed', title: 'Missed connections', unit: 'per trial', digits: 1, better: 'lower', get: (t) => t.missedConnections, chart: false },
  { key: 'undos', title: 'Undos', unit: 'per trial', digits: 1, better: 'lower', get: (t) => t.undoCount, chart: false },
  { key: 'strokes', title: 'Strokes', unit: 'per trial', digits: 1, better: null, get: (t) => t.strokeCount, chart: false },
];

export interface ResultsHandle {
  panel: HTMLElement;
  open(): void;
}

export function createResultsPage(root: HTMLElement, log: InteractionLog, onClose: () => void): ResultsHandle {
  let filter: TaskId | 'all' = 'all';
  const body = h('div', { class: 'results-body' });
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by task' });
  const tooltip = h('div', { class: 'viz-tooltip', role: 'status', hidden: true });

  const panel = h(
    'div',
    { class: 'panel results viz-root', role: 'dialog', 'aria-labelledby': 'results-title', hidden: true },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'results-title' }, 'Results'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close results', onclick: onClose }, icon(ICONS.close))),
    filters,
    body,
    tooltip,
  );
  root.appendChild(panel);

  function render(): void {
    // Filter chips: All + each task that has data.
    const options: (TaskId | 'all')[] = ['all', ...TASK_ORDER];
    filters.replaceChildren(
      ...options.map((o) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(o === filter), onclick: () => ((filter = o), render()) },
          o === 'all' ? 'All tasks' : TASKS[o].title.replace(/^Draw an? /, '').replace(/^Connect the /, '').replace(/^./, (c) => c.toUpperCase())),
      ),
    );

    const trials = log.trials.filter((t) => t.completed && (filter === 'all' || t.taskId === filter));
    const present = CONDITIONS.filter((c) => trials.some((t) => t.condition === c));
    const participants = new Set(trials.map((t) => t.participantId));

    const children: Node[] = [];
    children.push(
      h('div', { class: 'stat-row' },
        stat('Trials', String(trials.length)),
        stat('Participants', String(participants.size)),
        stat('Strokes logged', log.strokes.length.toLocaleString()),
        stat('Cancelled trials', String(log.trials.filter((t) => !t.completed).length))),
    );

    if (trials.length === 0) {
      children.push(
        h('div', { class: 'empty' },
          h('p', {}, h('strong', {}, 'No completed study trials yet.')),
          h('p', {}, 'Open Study mode, enter a participant ID, and run a task. Free drawing is still logged per stroke and can be exported below.')),
      );
    } else {
      // Legend (identity never by colour alone: x-axis labels also name each condition).
      children.push(
        h('div', { class: 'legend', 'aria-hidden': 'true' },
          ...present.map((c) => h('span', { class: 'legend-item' }, h('span', { class: 'swatch-dot', 'data-cond': c }), CONDITION_LABEL[c]))),
      );
      const grid = h('div', { class: 'chart-grid' });
      for (const m of MEASURES.filter((m) => m.chart)) {
        const groups = present.map((c) => ({
          condition: c,
          values: trials.filter((t) => t.condition === c).map((t) => m.get(t)).filter((v): v is number => v !== null && Number.isFinite(v)),
        }));
        if (groups.every((g) => g.values.length === 0)) continue;
        grid.appendChild(chartCard(m, groups, tooltip, panel));
      }
      children.push(grid);
      children.push(summaryTable(trials, present));
      children.push(
        h('p', { class: 'note' },
          'Exploratory results: with a handful of participants, treat differences as trends to investigate, not proof. ',
          'Cohen’s d: about 0.2 is small, 0.5 medium, 0.8 large. Positive d means the condition scored higher than Helpers OFF.'),
      );
    }

    // Export + data management
    let confirmArmed = false;
    const clearBtn = h('button', { class: 'btn danger', type: 'button' }, 'Delete all data…') as HTMLButtonElement;
    clearBtn.addEventListener('click', () => {
      if (!confirmArmed) {
        confirmArmed = true;
        clearBtn.textContent = 'Click again to delete everything';
        setTimeout(() => {
          confirmArmed = false;
          clearBtn.textContent = 'Delete all data…';
        }, 4000);
        return;
      }
      log.clearAll();
      render();
    });
    children.push(
      h('div', { class: 'export-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText(toCSV(log.trials, TRIAL_COLUMNS), `skydoodle_trials_${fileStamp()}.csv`, 'text/csv') }, icon(ICONS.download), 'Trials CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText(toCSV(log.strokes, STROKE_COLUMNS), `skydoodle_strokes_${fileStamp()}.csv`, 'text/csv') }, icon(ICONS.download), 'Strokes CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText(JSON.stringify(log.toJSON(), null, 2), `skydoodle_data_${fileStamp()}.json`, 'application/json') }, icon(ICONS.download), 'All data JSON'),
        h('span', { class: 'spacer' }),
        clearBtn),
    );
    body.replaceChildren(...children);
  }

  return {
    panel,
    open() {
      render();
      panel.hidden = false;
    },
  };
}

/** "cm · lower is better" (the unit, plus which direction is good, if any). */
function describe(m: Measure): string {
  return [m.unit, m.better && `${m.better} is better`].filter(Boolean).join(' · ');
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));
}

// ---------------------------------------------------------------------------
// Chart: mean column + ±1 SD whisker + individual trial dots, per condition
// ---------------------------------------------------------------------------

function chartCard(m: Measure, groups: { condition: Condition; values: number[] }[], tooltip: HTMLElement, panel: HTMLElement): HTMLElement {
  const W = 320;
  const H = 210;
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const summaries = groups.map((g) => ({ ...g, s: summarize(g.values) }));
  const dataMax = Math.max(
    ...summaries.flatMap((g) => [...g.values, g.s.mean + (Number.isFinite(g.s.sd) ? g.s.sd : 0)]),
    m.unit === '%' ? 100 : 0,
  );
  const { max, ticks } = niceScale(m.unit === '%' ? 100 : dataMax);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const band = innerW / groups.length;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${m.title} by condition` });

  // Gridlines + y ticks (recessive hairlines)
  for (const t of ticks) {
    svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'grid' }));
    const label = svgEl('text', { x: pad.l - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = formatTick(t);
    svg.appendChild(label);
  }

  summaries.forEach((g, i) => {
    const cx = pad.l + band * i + band / 2;
    const bw = Math.min(24, band * 0.4);
    const hasMean = Number.isFinite(g.s.mean);

    // Mean column with a 4px rounded top, square at the baseline.
    if (hasMean && g.s.mean > 0) {
      const top = y(g.s.mean);
      const base = y(0);
      const r = Math.min(4, (base - top) / 2);
      const d = `M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z`;
      const bar = svgEl('path', { d, class: 'bar', 'data-cond': g.condition });
      hover(bar, tooltip, panel, `${CONDITION_LABEL[g.condition]}: mean ${fmt(g.s.mean, m.digits)} ${m.unit}, SD ${fmt(g.s.sd, m.digits)}, n = ${g.s.n}`);
      svg.appendChild(bar);
    }

    // ±1 SD whisker, clamped to the plotted range (e.g. % can't exceed 100).
    if (Number.isFinite(g.s.sd)) {
      const lo = y(Math.max(0, g.s.mean - g.s.sd));
      const hi = y(Math.min(max, g.s.mean + g.s.sd));
      svg.appendChild(svgEl('line', { x1: cx, x2: cx, y1: lo, y2: hi, class: 'whisker' }));
      svg.appendChild(svgEl('line', { x1: cx - 6, x2: cx + 6, y1: hi, y2: hi, class: 'whisker' }));
      svg.appendChild(svgEl('line', { x1: cx - 6, x2: cx + 6, y1: lo, y2: lo, class: 'whisker' }));
    }

    // Individual trials, offset to the right of the column with a little
    // deterministic jitter so equal values don't hide each other.
    g.values.forEach((v, k) => {
      const jx = cx + bw / 2 + 12 + ((k * 37) % 17);
      const dot = svgEl('circle', { cx: jx, cy: y(v), r: 4.5, class: 'dot', 'data-cond': g.condition });
      hover(dot, tooltip, panel, `${CONDITION_LABEL[g.condition]} trial: ${fmt(v, m.digits)} ${m.unit}`);
      svg.appendChild(dot);
    });

    // Condition name on the x-axis (identity in text, not only colour).
    const xl = svgEl('text', { x: cx, y: H - 12, class: 'xlabel', 'text-anchor': 'middle' });
    xl.textContent = CONDITION_LABEL[g.condition];
    svg.appendChild(xl);
  });
  svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'axis' }));

  return h('figure', { class: 'chart-card' },
    h('figcaption', {}, h('strong', {}, m.title), h('span', {}, describe(m))),
    svg as unknown as HTMLElement);
}

function hover(el: SVGElement, tooltip: HTMLElement, panel: HTMLElement, text: string): void {
  const t = svgEl('title', {});
  t.textContent = text; // fallback for assistive tech / no-hover devices
  el.appendChild(t);
  el.addEventListener('pointerenter', (e) => {
    tooltip.textContent = text;
    tooltip.hidden = false;
    move(e as PointerEvent);
  });
  el.addEventListener('pointermove', (e) => move(e as PointerEvent));
  el.addEventListener('pointerleave', () => (tooltip.hidden = true));
  function move(e: PointerEvent) {
    const r = panel.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - r.left + panel.scrollLeft + 14}px`;
    tooltip.style.top = `${e.clientY - r.top + panel.scrollTop - 10}px`;
  }
}

/** Round the axis maximum up to a "nice" number and produce ~4 ticks. */
export function niceScale(dataMax: number): { max: number; ticks: number[] } {
  if (!(dataMax > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const rough = dataMax / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const max = Math.ceil(dataMax / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { max, ticks };
}

function formatTick(v: number): string {
  return Math.abs(v) >= 1000 ? v.toLocaleString() : String(+v.toFixed(2));
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// ---------------------------------------------------------------------------
// Summary table (the full numbers: also the accessible "table view")
// ---------------------------------------------------------------------------

function summaryTable(trials: TrialRecord[], present: Condition[]): HTMLElement {
  const compare = present.filter((c) => c !== 'off' && present.includes('off'));
  const head = h('tr', {},
    h('th', { scope: 'col' }, 'Measure'),
    ...present.map((c) => h('th', { scope: 'col' }, h('span', { class: 'swatch-dot', 'data-cond': c, 'aria-hidden': 'true' }), CONDITION_LABEL[c], h('br', {}), h('small', {}, 'mean ± SD (n)'))),
    ...compare.map((c) => h('th', { scope: 'col' }, `${CONDITION_LABEL[c]} vs OFF`, h('br', {}), h('small', {}, 'difference · d · t'))),
  );
  const rows = MEASURES.map((m) => {
    const sums = new Map<Condition, Summary>(
      present.map((c) => [c, summarize(trials.filter((t) => t.condition === c).map((t) => m.get(t)).filter((v): v is number => v !== null))]),
    );
    if ([...sums.values()].every((s) => s.n === 0)) return null;
    return h('tr', {},
      h('th', { scope: 'row' }, m.title, h('br', {}), h('small', {}, describe(m))),
      ...present.map((c) => {
        const s = sums.get(c)!;
        return h('td', {}, s.n ? `${fmt(s.mean, m.digits)} ± ${fmt(s.sd, m.digits)} (${s.n})` : '–');
      }),
      ...compare.map((c) => {
        const a = sums.get(c)!;
        const b = sums.get('off')!;
        const diff = a.mean - b.mean;
        const { t, df } = welchT(a, b);
        return h('td', {}, `${Number.isFinite(diff) ? (diff > 0 ? '+' : '') + fmt(diff, m.digits) : '–'} · d ${fmt(cohensD(a, b))} · t(${fmt(df, 1)}) ${fmt(t)}`);
      }),
    );
  }).filter((r): r is HTMLTableRowElement => r !== null);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'summary' }, h('caption', {}, 'Summary by condition (completed trials)'), h('thead', {}, head), h('tbody', {}, ...rows)));
}
