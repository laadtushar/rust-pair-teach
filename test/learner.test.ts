import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  currentScore,
  decayScore,
  newModel,
  recordEpisode,
  reviewCandidates,
  summarize,
  teachingPosture,
  warmUpCandidates,
} from '../src/core/learner/model.js';
import { LearnerStore } from '../src/core/learner/store.js';
import type { LearnerModel, Resolution } from '../src/core/learner/types.js';

const CONCEPT = 'rust/borrows.conflicting';
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

function episode(resolution: Resolution, hintLevelReached: 0 | 1 | 2 | 3 = 1) {
  return {
    concept: CONCEPT,
    signatures: ['rust/code:E0502'],
    hintLevelReached,
    resolution,
    durationSec: 120,
  };
}

function after(model: LearnerModel, resolutions: Resolution[], startDay = 0): LearnerModel {
  return resolutions.reduce(
    (m, r, i) => recordEpisode(m, episode(r), T0 + (startDay + i) * DAY),
    model
  );
}

describe('score movement', () => {
  it('rises when the learner solves it alone and falls when they abandon', () => {
    const base = newModel(T0);
    const solved = after(base, ['unaided', 'unaided', 'unaided']);
    const struggled = after(base, ['abandoned', 'abandoned', 'abandoned']);

    expect(solved.concepts[CONCEPT]!.score).toBeGreaterThan(0.7);
    expect(struggled.concepts[CONCEPT]!.score).toBeLessThan(0.2);
  });

  it('rewards solving at level 1 more than needing the worked example', () => {
    const early = after(newModel(T0), ['self_level_1', 'self_level_1']);
    const late = after(newModel(T0), ['self_level_3', 'self_level_3']);
    expect(early.concepts[CONCEPT]!.score).toBeGreaterThan(late.concepts[CONCEPT]!.score);
  });

  it('tracks an unresolved streak and clears it on any real resolution', () => {
    const stuck = after(newModel(T0), ['abandoned', 'abandoned']);
    expect(stuck.concepts[CONCEPT]!.unresolvedStreak).toBe(2);

    const recovered = after(stuck, ['self_level_2'], 5);
    expect(recovered.concepts[CONCEPT]!.unresolvedStreak).toBe(0);
  });

  it('counts every encounter, resolved or not', () => {
    const m = after(newModel(T0), ['abandoned', 'unaided', 'self_level_3']);
    expect(m.concepts[CONCEPT]!.encounters).toBe(3);
  });
});

describe('decay over calendar time', () => {
  it('halves a score over the half-life', () => {
    expect(decayScore(0.8, 60)).toBeCloseTo(0.4, 2);
    expect(decayScore(0.8, 120)).toBeCloseTo(0.2, 2);
  });

  it('leaves a score untouched on the same day', () => {
    expect(decayScore(0.8, 0)).toBe(0.8);
  });

  it('erodes mastery when a concept goes unseen for months', () => {
    const mastered = after(newModel(T0), ['unaided', 'unaided', 'unaided', 'unaided']);
    const stored = mastered.concepts[CONCEPT]!.score;
    expect(currentScore(mastered, CONCEPT, T0 + 90 * DAY)).toBeLessThan(stored);
  });

  it('measures new learning against the eroded score, not a stale peak', () => {
    // A learner returning after three months should not get credit for what time has taken away.
    const mastered = after(newModel(T0), ['unaided', 'unaided', 'unaided', 'unaided']);
    const returnedAndStruggled = recordEpisode(
      mastered,
      episode('abandoned'),
      T0 + 120 * DAY
    );
    expect(returnedAndStruggled.concepts[CONCEPT]!.score).toBeLessThan(0.2);
  });
});

describe('scaffold fading', () => {
  it('starts a struggling learner at level 1 with ambient on', () => {
    expect(teachingPosture(0.2)).toEqual({ ambient: true, startLevel: 1, graduated: false });
  });

  it('starts the ladder higher once the concept is nearly there', () => {
    expect(teachingPosture(0.8)).toMatchObject({ ambient: true, startLevel: 2 });
  });

  it('goes silent on a mastered concept', () => {
    // The teacher's goal is its own obsolescence.
    expect(teachingPosture(0.95)).toEqual({ ambient: false, startLevel: 2, graduated: true });
  });

  it('fades across a simulated learning arc rather than flipping', () => {
    let model = newModel(T0);
    const postures: number[] = [];
    for (let i = 0; i < 10; i++) {
      model = recordEpisode(model, episode('unaided'), T0 + i * DAY);
      postures.push(teachingPosture(model.concepts[CONCEPT]!.score).startLevel);
    }
    expect(postures[0]).toBe(1);
    expect(postures.at(-1)).toBe(2);
    // Monotone: the teacher never gets louder as mastery grows.
    expect(postures).toEqual([...postures].sort((a, b) => a - b));
  });
});

