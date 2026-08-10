import { describe, expect, it } from 'vitest';

import type { Hint } from '../src/core/lesson/staticHint.js';
import type { ConceptEntry } from '../src/core/pack/types.js';
import type { ActiveLesson } from '../src/core/session.js';
import { lessonView } from '../src/core/viewModel.js';

const CONCEPT = {
  id: 'rust/borrows.conflicting',
  title: 'Shared and mutable borrows',
  signatures: [],
  mentalModel: 'x',
  socraticTemplates: ['q?'],
  checkForUnderstanding: 'y',
} as unknown as ConceptEntry;

function hint(level: 1 | 2 | 3, offline = true, explainCommand?: string): Hint {
  return {
    level,
    conceptId: CONCEPT.id,
    text: `hint ${String(level)}`,
    offline,
    ...(explainCommand ? { explainCommand } : {}),
  };
}

function lesson(hints: Hint[]): ActiveLesson {
  return {
    concept: CONCEPT,
    uri: 'file:///a.rs',
    startLine: 1,
    level: hints[hints.length - 1]!.level,
    hints,
    startedAt: 0,
  };
}

describe('lessonView', () => {
  it('offers another nudge at level 1', () => {
    expect(lessonView(lesson([hint(1)])).nextStep).toBe('Another nudge');
  });

  it('offers the worked example at level 2', () => {
    expect(lessonView(lesson([hint(1), hint(2)])).nextStep).toBe('Show me a worked example');
  });

  it('offers nothing beyond level 3 — the ladder ends', () => {
    expect(lessonView(lesson([hint(1), hint(2), hint(3)])).nextStep).toBeNull();
  });

  it('keeps the whole trail, not just the newest rung', () => {
    // The learner should be able to re-read the question they were asked before the explanation.
    const view = lessonView(lesson([hint(1), hint(2)]));
    expect(view.hints.map((h) => h.level)).toEqual([1, 2]);
  });

  it('says when the teaching came from the pack rather than a model', () => {
    expect(lessonView(lesson([hint(1, true)])).offlineNotice).toMatch(/built-in material/);
  });

  it('stays quiet about provenance when a model answered', () => {
    expect(lessonView(lesson([hint(1, false)])).offlineNotice).toBeNull();
  });

  it('surfaces the explain command from the most recent rung', () => {
    const view = lessonView(lesson([hint(1, true), hint(2, true, 'rustc --explain E0502')]));
    expect(view.explainCommand).toBe('rustc --explain E0502');
  });

  it('reports the concept title the learner is being taught', () => {
    expect(lessonView(lesson([hint(1)])).conceptTitle).toBe('Shared and mutable borrows');
  });
});
