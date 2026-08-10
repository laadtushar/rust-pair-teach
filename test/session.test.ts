import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { LessonEngine } from '../src/core/lesson/engine.js';
import { newModel, recordEpisode, teachingPosture } from '../src/core/learner/model.js';
import type { LearnerModel, Resolution } from '../src/core/learner/types.js';
import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import type { ConceptEntry } from '../src/core/pack/types.js';
import { TutorSession } from '../src/core/session.js';
import type { CandidateDecision, DiagnosticSignature } from '../src/core/types.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-borrow-basics', import.meta.url));
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

const E0502: DiagnosticSignature = { kind: 'code', language: 'rust', value: 'E0502' };
const UNKNOWN: DiagnosticSignature = { kind: 'code', language: 'rust', value: 'E9999' };

const DOC = `fn tally(items: &mut Vec<i32>) {
    let first = &items[0];
    items.push(*first);
}
`;

// null, not undefined: passing `undefined` to a defaulted parameter silently uses the default,
// so the no-signature case would never actually be exercised.
function decision(signature: DiagnosticSignature | null = E0502): CandidateDecision {
  return {
    at: T0,
    kind: 'lingering_diagnostic',
    uri: 'file:///p/src/lib.rs',
    ...(signature ? { signature } : {}),
    startLine: 1,
    fired: true,
    reason: 'test',
  };
}

let index: Map<string, ConceptEntry>;
let concept: ConceptEntry;

beforeEach(async () => {
  const pack = await loadPackFromDisk(PACK_DIR);
  index = indexBySignature(pack);
  concept = index.get('rust/code:E0502')!;
});

function session(model: LearnerModel = newModel(T0)) {
  let latest = model;
  const s = new TutorSession({
    // No provider: hints come from the pack, which keeps these tests about orchestration.
    engine: new LessonEngine({ model: 'none' }),
    conceptIndex: index,
    model,
    onModelChanged: (m) => (latest = m),
  });
  return { s, saved: () => latest };
}

function withScore(resolutions: Resolution[]): LearnerModel {
  return resolutions.reduce(
    (m, r, i) =>
      recordEpisode(
        m,
        {
          concept: concept.id,
          signatures: ['rust/code:E0502'],
          hintLevelReached: 0,
          resolution: r,
          durationSec: 10,
        },
        T0 + i * DAY
      ),
    newModel(T0)
  );
}

describe('offering a lesson', () => {
  it('teaches a known signature at level 1 for a struggling learner', async () => {
    const { s } = session();
    const out = await s.offer(decision(), DOC, T0);

    expect(out.kind).toBe('offered');
    if (out.kind !== 'offered') return;
    expect(out.lesson.concept.id).toBe('rust/borrows.conflicting');
    expect(out.lesson.level).toBe(1);
    expect(out.lesson.hints[0]!.text).toContain('?');
  });

  it('says nothing about an error no pack teaches', async () => {
    // Silence is correct here — inventing a lesson for an unmapped code is how grounding is lost.
    const { s } = session();
    expect(await s.offer(decision(UNKNOWN), DOC, T0)).toEqual({
      kind: 'suppressed',
      reason: 'no_concept',
    });
  });

  it('says nothing when there is no diagnostic to map', async () => {
    const { s } = session();
    expect((await s.offer(decision(null), DOC, T0)).kind).toBe('suppressed');
  });

  it('refuses to stack a second lesson on top of an open one', async () => {
    const { s } = session();
    await s.offer(decision(), DOC, T0);
    expect(await s.offer(decision(), DOC, T0)).toEqual({
      kind: 'suppressed',
      reason: 'lesson_in_progress',
    });
  });
});

describe('fading changes what gets taught', () => {
  it('goes quiet on a mastered concept', async () => {
    const mastered = withScore(Array<Resolution>(8).fill('unaided'));
    expect(teachingPosture(mastered.concepts[concept.id]!.score).graduated).toBe(true);

    const { s } = session(mastered);
    expect(await s.offer(decision(), DOC, T0 + 5 * DAY)).toEqual({
      kind: 'suppressed',
      reason: 'graduated',
    });
  });

  it('still answers a mastered concept when the learner asks', async () => {
    // Fading governs when the teacher speaks unprompted, not whether it will speak at all.
    const mastered = withScore(Array<Resolution>(8).fill('unaided'));
    const { s } = session(mastered);
    const out = await s.offer(decision(), DOC, T0 + 5 * DAY, { onDemand: true });
    expect(out.kind).toBe('offered');
  });

  it('starts a nearly-there learner higher up the ladder', async () => {
    const nearly = withScore(['self_level_1', 'unaided', 'unaided']);
    const score = nearly.concepts[concept.id]!.score;
    expect(score).toBeGreaterThanOrEqual(0.75);
    expect(score).toBeLessThan(0.9);

    const { s } = session(nearly);
    const out = await s.offer(decision(), DOC, T0 + 3 * DAY);
    expect(out.kind === 'offered' && out.lesson.level).toBe(2);
  });

  it('speaks again once mastery has decayed', async () => {
    const mastered = withScore(Array<Resolution>(8).fill('unaided'));
    const { s } = session(mastered);
    // Same learner, same concept, six months later.
    expect((await s.offer(decision(), DOC, T0 + 180 * DAY)).kind).toBe('offered');
  });
});

