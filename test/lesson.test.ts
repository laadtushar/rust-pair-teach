import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { staticHint } from '../src/core/lesson/staticHint.js';
import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import type { ChapterPack, ConceptEntry } from '../src/core/pack/types.js';
import { signatureKey } from '../src/core/types.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-borrow-basics', import.meta.url));

let pack: ChapterPack;
let moves: ConceptEntry;

beforeAll(async () => {
  pack = await loadPackFromDisk(PACK_DIR);
  moves = indexBySignature(pack).get(
    signatureKey({ kind: 'code', language: 'rust', value: 'E0382' })
  )!;
});

describe('offline hints', () => {
  it('asks a question at level 1 and gives away nothing', () => {
    const hint = staticHint(moves, 1);
    expect(hint.text).toContain('?');
    expect(hint.text).not.toMatch(/```/);
  });

  it('rotates questions so a repeat encounter is not word-for-word identical', () => {
    const first = staticHint(moves, 1, { encounters: 0 }).text;
    const second = staticHint(moves, 1, { encounters: 1 }).text;
    expect(first).not.toBe(second);
  });

  it('offers the rustc explain command when the signature is a real error code', () => {
    const hint = staticHint(moves, 1, {
      signature: { kind: 'code', language: 'rust', value: 'E0382' },
    });
    expect(hint.explainCommand).toBe('rustc --explain E0382');
  });

  it('offers no explain command for a pattern signature', () => {
    const hint = staticHint(moves, 1, {
      signature: { kind: 'pattern', language: 'python', value: 'whatever' },
    });
    expect(hint.explainCommand).toBeUndefined();
  });

  it('escalates: level 3 says more than level 2, which says more than level 1', () => {
    const one = staticHint(moves, 1).text.length;
    const two = staticHint(moves, 2).text.length;
    const three = staticHint(moves, 3).text.length;
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });

  it('marks itself offline so the learner is never misled about what answered', () => {
    expect(staticHint(moves, 2).offline).toBe(true);
  });

  it('works for every concept in pack zero', () => {
    for (const concept of pack.concepts) {
      for (const level of [1, 2, 3] as const) {
        expect(staticHint(concept, level).text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The bright line, asserted against the content rather than against a guard.
 *
 * The ladder's runtime refusal checks went away with the ladder itself — a conversation has no
 * levels to police, and `limitCodeInReply` is what stands between a model and a copy-pasteable
 * answer now. What survives is the property those checks existed to protect, checked where it is
 * actually authored: the pack's opening questions must ask, and must not answer.
 */
describe('authored pack content keeps the promise', () => {
  it('opens every concept with a question', () => {
    for (const concept of pack.concepts) {
      for (const template of concept.socraticTemplates) {
        expect(template, template).toContain('?');
      }
    }
  });

  it('gives away no pasteable code in an opening question', () => {
    // A template that has learned not to use fences has not learned not to give the answer, so
    // both shapes are checked.
    const SOLUTION_SHAPED = [
      /```/,
      /\bfn\s+\w+\s*\([^)]*\)\s*(->[^{]+)?\{/,
      /\blet\s+\w+\s*(:[^=]+)?=\s*[^;]+;/,
    ];
    for (const concept of pack.concepts) {
      for (const template of concept.socraticTemplates) {
        for (const pattern of SOLUTION_SHAPED) {
          expect(pattern.test(template), `${template} matched ${String(pattern)}`).toBe(false);
        }
      }
    }
  });
});
