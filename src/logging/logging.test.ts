import { describe, expect, it } from 'vitest';
import { csvCell, toCSV } from './csv';
import { cohensD, summarize, welchT } from './stats';

describe('stats', () => {
  it('summarises with the sample SD', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(2.138, 3); // sample SD (n−1), not population SD (2.0)
  });

  it('handles empty and single-value input', () => {
    expect(summarize([]).n).toBe(0);
    expect(Number.isNaN(summarize([3]).sd)).toBe(true);
    expect(summarize([3, NaN, Infinity]).n).toBe(1);
  });

  it('computes Cohen d and Welch t', () => {
    const a = summarize([10, 12, 14]);
    const b = summarize([4, 6, 8]);
    expect(cohensD(a, b)).toBeCloseTo(3, 6); // means differ by 6, pooled SD 2
    const { t, df } = welchT(a, b);
    expect(t).toBeCloseTo(6 / Math.sqrt(4 / 3 + 4 / 3), 6);
    expect(df).toBeCloseTo(4, 6);
  });
});

describe('csv', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(0.1 + 0.2)).toBe('0.3');
  });

  it('writes a header and rows in column order', () => {
    const csv = toCSV([{ b: 2, a: 'x' }], ['a', 'b']);
    expect(csv).toBe('a,b\r\nx,2\r\n');
  });
});
