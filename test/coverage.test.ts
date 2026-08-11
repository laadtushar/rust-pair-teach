import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import type { ChapterPack } from '../src/core/pack/types.js';

const PACKS_DIR = fileURLToPath(new URL('../packs', import.meta.url));

/**
 * Every code a beginner is likely to meet in their first weeks.
 *
 * An unmapped code means the tutor stays silent (session.ts returns `no_concept`) at exactly the
 * moment help was wanted — silence is correct behaviour for an unknown code, which is why the
 * coverage has to be asserted rather than assumed.
 */
const MUST_COVER = [
  // ownership and borrowing
  'E0382', 'E0499', 'E0502', 'E0505', 'E0515', 'E0597', 'E0716',
  // mutability
  'E0384', 'E0596', 'E0594', 'E0507',
  // types and traits
  'E0308', 'E0277', 'E0599',
  // names, modules, visibility
  'E0425', 'E0433', 'E0432', 'E0603',
  // matching
  'E0004', 'E0005',
  // lifetimes
  'E0106', 'E0621',
  // getting started
  'E0601',
];

let packs: ChapterPack[];

beforeAll(async () => {
  const dirs = readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(PACKS_DIR, d.name));
  packs = await Promise.all(dirs.map(loadPackFromDisk));
});

function allCodes(): Map<string, string[]> {
  const byCode = new Map<string, string[]>();
  for (const pack of packs) {
    for (const concept of pack.concepts) {
      for (const sig of concept.signatures) {
        if (sig.kind !== 'code') continue;
        byCode.set(sig.value, [...(byCode.get(sig.value) ?? []), concept.id]);
      }
    }
  }
  return byCode;
}

describe('error code coverage (D2)', () => {
  it('every pack on disk loads', () => {
    expect(packs.length).toBeGreaterThanOrEqual(3);
  });

  it('covers the codes a beginner will actually hit', () => {
    const covered = allCodes();
    const missing = MUST_COVER.filter((c) => !covered.has(c));
    expect(missing, `unmapped: ${missing.join(', ')}`).toEqual([]);
  });

  it('maps each code to exactly one concept, so lookup is unambiguous', () => {
    // Cross-pack duplicates are tolerated at runtime by first-wins, but a code taught two
    // different ways is a content bug worth catching here.
    const clashes = [...allCodes()].filter(([, ids]) => new Set(ids).size > 1);
    expect(clashes.map(([code]) => code)).toEqual([]);
  });

  it('gives every concept a real mental model, not a stub', () => {
    for (const pack of packs) {
      for (const c of pack.concepts) {
        expect(c.mentalModel.length, `${pack.meta.id}/${c.id}`).toBeGreaterThan(300);
      }
    }
  });

  it('asks rather than tells in every socratic template', () => {
    for (const pack of packs) {
      for (const c of pack.concepts) {
        for (const t of c.socraticTemplates) {
          expect(t, `${c.id}`).toContain('?');
        }
      }
    }
  });
});
