import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { explainCommandFor, isWatched, WATCHED_EDITOR_IDS } from '../src/core/language.js';
import { discoverPacks } from '../src/core/pack/discover.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import type { ChapterPack, ConceptEntry } from '../src/core/pack/types.js';
import { normalizeMessage, SignatureResolver, toSignature } from '../src/core/signature.js';
import { signatureKey } from '../src/core/types.js';

const PACKS_DIR = fileURLToPath(new URL('../packs', import.meta.url));

let packs: ChapterPack[];
let resolver: SignatureResolver;
let index: Map<string, ConceptEntry>;

beforeAll(async () => {
  const found = await discoverPacks(PACKS_DIR);
  expect(found.failures, JSON.stringify(found.failures)).toEqual([]);
  packs = found.packs;
  resolver = new SignatureResolver(packs);

  index = new Map();
  for (const pack of packs) {
    for (const [key, concept] of indexBySignature(pack)) {
      if (!index.has(key)) index.set(key, concept);
    }
  }
});

/**
 * Messages a learner would actually see, verbatim.
 *
 * The whole point of a pattern signature is that it survives contact with real compiler output, so
 * these are copied from real runs rather than written to match the regexes.
 */
const PYTHON_MESSAGES: Array<{ message: string; concept: string }> = [
  {
    message: "local variable 'total' referenced before assignment",
    concept: 'python/scope.assignment',
  },
  {
    message: "cannot access local variable 'count' where it is not associated with a value",
    concept: 'python/scope.assignment',
  },
  {
    // pylint W0102
    message: 'Dangerous default value [] as argument (dangerous-default-value)',
    concept: 'python/functions.mutable-defaults',
  },
  {
    // ruff / flake8-bugbear B006
    message: 'Do not use mutable data structures for argument defaults',
    concept: 'python/functions.mutable-defaults',
  },
  {
    // CPython SyntaxError
    message: "name 'total' is used prior to global declaration",
    concept: 'python/scope.assignment',
  },
  {
    message: "'NoneType' object has no attribute 'strip'",
    concept: 'python/types.none-propagation',
  },
  {
    message: "'NoneType' object is not subscriptable",
    concept: 'python/types.none-propagation',
  },
  {
    message: "object of type 'NoneType' has no len()",
    concept: 'python/types.none-propagation',
  },
  {
    message: 'dictionary changed size during iteration',
    concept: 'python/collections.mutate-while-iterating',
  },
  {
    message: 'set changed size during iteration',
    concept: 'python/collections.mutate-while-iterating',
  },
  {
    message: 'deque mutated during iteration',
    concept: 'python/collections.mutate-while-iterating',
  },
  {
    // TypeError from `x in None`
    message: "argument of type 'NoneType' is not iterable",
    concept: 'python/types.none-propagation',
  },
  {
    // pylint W0640
    message: 'Cell variable i defined in loop (cell-var-from-loop)',
    concept: 'python/scope.late-binding',
  },
  {
    // pylint W0631
    message: "Using possibly undefined loop variable 'i'",
    concept: 'python/scope.late-binding',
  },
];

describe('a codeless language reaches a concept', () => {
  // This is the bug the second language existed to find. A pack declared
  // `^local variable '\w+' referenced before assignment$`; the detector produced
  // `local variable <id> referenced before assignment`; the concept index is an exact map. The two
  // could never meet, so every codeless language silently taught nothing.
  it('was unreachable through the naive path, which is why the resolver exists', () => {
    const naive = toSignature('python', undefined, PYTHON_MESSAGES[0]!.message);
    expect(index.has(signatureKey(naive))).toBe(false);
  });

  it.each(PYTHON_MESSAGES)('teaches $concept from "$message"', ({ message, concept }) => {
    const sig = resolver.resolve('python', undefined, message);
    expect(sig.kind).toBe('pattern');
    expect(index.get(signatureKey(sig))?.id, `no concept claimed: ${message}`).toBe(concept);
  });

  it('gives the same signature every time, so cooldowns and novelty still work', () => {
    const a = resolver.resolve('python', undefined, "local variable 'total' referenced before assignment");
    const b = resolver.resolve('python', undefined, "local variable 'seen' referenced before assignment");
    expect(signatureKey(a)).toBe(signatureKey(b));
  });

  it('falls back to a normalized message for an error no pack claims', () => {
    const sig = resolver.resolve('python', undefined, "'Foo' object has no attribute 'bar'");
    expect(sig).toEqual({
      kind: 'pattern',
      language: 'python',
      value: normalizeMessage("'Foo' object has no attribute 'bar'"),
    });
    // Unteachable, but still a stable key — the detector's timing heuristics keep working.
    expect(index.has(signatureKey(sig))).toBe(false);
  });

  it('does not let one language claim messages belonging to another', () => {
    const sig = resolver.resolve('rust', undefined, 'dictionary changed size during iteration');
    expect(index.has(signatureKey(sig))).toBe(false);
  });

  it('leaves a language with real codes alone', () => {
    expect(resolver.resolve('rust', 'E0502', 'cannot borrow as mutable')).toEqual({
      kind: 'code',
      language: 'rust',
      value: 'E0502',
    });
  });

  it('survives a malformed pattern rather than refusing to load the packs', () => {
    const bad = [
      {
        meta: { language: 'python' },
        concepts: [
          { signatures: [{ kind: 'pattern', language: 'python', value: '([unclosed' }] },
          { signatures: [{ kind: 'pattern', language: 'python', value: 'still fine' }] },
        ],
      },
    ] as unknown as ChapterPack[];

    const reported: string[] = [];
    const r = new SignatureResolver(bad, (pattern) => reported.push(pattern));
    expect(reported).toEqual(['([unclosed']);
    expect(r.size).toBe(1);
    expect(r.resolve('python', undefined, 'still fine here').value).toBe('still fine');
  });
});

describe('every declared pattern earns its place', () => {
  // A pattern that compiles but never matches anything is the exact failure this whole test file
  // was written to catch, and it is invisible at runtime: the tutor simply stays quiet.
  it('has a real message exercising every python pattern', () => {
    const declared = new Set(
      packs
        .filter((p) => p.meta.language === 'python')
        .flatMap((p) => p.concepts)
        .flatMap((c) => c.signatures)
        .filter((s) => s.kind === 'pattern')
        .map((s) => s.value)
    );
    const exercised = new Set(
      PYTHON_MESSAGES.map((m) => resolver.resolve('python', undefined, m.message).value)
    );
    const never = [...declared].filter((d) => !exercised.has(d));
    expect(never, `patterns no fixture message reaches: ${never.join(' | ')}`).toEqual([]);
  });
});

describe('the language table', () => {
  it('watches every language a pack teaches', () => {
    for (const pack of packs) {
      expect(isWatched(pack.meta.language), `${pack.meta.id} is unreachable`).toBe(true);
    }
  });

  it('offers the compiler explanation only where one exists', () => {
    expect(explainCommandFor({ kind: 'code', language: 'rust', value: 'E0502' })).toBe(
      'rustc --explain E0502'
    );
    // Python has no `rustc --explain`, and inventing one would be worse than staying quiet.
    expect(
      explainCommandFor({ kind: 'pattern', language: 'python', value: 'anything' })
    ).toBeUndefined();
    expect(
      explainCommandFor({ kind: 'code', language: 'rust', value: 'clippy::needless_range_loop' })
    ).toBeUndefined();
  });

  it('names every watched editor id', () => {
    expect(WATCHED_EDITOR_IDS).toContain('rust');
    expect(WATCHED_EDITOR_IDS).toContain('python');
  });
});
