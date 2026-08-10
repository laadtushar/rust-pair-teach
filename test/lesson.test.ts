import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { checkHintRespectsLadder, checkLevelOneAsks } from '../src/core/lesson/refusal.js';
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
    expect(checkHintRespectsLadder(hint.text, 1).ok).toBe(true);
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

describe('ladder refusal invariants', () => {
  it('rejects a fenced code block at level 1 and 2', () => {
    const leaked = 'Try this:\n```rust\nlet b = a.clone();\n```';
    expect(checkHintRespectsLadder(leaked, 1).ok).toBe(false);
    expect(checkHintRespectsLadder(leaked, 2).ok).toBe(false);
  });

  it('rejects unfenced solution-shaped code too', () => {
    // A model that has learned not to use fences has not learned not to give the answer.
    expect(checkHintRespectsLadder('You want fn fixed(v: &Vec<i32>) -> i32 { 0 }', 2).ok).toBe(
      false
    );
    expect(checkHintRespectsLadder('Write let first = items[0].clone(); instead', 1).ok).toBe(
      false
    );
  });

  it('permits code at level 3, which is the worked example', () => {
    const worked = 'Here is one way:\n```rust\nlet b = a.clone();\n```';
    expect(checkHintRespectsLadder(worked, 3).ok).toBe(true);
  });

  it('explains why it refused, so the failure is debuggable', () => {
    const verdict = checkHintRespectsLadder('```rust\nfoo\n```', 1);
    expect(verdict.reason).toMatch(/fenced code block/);
  });

  it('requires level 1 to actually ask something', () => {
    expect(checkLevelOneAsks('The value moved into the function.').ok).toBe(false);
    expect(checkLevelOneAsks('Where did the value go?').ok).toBe(true);
  });

  it('passes every authored level-1 template in pack zero', () => {
    // The pack is reviewed content, but the guard should still agree with it — if it does not, one
    // of the two is wrong and it is worth knowing which.
    for (const concept of pack.concepts) {
      for (const template of concept.socraticTemplates) {
        expect(checkLevelOneAsks(template).ok, template).toBe(true);
        expect(checkHintRespectsLadder(template, 1).ok, template).toBe(true);
      }
    }
  });
});