describe('proactive surfacing', () => {
  it('offers a warm-up after three unresolved encounters in a row', () => {
    const stuck = after(newModel(T0), ['abandoned', 'abandoned']);
    expect(warmUpCandidates(stuck, T0)).toEqual([]);

    const stuckMore = after(stuck, ['abandoned'], 3);
    expect(warmUpCandidates(stuckMore, T0 + 3 * DAY)).toContain(CONCEPT);
  });

  it('resurfaces a mastered concept for review only once it has decayed', () => {
    const mastered = after(newModel(T0), ['unaided', 'unaided', 'unaided', 'unaided']);
    expect(reviewCandidates(mastered, T0)).toEqual([]);
    expect(reviewCandidates(mastered, T0 + 120 * DAY)).toContain(CONCEPT);
  });

  it('never resurfaces something that was never learned', () => {
    // Reviewing what you never knew is teaching, and belongs on a different path.
    const never = after(newModel(T0), ['abandoned', 'abandoned']);
    expect(reviewCandidates(never, T0 + 365 * DAY)).toEqual([]);
  });
});

describe('prompt summary', () => {
  it('says something useful on a first encounter', () => {
    expect(summarize(newModel(T0), CONCEPT, T0)).toMatch(/first time/i);
  });

  it('stays short and mentions the streak when there is one', () => {
    const stuck = after(newModel(T0), ['abandoned', 'abandoned']);
    const text = summarize(stuck, CONCEPT, T0 + 2 * DAY);
    expect(text).toMatch(/2 unresolved in a row/);
    expect(text.length).toBeLessThan(160);
  });

  it('leaks no episode history into the prompt', () => {
    const m = after(newModel(T0), ['unaided', 'abandoned', 'self_level_2']);
    const text = summarize(m, CONCEPT, T0 + 3 * DAY);
    expect(text).not.toContain('E0502');
    expect(text).not.toContain('durationSec');
  });
});

describe('episode capping', () => {
  it('summarizes what rolls off instead of losing it', () => {
    let model = newModel(T0);
    for (let i = 0; i < 520; i++) {
      model = recordEpisode(model, episode('unaided'), T0 + i * 3_600_000);
    }
    expect(model.episodes.length).toBe(500);
    expect(model.rollup[CONCEPT]!.episodes).toBe(20);
    expect(model.rollup[CONCEPT]!.unaided).toBe(20);
    // Total encounters survive the cap, which is what the summary reports.
    expect(model.concepts[CONCEPT]!.encounters).toBe(520);
  });
});

describe('LearnerStore', () => {
  it('round-trips a model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-'));
    const store = new LearnerStore(dir);
    const model = after(newModel(T0), ['unaided', 'self_level_2']);

    await store.save(model);
    const loaded = await store.load(T0);
    expect(loaded.concepts[CONCEPT]!.score).toBeCloseTo(model.concepts[CONCEPT]!.score, 10);
  });

  it('returns a fresh model when nothing is stored yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-'));
    expect((await new LearnerStore(dir).load(T0)).episodes).toEqual([]);
  });

  it('preserves a corrupt file for forensics rather than overwriting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-'));
    const store = new LearnerStore(dir);
    await writeFile(join(dir, 'learner-model.json'), '{ not json', 'utf8');

    const loaded = await store.load(T0);
    expect(loaded.episodes).toEqual([]);
    expect(await readFile(join(dir, `learner-model.json.corrupt-${String(T0)}`), 'utf8')).toBe(
      '{ not json'
    );
  });

  it('refuses a model written by a newer extension rather than resetting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-'));
    const store = new LearnerStore(dir);
    await writeFile(join(dir, 'learner-model.json'), JSON.stringify({ version: 99 }), 'utf8');
    await expect(store.load(T0)).rejects.toThrow(/newer than this extension supports/);
  });

  it('leaves no partial file behind, because writes go through a rename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-'));
    const store = new LearnerStore(dir);
    await store.save(newModel(T0));
    await expect(readFile(join(dir, 'learner-model.json.tmp'), 'utf8')).rejects.toThrow();
  });
});
