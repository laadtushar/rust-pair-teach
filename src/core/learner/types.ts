import type { ConceptId } from '../types.js';

export const LEARNER_MODEL_VERSION = 1;

export type Resolution =
  /** Diagnostic cleared before any hint was shown. The strongest possible signal. */
  | 'unaided'
  /** Solved after a level-1 question. */
  | 'self_level_1'
  | 'self_level_2'
  /** Needed the worked example. */
  | 'self_level_3'
  /** Dismissed, or the struggle ended without resolution. */
  | 'abandoned';

export interface ConceptState {
  /** 0 = struggling, 1 = mastered. EWMA over resolutions, decayed by calendar time. */
  score: number;
  encounters: number;
  /** ISO date, used for decay and spaced review. */
  lastSeen: string;
  unresolvedStreak: number;
}

export interface Episode {
  ts: string;
  concept: ConceptId;
  signatures: string[];
  hintLevelReached: 0 | 1 | 2 | 3;
  resolution: Resolution;
  durationSec: number;
}

export interface LearnerPreferences {
  analogies: boolean;
  ambient: boolean;
}

export interface LearnerModel {
  version: number;
  created: string;
  preferences: LearnerPreferences;
  concepts: Record<ConceptId, ConceptState>;
  episodes: Episode[];
  /** Counts of episodes rolled off the end, so history is summarized rather than lost. */
  rollup: Record<ConceptId, { episodes: number; unaided: number }>;
}

export function emptyModel(nowIso: string): LearnerModel {
  return {
    version: LEARNER_MODEL_VERSION,
    created: nowIso,
    preferences: { analogies: true, ambient: true },
    concepts: {},
    episodes: [],
    rollup: {},
  };
}
