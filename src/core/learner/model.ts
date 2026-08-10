import type { HintLevel } from '../lesson/staticHint.js';
import type { ConceptId } from '../types.js';
import {
  emptyModel,
  type ConceptState,
  type Episode,
  type LearnerModel,
  type Resolution,
} from './types.js';

/** How fast a single resolution moves the score. Provisional, like every constant here. */
const ALPHA = 0.35;

/** Where each outcome pulls the score toward. */
const TARGET: Record<Resolution, number> = {
  unaided: 1.0,
  self_level_1: 0.85,
  self_level_2: 0.6,
  self_level_3: 0.35,
  abandoned: 0.1,
};

/** Mastery half-life. Long, because this drives spaced review, not punishment. */
const DECAY_HALF_LIFE_DAYS = 60;

const FADE_THRESHOLD = 0.75;
const MASTERY_THRESHOLD = 0.9;
const PROACTIVE_STREAK = 3;

const MAX_EPISODES = 500;
const DAY_MS = 86_400_000;

export function newModel(now: number): LearnerModel {
  return emptyModel(new Date(now).toISOString());
}

function initialState(nowIso: string): ConceptState {
  return { score: 0.3, encounters: 0, lastSeen: nowIso, unresolvedStreak: 0 };
}

/**
 * Fold one resolved teachable moment into the model.
 *
 * Returns a new model rather than mutating, so a caller can replay months of history and compare
 * outcomes without worrying about shared state.
 */
export function recordEpisode(
  model: LearnerModel,
  episode: Omit<Episode, 'ts'>,
  now: number
): LearnerModel {
  const nowIso = new Date(now).toISOString();
  const prev = model.concepts[episode.concept] ?? initialState(nowIso);

  // Decay first, then learn: what the learner remembered today is measured against what time had
  // already eroded, not against a stale peak.
  const decayed = decayScore(prev.score, daysBetween(prev.lastSeen, nowIso));
  const target = TARGET[episode.resolution];
  const score = clamp(decayed * (1 - ALPHA) + target * ALPHA);

  const resolvedWell = episode.resolution !== 'abandoned';
  const next: ConceptState = {
    score,
    encounters: prev.encounters + 1,
    lastSeen: nowIso,
    unresolvedStreak: resolvedWell ? 0 : prev.unresolvedStreak + 1,
  };

  const episodes = [...model.episodes, { ...episode, ts: nowIso }];
  const rollup = { ...model.rollup };

  // Cap history, but summarize what falls off — the file rides along in prompts and cannot grow
  // without bound, yet "this learner has met ownership 200 times" stays true.
  let kept = episodes;
  if (episodes.length > MAX_EPISODES) {
    const dropped = episodes.slice(0, episodes.length - MAX_EPISODES);
    kept = episodes.slice(episodes.length - MAX_EPISODES);
    for (const d of dropped) {
      const r = rollup[d.concept] ?? { episodes: 0, unaided: 0 };
      rollup[d.concept] = {
        episodes: r.episodes + 1,
        unaided: r.unaided + (d.resolution === 'unaided' ? 1 : 0),
      };
    }
  }

  return {
    ...model,
    concepts: { ...model.concepts, [episode.concept]: next },
    episodes: kept,
    rollup,
  };
}

/** Score as of now, accounting for time passed since the concept was last seen. */
export function currentScore(model: LearnerModel, concept: ConceptId, now: number): number {
  const state = model.concepts[concept];
  if (!state) return 0;
  return decayScore(state.score, daysBetween(state.lastSeen, new Date(now).toISOString()));
}

export function decayScore(score: number, days: number): number {
  if (days <= 0) return score;
  return clamp(score * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS));
}

export interface TeachingPosture {
  /** Whether ambient nudges fire for this concept at all. */
  ambient: boolean;
  /** Where the hint ladder starts. */
  startLevel: HintLevel;
  graduated: boolean;
}

/**
 * Scaffold fading (F9): the score is a volume knob on the teacher's voice, not a report card.
 *
 * As mastery rises the teacher deliberately gets quieter — later ladder entry, then silence unless
 * asked. A tutor whose goal is its own obsolescence is the anti-autocomplete principle applied over
 * time; a tutor that keeps explaining ownership to someone who has understood it for a month is
 * just a linter with opinions.
 */
export function teachingPosture(score: number): TeachingPosture {
  if (score >= MASTERY_THRESHOLD) return { ambient: false, startLevel: 2, graduated: true };
  if (score >= FADE_THRESHOLD) return { ambient: true, startLevel: 2, graduated: false };
  return { ambient: true, startLevel: 1, graduated: false };
}

/** Concepts worth offering a warm-up on at the start of a session. */
export function warmUpCandidates(model: LearnerModel, now: number): ConceptId[] {
  return Object.entries(model.concepts)
    .filter(([, s]) => s.unresolvedStreak >= PROACTIVE_STREAK)
    .map(([id]) => id)
    .sort((a, b) => currentScore(model, a, now) - currentScore(model, b, now));
}

/**
 * Concepts whose mastery has decayed enough to be worth a ten-second prediction card.
 *
 * Only concepts that were genuinely learned qualify — resurfacing something never mastered is
 * teaching, not review, and belongs on a different path.
 */
export function reviewCandidates(model: LearnerModel, now: number): ConceptId[] {
  return Object.entries(model.concepts)
    .filter(([id, s]) => s.score >= FADE_THRESHOLD && currentScore(model, id, now) < FADE_THRESHOLD)
    .map(([id]) => id);
}

/**
 * The two-line summary that travels with a prompt. Everything else stays on the machine.
 */
export function summarize(model: LearnerModel, concept: ConceptId, now: number): string {
  const state = model.concepts[concept];
  if (!state) return 'First time meeting this concept.';

  const score = currentScore(model, concept, now);
  const rolled = model.rollup[concept]?.episodes ?? 0;
  const band = score >= MASTERY_THRESHOLD ? 'solid' : score >= FADE_THRESHOLD ? 'nearly there' : 'still shaky';
  const streak =
    state.unresolvedStreak > 0 ? `; ${state.unresolvedStreak} unresolved in a row` : '';
  const prefs = model.preferences.analogies ? '; prefers analogies' : '';

  return `Met this ${state.encounters + rolled} times, currently ${band}${streak}${prefs}.`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / DAY_MS);
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}
