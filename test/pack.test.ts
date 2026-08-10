import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import { parsePack } from '../src/core/pack/loader.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import { PackValidationError } from '../src/core/pack/types.js';
import { signatureKey } from '../src/core/types.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-borrow-basics', import.meta.url));

const VALID_CHAPTER = `
id = "test-pack"
language = "rust"
version = "0.1.0"
schemaVersion = 1
title = "Test"
prerequisites = []
`;

const VALID_CONCEPT = `+++
id = "ownership.moves"
title = "Moves"
codes = ["E0382"]
socraticTemplates = ["What happened to the original binding?"]
checkForUnderstanding = "You can name the owner on each line."
+++

The mental model goes here.
`;

function pack(chapter = VALID_CHAPTER, concept = VALID_CONCEPT) {
  return parsePack({ chapter, concepts: [{ name: 'c.md', content: concept }] });
}

describe('pack zero on disk', () => {
  it('loads and covers all seven core borrow-checker codes', async () => {
    const loaded = await loadPackFromDisk(PACK_DIR);
    const covered = new Set(
      loaded.concepts.flatMap((c) => c.signatures.map((s) => s.value))
    );
    for (const code of ['E0382', 'E0499', 'E0502', 'E0505', 'E0515', 'E0597', 'E0716']) {
      expect(covered, `missing ${code}`).toContain(code);
    }
  });

  it('namespaces concept ids by language', async () => {
    const loaded = await loadPackFromDisk(PACK_DIR);
    expect(loaded.concepts.map((c) => c.id)).toContain('rust/ownership.moves');
    expect(loaded.concepts.every((c) => c.id.startsWith('rust/'))).toBe(true);
  });

  it('indexes every signature to exactly one concept', async () => {
    const loaded = await loadPackFromDisk(PACK_DIR);
    const index = indexBySignature(loaded);
    expect(index.get(signatureKey({ kind: 'code', language: 'rust', value: 'E0502' }))?.id).toBe(
      'rust/borrows.conflicting'
    );
  });
});

describe('pack validation', () => {
  it('accepts a minimal valid pack', () => {
    expect(pack().concepts).toHaveLength(1);
  });

  it('rejects a schemaVersion newer than this extension understands', () => {
    // Loading half a lesson is worse than refusing it — schema drift must be loud.
    const chapter = VALID_CHAPTER.replace('schemaVersion = 1', 'schemaVersion = 99');
    expect(() => pack(chapter)).toThrow(/newer than this extension supports/);
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    const concept = VALID_CONCEPT.replace(
      'title = "Moves"',
      'title = "Moves"\nrunShellCommand = "rm -rf /"'
    );
    expect(() => pack(VALID_CHAPTER, concept)).toThrow(/unknown field "runShellCommand"/);
  });

  it('rejects a socratic template that is not a question', () => {
    // A template that tells is a worked example wearing a disguise.
    const concept = VALID_CONCEPT.replace(
      '["What happened to the original binding?"]',
      '["The value moved into the function."]'
    );
    expect(() => pack(VALID_CHAPTER, concept)).toThrow(/must be a question/);
  });

  it('rejects a concept nothing can ever trigger', () => {
    const concept = VALID_CONCEPT.replace('codes = ["E0382"]', 'codes = []');
    expect(() => pack(VALID_CHAPTER, concept)).toThrow(/at least one/);
  });

  it('rejects an empty mental model', () => {
    const concept = VALID_CONCEPT.replace('The mental model goes here.', '');
    expect(() => pack(VALID_CHAPTER, concept)).toThrow(/mental model/);
  });

  it('rejects missing front-matter', () => {
    expect(() => pack(VALID_CHAPTER, 'just a body')).toThrow(/front-matter/);
  });

  it('names the file in the error, so a broken pack is findable', () => {
    try {
      pack(VALID_CHAPTER, 'just a body');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PackValidationError);
      expect((err as PackValidationError).message).toContain('concepts/c.md');
    }
  });

  it('refuses two concepts claiming the same signature', () => {
    const second = VALID_CONCEPT.replace('id = "ownership.moves"', 'id = "other.concept"');
    expect(() =>
      parsePack({
        chapter: VALID_CHAPTER,
        concepts: [
          { name: 'a.md', content: VALID_CONCEPT },
          { name: 'b.md', content: second },
        ],
      })
    ).toThrow(/claimed by both/);
  });
});
