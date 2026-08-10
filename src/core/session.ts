import { LessonEngine } from './lesson/engine.js';
import { extractRegion } from './lesson/region.js';
import type { Hint, HintLevel } from './lesson/staticHint.js';
import { currentScore, recordEpisode, summarize, teachingPosture } from './learner/model.js';
import type { LearnerModel, Resolution } from './learner/types.js';
import type { ConceptEntry } from './pack/types.js';
import { signatureKey, type CandidateDecision, type DiagnosticSignature } from './types.js';

export interface ActiveLesson {
  concept: ConceptEntry;
  signature?: DiagnosticSignature;
  uri: string;
  startLine: number;
  level: HintLevel;
  hints: Hint[];
  startedAt: number;
}

export type OfferOutcome =
  | { kind: 'offered'; lesson: ActiveLesson }
  | { kind: 'suppressed'; reason: 'graduated' | 'no_concept' | 'lesson_in_progress' };

export interface SessionDeps {
  engine: LessonEngine;
  /** Signature key -> concept, built once at pack load. */
  conceptIndex: Map<string, ConceptEntry>;
  model: LearnerModel;
  /** Called whenever the model changes, so the host can persist it. */
  onModelChanged?: (model: LearnerModel) => void;
}

/**
 * Connects a detected moment to a taught lesson, and the outcome back to the learner model.
 *
 * This is where the product's central claim actually happens: what the learner struggled with last
 * week changes what they are asked this week. Everything upstream is detection and everything
 * downstream is rendering; the decisions live here, which is why this is in `core` and covered by
 * tests rather than living in the webview.
 */
export class TutorSession {
  private active: ActiveLesson | null = null;

  constructor(private deps: SessionDeps) {}

  get model(): LearnerModel {
    return this.deps.model;
  }

  get activeLesson(): ActiveLesson | null {
    return this.active;
  }

  /**
   * Turn a fired detector decision into a lesson, or explain why not.
   *
   * On-demand requests bypass the fading rules entirely — a learner who asks is always answered,
   * however mastered the concept looks. Fading governs when the teacher speaks unprompted, not
   * whether it will speak at all.
   */
  async offer(
    decision: CandidateDecision,
    documentText: string,
    now: number,
    opts: { onDemand?: boolean } = {}
  ): Promise<OfferOutcome> {
    if (this.active) return { kind: 'suppressed', reason: 'lesson_in_progress' };

    const concept = decision.signature
      ? this.deps.conceptIndex.get(signatureKey(decision.signature))
      : undefined;
    if (!concept) return { kind: 'suppressed', reason: 'no_concept' };

    const score = currentScore(this.deps.model, concept.id, now);
    const posture = teachingPosture(score);
    if (!posture.ambient && !opts.onDemand) {
      return { kind: 'suppressed', reason: 'graduated' };
    }

    const hint = await this.requestHint(concept, decision, documentText, posture.startLevel, now);

    this.active = {
      concept,
      ...(decision.signature ? { signature: decision.signature } : {}),
      uri: decision.uri,
      startLine: decision.startLine,
      level: posture.startLevel,
      hints: [hint],
      startedAt: now,
    };
    return { kind: 'offered', lesson: this.active };
  }

  /**
   * Move one rung up the ladder. Never more than one — skipping levels is how a tutor becomes an
   * answer key, and the click is the learner consenting to be told more.
   */
  async escalate(documentText: string, now: number): Promise<Hint | null> {
    const lesson = this.active;
    if (!lesson || lesson.level >= 3) return null;

    const level = (lesson.level + 1) as HintLevel;
    const hint = await this.requestHint(
      lesson.concept,
      {
        uri: lesson.uri,
        startLine: lesson.startLine,
        ...(lesson.signature ? { signature: lesson.signature } : {}),
      },
      documentText,
      level,
      now
    );

    lesson.level = level;
    lesson.hints.push(hint);
    return hint;
  }

  /** The learner solved it, or gave up. Either way the model learns something. */
  resolve(outcome: 'solved' | 'dismissed', now: number): void {
    const lesson = this.active;
    if (!lesson) return;
    this.active = null;

    const resolution: Resolution =
      outcome === 'dismissed'
        ? 'abandoned'
        : (`self_level_${lesson.level}` as 'self_level_1' | 'self_level_2' | 'self_level_3');

    this.record(lesson.concept.id, lesson.signature, lesson.level, resolution, lesson.startedAt, now);
  }

  /**
   * A diagnostic cleared while no lesson was open.
   *
   * This is the most valuable signal the system gets and the easiest to forget to record: the
   * learner hit a known-hard error and fixed it with no help at all. A tutor that only measures
   * struggle will never notice anyone getting better.
   */
  noteResolvedUnaided(signature: DiagnosticSignature, startedAt: number, now: number): void {
    const concept = this.deps.conceptIndex.get(signatureKey(signature));
    if (!concept) return;
    this.record(concept.id, signature, 0, 'unaided', startedAt, now);
  }

  private async requestHint(
    concept: ConceptEntry,
    at: { uri: string; startLine: number; signature?: DiagnosticSignature },
    documentText: string,
    level: HintLevel,
    now: number
  ): Promise<Hint> {
    const state = this.deps.model.concepts[concept.id];
    return this.deps.engine.hint({
      concept,
      level,
      ...(at.signature ? { signature: at.signature } : {}),
      diagnosticMessage: at.signature?.value ?? 'no diagnostic',
      region: extractRegion(documentText, at.startLine),
      learnerSummary: summarize(this.deps.model, concept.id, now),
      ...(state ? { encounters: state.encounters } : {}),
    });
  }

  private record(
    conceptId: string,
    signature: DiagnosticSignature | undefined,
    hintLevelReached: 0 | 1 | 2 | 3,
    resolution: Resolution,
    startedAt: number,
    now: number
  ): void {
    this.deps.model = recordEpisode(
      this.deps.model,
      {
        concept: conceptId,
        signatures: signature ? [signatureKey(signature)] : [],
        hintLevelReached,
        resolution,
        durationSec: Math.max(0, Math.round((now - startedAt) / 1000)),
      },
      now
    );
    this.deps.onModelChanged?.(this.deps.model);
  }
}
