import { describe, expect, it } from 'vitest';

import { interpret, Telemetry, type TelemetrySnapshot } from '../src/core/telemetry.js';

const SINCE = '2026-01-01T00:00:00.000Z';

function enabled(): Telemetry {
  return new Telemetry(true, SINCE);
}

function withResolutions(solved: number, abandoned: number): TelemetrySnapshot {
  const t = enabled();
  for (let i = 0; i < solved; i++) t.resolved('self_level_1');
  for (let i = 0; i < abandoned; i++) t.resolved('abandoned');
  return t.snapshot();
}

describe('recording', () => {
  it('records nothing at all when disabled', () => {
    // Opt-in means opt-in: a disabled instrument is inert, not buffering for later.
    const t = new Telemetry(false, SINCE);
    t.momentFired();
    t.hintShown(1, 'rust/ownership.moves', true);
    t.resolved('unaided');

    const snap = t.snapshot();
    expect(snap.momentsFired).toBe(0);
    expect(snap.hintsShown[1]).toBe(0);
    expect(snap.resolutions).toEqual({});
  });

  it('counts hints by level and tracks which concepts got taught', () => {
    const t = enabled();
    t.hintShown(1, 'rust/ownership.moves', true);
    t.hintShown(2, 'rust/ownership.moves', false);

    const snap = t.snapshot();
    expect(snap.hintsShown).toEqual({ 1: 1, 2: 1, 3: 0 });
    expect(snap.hintsOffline).toBe(1);
    expect(snap.conceptsTaught['rust/ownership.moves']).toBe(2);
  });

  it('counts suppressions by reason, which is how silence gets measured', () => {
    const t = enabled();
    t.momentSuppressed('global_cooldown');
    t.momentSuppressed('global_cooldown');
    t.momentSuppressed('graduated' as never);
    expect(t.snapshot().momentsSuppressed['global_cooldown']).toBe(2);
  });

  it('hands back a copy, so a caller cannot mutate the record', () => {
    const t = enabled();
    t.momentFired();
    const snap = t.snapshot();
    snap.momentsFired = 999;
    expect(t.snapshot().momentsFired).toBe(1);
  });

  it('carries no file paths or code — only counts, concepts and codes', () => {
    const t = enabled();
    t.hintShown(1, 'rust/ownership.moves', true);
    t.momentFired();
    const json = JSON.stringify(t.snapshot());
    expect(json).not.toMatch(/file:\/\//);
    expect(json).not.toMatch(/\.rs\b/);
  });

  it('resets without losing the opt-in state', () => {
    const t = enabled();
    t.momentFired();
    t.reset('2026-02-01T00:00:00.000Z');
    expect(t.enabled).toBe(true);
    expect(t.snapshot().momentsFired).toBe(0);
    expect(t.snapshot().since).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('reading the instrument', () => {
  it('refuses to answer on a small sample', () => {
    // Guarding against the failure this project's own research warns about: a pivot decided on
    // nine data points.
    const reading = interpret(withResolutions(5, 4));
    expect(reading.ambient.verdict).toBe('insufficient_data');
    expect(reading.notes.join(' ')).toMatch(/need 20/);
  });

  it('calls it helpful when most lessons get resolved rather than dismissed', () => {
    expect(interpret(withResolutions(20, 3)).ambient.verdict).toBe('helpful');
  });

  it('calls it noisy when most lessons get dismissed', () => {
    expect(interpret(withResolutions(8, 17)).ambient.verdict).toBe('noisy');
  });

  it('treats switching ambient off as decisive, whatever the sample size', () => {
    const t = enabled();
    for (let i = 0; i < 30; i++) t.resolved('self_level_1');
    t.ambientToggled(false);

    const reading = interpret(t.snapshot());
    expect(reading.ambient.verdict).toBe('noisy');
    expect(reading.notes.join(' ')).toMatch(/switched off/);
  });

  it('flags when teaching is mostly requested rather than offered', () => {
    const t = enabled();
    t.momentFired();
    for (let i = 0; i < 9; i++) t.onDemand();
    expect(interpret(t.snapshot()).notes.join(' ')).toMatch(/on-demand-only pivot/);
  });

  it('surfaces refused model answers, which are a model-quality signal', () => {
    const t = enabled();
    t.hintRefused();
    t.hintRefused();
    expect(interpret(t.snapshot()).notes.join(' ')).toMatch(/2 model response\(s\) were refused/);
  });

  it('reports null rather than zero when nothing has happened yet', () => {
    const reading = interpret(enabled().snapshot());
    expect(reading.ambient.dismissRate).toBeNull();
    expect(reading.deliberateUse.onDemandShare).toBeNull();
    expect(reading.conversation.repliesPerNudge).toBeNull();
  });
});

describe('the conversation counters (A5)', () => {
  it('counts learner turns and unprompted remarks by reason', () => {
    const t = enabled();
    t.chatEvent({ kind: 'learner_message' });
    t.chatEvent({ kind: 'learner_message' });
    t.chatEvent({ kind: 'proactive', reason: 'new_error' });
    t.chatEvent({ kind: 'proactive', reason: 'new_error' });
    t.chatEvent({ kind: 'proactive', reason: 'session_start' });

    const snap = t.snapshot();
    expect(snap.chatMessagesSent).toBe(2);
    expect(snap.proactiveNudges).toEqual({ new_error: 2, session_start: 1 });
  });

  it('counts a redacted reply as a refusal, not as a separate statistic', () => {
    // It is the same event the ladder called hintRefused — a model stopped from giving the answer.
    const t = enabled();
    t.chatEvent({ kind: 'redacted' });
    expect(t.snapshot().hintsRefused).toBe(1);
  });

  it('records the provider failure kind, never its message', () => {
    const t = enabled();
    t.chatEvent({ kind: 'provider_error', error: 'auth' });
    t.chatEvent({ kind: 'provider_error', error: 'timeout' });
    t.chatEvent({ kind: 'provider_error', error: 'timeout' });
    expect(t.snapshot().providerErrors).toEqual({ auth: 1, timeout: 2 });
    expect(interpret(t.snapshot()).notes.join(' ')).toMatch(/timeout ×2/);
  });

  it('stays inert when telemetry is off', () => {
    const t = new Telemetry(false, SINCE);
    t.chatEvent({ kind: 'learner_message' });
    t.chatEvent({ kind: 'cancelled' });
    expect(t.snapshot().chatMessagesSent).toBe(0);
    expect(t.snapshot().chatCancelled).toBe(0);
  });

  it('calls out a tutor that is monologuing', () => {
    const t = enabled();
    for (let i = 0; i < 12; i++) t.chatEvent({ kind: 'proactive', reason: 'step_completed' });
    t.chatEvent({ kind: 'learner_message' });

    const reading = interpret(t.snapshot());
    expect(reading.conversation.verdict).toBe('noisy');
    expect(reading.notes.join(' ')).toMatch(/monologuing/);
  });

  it('is satisfied when the learner talks back', () => {
    const t = enabled();
    for (let i = 0; i < 12; i++) t.chatEvent({ kind: 'proactive', reason: 'step_completed' });
    for (let i = 0; i < 8; i++) t.chatEvent({ kind: 'learner_message' });
    expect(interpret(t.snapshot()).conversation.verdict).toBe('helpful');
  });

  it('refuses to read a conversation that has barely started', () => {
    const t = enabled();
    t.chatEvent({ kind: 'proactive', reason: 'session_start' });
    const reading = interpret(t.snapshot());
    expect(reading.conversation.verdict).toBe('insufficient_data');
    expect(reading.notes.join(' ')).toMatch(/need 10 to read the conversation/);
  });
});
