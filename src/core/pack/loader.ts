import { parse as parseToml } from 'smol-toml';

import { indexBySignature, validateConcept, validateMeta } from './schema.js';
import { PackValidationError, type ChapterPack, type ConceptEntry } from './types.js';

export interface RawPackFiles {
  /** Contents of chapter.toml */
  chapter: string;
  /** concepts/*.md, keyed by filename for error messages */
  concepts: Array<{ name: string; content: string }>;
}

const FRONT_MATTER = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/;

/**
 * Split TOML front-matter from the markdown body.
 *
 * TOML rather than YAML deliberately: chapter.toml already forces a TOML parser into the bundle,
 * and one format for pack authors to learn is enough.
 */
export function splitFrontMatter(content: string, where: string): { front: unknown; body: string } {
  const match = FRONT_MATTER.exec(content);
  if (!match) {
    throw new PackValidationError('missing +++ TOML front-matter block', where);
  }
  let front: unknown;
  try {
    front = parseToml(match[1]!);
  } catch (err) {
    throw new PackValidationError(`invalid TOML front-matter: ${String(err)}`, where);
  }
  return { front, body: content.slice(match[0].length) };
}

/**
 * Parse and validate a pack from already-read file contents.
 *
 * Pure on purpose — the filesystem lives in loadPackFromDisk, so every validation rule is testable
 * from a string literal.
 */
export function parsePack(files: RawPackFiles): ChapterPack {
  let rawMeta: unknown;
  try {
    rawMeta = parseToml(files.chapter);
  } catch (err) {
    throw new PackValidationError(`invalid TOML: ${String(err)}`, 'chapter.toml');
  }
  const meta = validateMeta(rawMeta);

  if (files.concepts.length === 0) {
    throw new PackValidationError('a pack must define at least one concept', meta.id);
  }

  const concepts: ConceptEntry[] = files.concepts.map(({ name, content }) => {
    const where = `${meta.id}/concepts/${name}`;
    const { front, body } = splitFrontMatter(content, where);
    return validateConcept(front, meta, body, where);
  });

  const seen = new Set<string>();
  for (const c of concepts) {
    if (seen.has(c.id)) {
      throw new PackValidationError(`duplicate concept id "${c.id}"`, meta.id);
    }
    seen.add(c.id);
  }

  const pack: ChapterPack = { meta, concepts };
  indexBySignature(pack); // throws on conflicting signature claims
  return pack;
}
