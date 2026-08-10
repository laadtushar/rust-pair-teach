import { describe, expect, it } from 'vitest';

import { fixturePath } from './helpers.js';
import { fired, loadSession, replaySession } from './replay.js';

/**
 * Session replay — the layer that answers "does it fire at the *right moment*", which is the only
 * question about this product that unit tests cannot reach.
 *
 * Each judgement below was made by hand, once. From here on, any threshold change that breaks one
 * of them fails CI instead of being discovered by a learner. See docs/engineering-plan.md §3.2.
 */
describe('recorded sessions', () => {
  it('stays silent through a typo fixed in seconds', () => {
    const decisions = replaySession(loadSession(fixturePath('quick-typo.jsonl')));
    expect(fired(decisions)).toEqual([]);
  });

  it('speaks once when a learner is genuinely stuck on E0502, then lets them solve it', () => {
    const decisions = replaySession(loadSession(fixturePath('borrow-struggle.jsonl')));
    const fires = fired(decisions);

    expect(fires).toHaveLength(1);
    expect(fires[0]?.signature).toEqual({ kind: 'code', language: 'rust', value: 'E0502' });
    // First encounter, so it earns the priority boost rather than being a routine nudge.
    expect(fires[0]?.kind).toBe('novel_signature');
    // Not instantly, and not after they had already walked away.
    expect(fires[0]?.at).toBeGreaterThanOrEqual(22_000);
    expect(fires[0]?.at).toBeLessThan(60_000);
  });

  it('notices thrashing even when nothing is red', () => {
    const decisions = replaySession(loadSession(fixturePath('churn-rewrite.jsonl')));
    const fires = fired(decisions);

    expect(fires).toHaveLength(1);
    expect(fires[0]?.kind).toBe('churn');
  });

  it('nudges once across forty idle minutes, not once per tick', () => {
    const decisions = replaySession(loadSession(fixturePath('idle-lunch.jsonl')));
    expect(fired(decisions)).toHaveLength(1);
  });

  it('records suppressed candidates as well as fired ones', () => {
    // Silence through a real struggle is as much a bug as chirping, and only the suppression
    // record distinguishes "correctly quiet" from "asleep".
    const decisions = replaySession(loadSession(fixturePath('idle-lunch.jsonl')));
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => typeof d.reason === 'string' && d.reason.length > 0)).toBe(true);
  });
});

describe('threshold sensitivity', () => {
  it('replays the whole corpus fast enough to make retuning cheap', () => {
    // The point of the fake clock: 40 minutes of session in milliseconds of wall time.
    const started = performance.now();
    for (const name of ['quick-typo', 'borrow-struggle', 'churn-rewrite', 'idle-lunch']) {
      replaySession(loadSession(fixturePath(`${name}.jsonl`)));
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('shows exactly which judgements a threshold change would flip', () => {
    const session = loadSession(fixturePath('quick-typo.jsonl'));
    const asShipped = fired(replaySession(session));
    const impatient = fired(
      replaySession(session, { config: { diagnosticAgeMs: 1_000, idleThresholdMs: 500 } })
    );

    // A tutor tuned this aggressively would interrupt a four-second typo — which is precisely the
    // "noisy autocomplete" failure the research documents.
    expect(asShipped).toHaveLength(0);
    expect(impatient.length).toBeGreaterThan(0);
  });
});
