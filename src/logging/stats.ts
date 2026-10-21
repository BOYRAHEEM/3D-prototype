/**
 * Small descriptive statistics for the results page.
 *
 * With a handful of friends as participants, the honest thing to report is
 * descriptive: n, mean, standard deviation, and an effect size. Welch's t is
 * included as an *exploratory* indicator only; with n ≈ 5 per condition it
 * has little power, and the results page says so.
 */

export interface Summary {
  n: number;
  mean: number;
  /** Sample standard deviation (n − 1). NaN when n < 2. */
  sd: number;
  min: number;
  max: number;
}

export function summarize(values: readonly number[]): Summary {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean, sd, min: Math.min(...v), max: Math.max(...v) };
}

/**
 * Cohen's d with pooled SD: the difference between two means in units of
 * standard deviation. Rough guide: 0.2 small, 0.5 medium, 0.8 large.
 */
export function cohensD(a: Summary, b: Summary): number {
  if (a.n < 2 || b.n < 2) return NaN;
  const pooled = Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2));
  return pooled > 0 ? (a.mean - b.mean) / pooled : NaN;
}

/** Welch's t statistic and its approximate degrees of freedom. */
export function welchT(a: Summary, b: Summary): { t: number; df: number } {
  if (a.n < 2 || b.n < 2) return { t: NaN, df: NaN };
  const va = a.sd ** 2 / a.n;
  const vb = b.sd ** 2 / b.n;
  const t = (a.mean - b.mean) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
  return { t, df };
}

/** Format a number for display, or an en dash when it is not available. */
export function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '–';
}
