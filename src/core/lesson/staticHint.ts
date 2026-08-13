import { explainCommandFor } from '../language.js';
import type { ConceptEntry } from '../pack/types.js';
import type { DiagnosticSignature } from '../types.js';

export type HintLevel = 1 | 2 | 3;

export interface Hint {
  level: HintLevel;
  conceptId: string;
  text: string;
  /** True when this came from the pack rather than a model — shown to the learner as such. */
  offline: boolean;
  /** The compiler's own explanation the learner can run themselves, for languages that have one. */
  explainCommand?: string;
}

/**
 * Build a hint with no model involved.
 *
 * This is the graceful-degradation path (N4) — no API key, no network, a provider outage, or a
 * daily budget already spent. It is deliberately *good*, not a stub apology: the concept entry
 * already contains a canonical mental model and real Socratic questions, so an offline hint is a
 * weaker personalization of the same pedagogy rather than a different product.
 *
 * It is also the grounding for the online path. The model personalizes this content; it does not
 * invent its own.
 */
export function staticHint(
  concept: ConceptEntry,
  level: HintLevel,
  opts: { signature?: DiagnosticSignature; encounters?: number } = {}
): Hint {
  const explain = explainCommandFor(opts.signature);
  const base = {
    conceptId: concept.id,
    offline: true,
    ...(explain ? { explainCommand: explain } : {}),
  };

  if (level === 1) {
    // Rotate through the templates by encounter count, so a learner meeting the same concept twice
    // is not asked the identical question and tempted to pattern-match the phrasing.
    const i = (opts.encounters ?? 0) % concept.socraticTemplates.length;
    return { ...base, level, text: concept.socraticTemplates[i]! };
  }

  if (level === 2) {
    return {
      ...base,
      level,
      text: `${concept.title}\n\n${firstParagraphs(concept.mentalModel, 2)}`,
    };
  }

  return {
    ...base,
    level,
    text: `${concept.title}\n\n${concept.mentalModel}\n\nYou'll know it landed when: ${concept.checkForUnderstanding}`,
  };
}

function firstParagraphs(text: string, n: number): string {
  return text.split(/\n\s*\n/).slice(0, n).join('\n\n');
}
