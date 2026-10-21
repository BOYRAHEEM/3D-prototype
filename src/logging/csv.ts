/**
 * CSV export. Follows RFC 4180: fields containing commas, quotes or newlines
 * are wrapped in double quotes, and quotes inside them are doubled. That way
 * the file opens correctly in Excel, Google Sheets, R and pandas.
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toPrecision(10)) : '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of objects → CSV text with a header row, in the given column order. */
export function toCSV<T extends object>(rows: readonly T[], columns: readonly (keyof T & string)[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c] as CsvValue)).join(','));
  return lines.join('\r\n') + '\r\n';
}
