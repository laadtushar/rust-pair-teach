import type { ConceptId, DiagnosticSignature } from '../types.js';
import type { Lesson } from './lessonTypes.js';

/**
 * Chapter packs are DATA, never code.
 *
 * No JS hooks, no shell commands, no executable checks. A solo open-source project cannot review a
 * plugin ecosystem's supply chain, and packs are the one artifact users will download from
 * strangers. When a lesson genuinely cannot be expressed here, the fix is to grow the vocabulary in
 * a reviewed extension release — that pressure valve is the design, not a limitation of it.
 */

export const PACK_SCHEMA_VERSION = 1;

export interface ChapterMeta {
  id: string;
  /** Namespaces every concept id in the pack, so `ownership.moves` becomes `rust/ownership.moves`. */
  language: string;
  version: string;
  schemaVersion: number;
  title: string;
  prerequisites: string[];
}

export interface ConceptEntry {
  /** Namespaced at load time. Authors write the bare id. */
  id: ConceptId;
  title: string;
  /** Signatures that map to this concept. */
  signatures: DiagnosticSignature[];
  /**
   * The canonical mental model — the grounding that keeps a personalizing LLM honest, and the
   * offline hint when there is no model at all.
   */
  mentalModel: string;
  /** Level 1 of the ladder. Questions only; anything declarative belongs in mentalModel. */
  socraticTemplates: string[];
  /** What "you've got it" looks like, in the learner's own words. */
  checkForUnderstanding: string;
}

export interface ChapterPack {
  meta: ChapterMeta;
  concepts: ConceptEntry[];
  /** Ordered guided lessons. Empty for packs that only teach reactively. */
  lessons: Lesson[];
}

/** Thrown with a specific, noisy message — silent partial parses are how schema drift hides. */
export class PackValidationError extends Error {
  constructor(
    message: string,
    readonly where: string
  ) {
    super(`${where}: ${message}`);
    this.name = 'PackValidationError';
  }
}
