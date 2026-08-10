import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/core/config.js';
import { EditStream, changedLineRange } from '../src/core/editStream.js';

const URI = 'file:///p/src/main.rs';

describe('changedLineRange', () => {
  it('returns null for an identical snapshot', () => {
    expect(changedLineRange('a\nb\n', 'a\nb\n')).toBeNull();
  });

  it('finds a single edited line', () => {
    expect(changedLineRange('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ startLine: 1, endLine: 1 });
  });

  it('spans an inserted block', () => {
    const r = changedLineRange('a\nz\n', 'a\nb\nc\nz\n');
    expect(r?.startLine).toBe(1);
    expect(r?.endLine).toBeGreaterThanOrEqual(2);
  });
});

describe('EditStream churn', () => {
  it('does not count opening a file as an edit', () => {
    // Otherwise opening a 400-line file reads as 400 lines of thrashing.
    const s = new EditStream(defaultConfig);
    expect(s.onEdit(URI, 'fn main() {}\n', 0)).toBeNull();
    expect(s.churningRegions(0)).toEqual([]);
  });

  it('reports a region rewritten past the threshold', () => {
    const s = new EditStream(defaultConfig);
    s.onEdit(URI, 'let a = 1;\n', 0);
    s.onEdit(URI, 'let a = 2;\n', 1_000);
    s.onEdit(URI, 'let a = 3;\n', 2_000);
    expect(s.churningRegions(2_000)).toEqual([]);

    s.onEdit(URI, 'let a = 4;\n', 3_000);
    const regions = s.churningRegions(3_000);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.touches).toBe(3);
  });

  it('forgets touches once they fall outside the window', () => {
    const s = new EditStream(defaultConfig);
    s.onEdit(URI, 'let a = 1;\n', 0);
    s.onEdit(URI, 'let a = 2;\n', 1_000);
    s.onEdit(URI, 'let a = 3;\n', 2_000);
    s.onEdit(URI, 'let a = 4;\n', 3_000);
    expect(s.churningRegions(3_000)).toHaveLength(1);

    const later = 3_000 + defaultConfig.churnWindowMs + 1;
    expect(s.churningRegions(later)).toEqual([]);
  });

  it('tracks idleness across files', () => {
    const s = new EditStream(defaultConfig);
    expect(s.idleMs(5_000)).toBe(Number.POSITIVE_INFINITY);
    s.onEdit(URI, 'x\n', 1_000);
    expect(s.idleMs(5_000)).toBe(4_000);
  });
});
