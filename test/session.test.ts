import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { newModel, recordEpisode, teachingPosture } from '../src/core/learner/model.js';
import type { LearnerModel, Resolution } from '../src/core/learner/types.js';
import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import type { ConceptEntry } from '../src/core/pack/types.js';
import { TutorSession } from '../src/core/session.js';
import type { DiagnosticSignature } from '../src/core/types.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-borrow-basics', import.meta.url));
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;
const CONCEPT = 'rust/borrows.conflicting';

const E0502: DiagnosticSignature = { kind: 'code', language: 'rust', value: 'E0502' };
const UNKNOWN: DiagnosticSignature = { kind: 'code', language: 'rust', value: 'E9999' };

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

describe('mapping an error to a concept', () => {
  it('finds the concept that teaches a known signature', () => {
    const { s } = session();
    expect(s.conceptFor(E0502)?.id).toBe(CONCEPT);
  });

  it('finds nothing for an error no pack teaches', () => {
    // Silence is correct here — improvising for an unmapped code is how grounding is lost.
    const { s } = session();
    expect(s.conceptFor(UNKNOWN)).toBeUndefined();
  });
});

describe('fading decides when the tutor speaks first', () => {
  it('speaks unprompted to a struggling learner', () => {
    const { s } = session();
    expect(s.shouldSpeakUnprompted(E0502, T0)).toBe(true);
  });

  it('goes quiet on a mastered concept', () => {
    const mastered = withScore(Array<Resolution>(8).fill('unaided'));
    expect(teachingPosture(mastered.concepts[concept.id]!.score).graduated).toBe(true);

    const { s } = session(mastered);
    expect(s.shouldSpeakUnprompted(E0502, T0 + 5 * DAY)).toBe(false);
  });

  it('speaks again once mastery has decayed', () => {
    const mastered = withScore(Array<Resolution>(8).fill('unaided'));
    const { s } = session(mastered);
    // Same learner, same concept, six months later.
    expect(s.shouldSpeakUnprompted(E0502, T0 + 180 * DAY)).toBe(true);
  });

  it('never speaks unprompted about an error no pack teaches', () => {
    const { s } = session();
    expect(s.shouldSpeakUnprompted(UNKNOWN, T0)).toBe(false);
  });
});

describe('offline teaching', () => {
  it('draws a question, not an answer, from the pack', () => {
    const { s } = session();
    const out = s.offlineTeaching(E0502, T0);
    expect(out?.concept.id).toBe(CONCEPT);
    expect(out?.text).toContain('?');
  });

  it('starts a nearly-there learner further up the ladder', () => {
    const nearly = withScore(['self_level_1', 'unaided', 'unaided']);
    const score = nearly.concepts[concept.id]!.score;
    expect(score).toBeGreaterThanOrEqual(0.75);
    expect(score).toBeLessThan(0.9);

    const beginner = session().s.offlineTeaching(E0502, T0)!;
    const advanced = session(nearly).s.offlineTeaching(E0502, T0 + 3 * DAY)!;
    expect(advanced.text).not.toBe(beginner.text);
  });

  it('points at the compiler explanation when the pack names one', () => {
    const { s } = session();
    expect(s.offlineTeaching(E0502, T0)?.text).toContain('rustc --explain E0502');
  });

  it('has nothing to say about an unmapped error', () => {
    const { s } = session();
    expect(s.offlineTeaching(UNKNOWN, T0)).toBeNull();
  });
});

describe('resolution feeds the model', () => {
  it('grades a silently-cleared error as unaided — the signal a struggle-only tutor misses', () => {
    const { s, saved } = session();
    expect(s.noteResolved(E0502, 'silent', T0, T0 + 40_000)).toBe('unaided');

    const episode = saved().episodes[0]!;
    expect(episode.resolution).toBe('unaided');
    expect(episode.hintLevelReached).toBe(0);
    expect(saved().concepts[CONCEPT]!.score).toBeGreaterThan(0.3);
  });

  it('credits a fix after a conversation, but less', () => {
    const alone = session();
    alone.s.noteResolved(E0502, 'silent', T0, T0 + 60_000);

    const helped = session();
    helped.s.noteResolved(E0502, 'discussed', T0, T0 + 60_000);

    expect(helped.saved().episodes[0]!.resolution).toBe('self_level_2');
    expect(alone.saved().concepts[CONCEPT]!.score).toBeGreaterThan(
      helped.saved().concepts[CONCEPT]!.score
    );
  });

  it('counts the tutor as involved once it has spoken, whoever reports the clear', () => {
    const { s, saved } = session();
    s.noteDiscussed(E0502, T0);
    // The detector saw no teaching, but the session knows better.
    expect(s.noteResolved(E0502, 'silent', T0, T0 + 10_000)).toBe('self_level_2');
    expect(saved().episodes[0]!.hintLevelReached).toBe(2);
  });

  it('records how long the struggle lasted', () => {
    const { s, saved } = session();
    s.noteResolved(E0502, 'silent', T0, T0 + 245_000);
    expect(saved().episodes[0]!.durationSec).toBe(245);
  });

  it('ignores a resolution for a concept no pack teaches', () => {
    const { s, saved } = session();
    expect(s.noteResolved(UNKNOWN, 'silent', T0, T0 + 1_000)).toBeNull();
    expect(saved().episodes).toEqual([]);
  });
});

describe('giving up is also information', () => {
  it('records an abandoned episode for a concept still open at the end', () => {
    const { s, saved } = session();
    s.noteDiscussed(E0502, T0);
    s.noteAbandoned(T0 + 30_000);

    const state = saved().concepts[CONCEPT]!;
    expect(state.unresolvedStreak).toBe(1);
    expect(saved().episodes[0]!.resolution).toBe('abandoned');
    expect(saved().episodes[0]!.durationSec).toBe(30);
  });

  it('does not double-count a concept that was already resolved', () => {
    const { s, saved } = session();
    s.noteDiscussed(E0502, T0);
    s.noteResolved(E0502, 'discussed', T0, T0 + 10_000);
    s.noteAbandoned(T0 + 30_000);
    expect(saved().episodes).toHaveLength(1);
  });

  it('says nothing when the tutor never engaged', () => {
    const { s, saved } = session();
    s.noteAbandoned(T0);
    expect(saved().episodes).toEqual([]);
  });
});

describe('learner summary reaches the prompt', () => {
  it('carries prior struggle into the next conversation', () => {
    const struggled = withScore(['abandoned', 'abandoned']);
    const { s } = session(struggled);
    expect(s.summaryFor(E0502, T0 + 2 * DAY)).toBeTruthy();
    expect(s.model.concepts[CONCEPT]!.unresolvedStreak).toBe(2);
  });

  it('has no summary for an unmapped error', () => {
    const { s } = session();
    expect(s.summaryFor(UNKNOWN, T0)).toBeUndefined();
  });
});