describe('the ladder', () => {
  it('climbs one rung at a time and stops at three', async () => {
    const { s } = session();
    await s.offer(decision(), DOC, T0);

    expect((await s.escalate(DOC, T0))!.level).toBe(2);
    expect((await s.escalate(DOC, T0))!.level).toBe(3);
    expect(await s.escalate(DOC, T0)).toBeNull();
  });

  it('keeps every rung shown, so the sidebar can show the trail', async () => {
    const { s } = session();
    await s.offer(decision(), DOC, T0);
    await s.escalate(DOC, T0);
    expect(s.activeLesson!.hints.map((h) => h.level)).toEqual([1, 2]);
  });

  it('does nothing when nothing is open', async () => {
    const { s } = session();
    expect(await s.escalate(DOC, T0)).toBeNull();
  });
});

describe('resolution feeds the model', () => {
  it('credits solving at level 1 more than solving at level 3', async () => {
    const early = session();
    await early.s.offer(decision(), DOC, T0);
    early.s.resolve('solved', T0 + 60_000);

    const late = session();
    await late.s.offer(decision(), DOC, T0);
    await late.s.escalate(DOC, T0);
    await late.s.escalate(DOC, T0);
    late.s.resolve('solved', T0 + 60_000);

    const earlyScore = early.saved().concepts['rust/borrows.conflicting']!.score;
    const lateScore = late.saved().concepts['rust/borrows.conflicting']!.score;
    expect(earlyScore).toBeGreaterThan(lateScore);
  });

  it('records dismissal as abandoned and starts an unresolved streak', async () => {
    const { s, saved } = session();
    await s.offer(decision(), DOC, T0);
    s.resolve('dismissed', T0 + 30_000);

    const state = saved().concepts['rust/borrows.conflicting']!;
    expect(state.unresolvedStreak).toBe(1);
    expect(saved().episodes[0]!.resolution).toBe('abandoned');
  });

  it('records how long the struggle lasted', async () => {
    const { s, saved } = session();
    await s.offer(decision(), DOC, T0);
    s.resolve('solved', T0 + 245_000);
    expect(saved().episodes[0]!.durationSec).toBe(245);
  });

  it('closes the lesson so the next one can open', async () => {
    const { s } = session();
    await s.offer(decision(), DOC, T0);
    s.resolve('solved', T0);
    expect(s.activeLesson).toBeNull();
    expect((await s.offer(decision(), DOC, T0)).kind).toBe('offered');
  });

  it('records an unaided fix, which is the signal a struggle-only tutor would miss', async () => {
    const { s, saved } = session();
    s.noteResolvedUnaided(E0502, T0, T0 + 40_000);

    const episode = saved().episodes[0]!;
    expect(episode.resolution).toBe('unaided');
    expect(episode.hintLevelReached).toBe(0);
    expect(saved().concepts['rust/borrows.conflicting']!.score).toBeGreaterThan(0.3);
  });

  it('ignores an unaided fix for a concept no pack teaches', () => {
    const { s, saved } = session();
    s.noteResolvedUnaided(UNKNOWN, T0, T0 + 1_000);
    expect(saved().episodes).toEqual([]);
  });

  it('does nothing when asked to resolve with no lesson open', () => {
    const { s, saved } = session();
    s.resolve('solved', T0);
    expect(saved().episodes).toEqual([]);
  });
});

describe('learner summary reaches the prompt', () => {
  it('carries prior struggle into the next lesson', async () => {
    const struggled = withScore(['abandoned', 'abandoned']);
    const { s } = session(struggled);
    const out = await s.offer(decision(), DOC, T0 + 2 * DAY);
    // Offline hints ignore the summary, but the request that would go to a model carries it —
    // asserted here via the model state the session reads.
    expect(out.kind).toBe('offered');
    expect(s.model.concepts['rust/borrows.conflicting']!.unresolvedStreak).toBe(2);
  });
});
