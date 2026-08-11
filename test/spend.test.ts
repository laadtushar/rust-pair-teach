import { describe, expect, it } from 'vitest';

import { dayOf, SpendGuard, type SpendState } from '../src/core/spend.js';

const DAY1 = '2026-01-01T09:00:00.000Z';
const DAY1_LATER = '2026-01-01T23:59:00.000Z';
const DAY2 = '2026-01-02T00:01:00.000Z';

function guard(limit: number, seed?: SpendState) {
  let saved: SpendState | null = seed ?? null;
  const g = new SpendGuard(
    {
      dailyCallLimit: limit,
      store: { load: () => saved, save: (s) => (saved = s) },
    },
    DAY1
  );
  return { g, saved: () => saved };
}

describe('daily spend guard (B3)', () => {
  it('allows calls up to the limit', () => {
    const { g } = guard(3);
    for (let i = 0; i < 3; i++) {
      expect(g.check(DAY1).allowed).toBe(true);
      g.record(DAY1);
    }
    expect(g.check(DAY1).allowed).toBe(false);
  });

  it('explains what to do rather than just refusing', () => {
    const { g } = guard(1);
    g.record(DAY1);
    const reason = g.check(DAY1).reason ?? '';
    expect(reason).toMatch(/resets at midnight/);
    expect(reason).toMatch(/dailyCallLimit/);
    // The point of the built-in material is that it still works when the budget does not.
    expect(reason).toMatch(/still work/);
  });

  it('accumulates token usage when the provider reports it', () => {
    const { g } = guard(10);
    g.record(DAY1, { promptTokens: 800, completionTokens: 200 });
    g.record(DAY1, { promptTokens: 500 });
    expect(g.snapshot()).toMatchObject({ calls: 2, promptTokens: 1300, completionTokens: 200 });
  });

  it('tolerates a provider that reports no usage', () => {
    const { g } = guard(10);
    g.record(DAY1);
    expect(g.snapshot().promptTokens).toBe(0);
  });

  it('rolls over at midnight', () => {
    const { g } = guard(1);
    g.record(DAY1_LATER);
    expect(g.check(DAY1_LATER).allowed).toBe(false);
    expect(g.check(DAY2).allowed).toBe(true);
    expect(g.snapshot().calls).toBe(0);
  });

  it('persists across a restart within the same day', () => {
    const { saved } = (() => {
      const first = guard(5);
      first.g.record(DAY1);
      first.g.record(DAY1);
      return first;
    })();

    const resumed = new SpendGuard(
      { dailyCallLimit: 5, store: { load: () => saved(), save: () => undefined } },
      DAY1_LATER
    );
    expect(resumed.remaining()).toBe(3);
  });

  it('ignores stored state from a previous day', () => {
    const stale: SpendState = { day: '2025-12-31', calls: 999, promptTokens: 0, completionTokens: 0 };
    const g = new SpendGuard(
      { dailyCallLimit: 5, store: { load: () => stale, save: () => undefined } },
      DAY1
    );
    expect(g.check(DAY1).allowed).toBe(true);
  });

  it('works with no store at all', () => {
    const g = new SpendGuard({ dailyCallLimit: 2 }, DAY1);
    g.record(DAY1);
    expect(g.remaining()).toBe(1);
  });

  it('derives the day from the timestamp', () => {
    expect(dayOf('2026-08-11T22:13:00.000Z')).toBe('2026-08-11');
  });
});
