import { staticHint } from './lesson/staticHint.js';
import { currentScore, recordEpisode, summarize, teachingPosture } from './learner/model.js';
import type { LearnerModel, Resolution } from './learner/types.js';
import type { ConceptEntry } from './pack/types.js';
import { signatureKey, type DiagnosticSignature } from './types.js';

export interface SessionDeps {
  /** Signature key -> concept, built once at pack load. */
  conceptIndex: Map<string, ConceptEntry>;
  model: LearnerModel;
  /** Called whenever the model changes, so the host can persist it. */
  onModelChanged?: (model: LearnerModel) => void;
}

/** What the tutor did about a concept before its error went away. */
export type TutorInvolvement = 'silent' | 'discussed';

export interface OfflineTeaching {
  concept: ConceptEntry;
  text: string;
}

/**
 * The learner model's connection to everything else.
 *
 * It answers three questions: which concept is this error about, should the tutor speak about it
 * unprompted, and what did the learner just demonstrate. It holds no UI state — the hint-ladder
 * card it used to drive was retired when chat became the only teaching surface (A3), and the
 * ladder's escalate/resolve machinery went with it rather than lingering as dead code.
 */
export class TutorSession {
  /** Concepts the tutor has spoken about, and when, so credit can be assigned on resolution. */
  private discussed = new Map<string, number>();

  constructor(private deps: SessionDeps) {}

  get model(): LearnerModel {
    return this.deps.model;
  }

  conceptFor(signature: DiagnosticSignature): ConceptEntry | undefined {
    return this.deps.conceptIndex.get(signatureKey(signature));
  }

  /**
   * Whether the tutor should raise this unprompted.
   *
   * On-demand requests bypass it entirely — fading governs when the teacher speaks first, never
   * whether it will answer.
   */
  shouldSpeakUnprompted(signature: DiagnosticSignature, now: number): boolean {
    const concept = this.conceptFor(signature);
    if (!concept) return false;
    return teachingPosture(currentScore(this.deps.model, concept.id, now)).ambient;
  }

  /** A two-line summary for the prompt. The model itself never leaves the machine. */
  summaryFor(signature: DiagnosticSignature, now: number): string | undefined {
    const concept = this.conceptFor(signature);
    return concept ? summarize(this.deps.model, concept.id, now) : undefined;
  }

  /**
   * Teaching drawn from the packs, with no model involved.
   *
   * This is what keeps the extension useful without an API key (Q2). It is delivered into the
   * conversation rather than through a second UI, so there is exactly one teaching surface.
   */
  offlineTeaching(signature: DiagnosticSignature, now: number): OfflineTeaching | null {
    const concept = this.conceptFor(signature);
    if (!concept) return null;

    const state = this.deps.model.concepts[concept.id];
    const level = teachingPosture(currentScore(this.deps.model, concept.id, now)).startLevel;
    const hint = staticHint(concept, level, {
      signature,
      ...(state ? { encounters: state.encounters } : {}),
    });

    const explain = hint.explainCommand ? `\n\nThe compiler can explain this one itself: \`${hint.explainCommand}\`` : '';
    return { concept, text: `${hint.text}${explain}` };
  }

  /** Remember that the tutor engaged with this concept, for crediting the eventual resolution. */
  noteDiscussed(signature: DiagnosticSignature, now: number): void {
    const concept = this.conceptFor(signature);
    if (concept) this.discussed.set(concept.id, now);
  }

  /**
   * A diagnostic went away (A5, Q3).
   *
   * The compiler decides that something was resolved; what the tutor did decides the credit.
   * Clearing an error the tutor never mentioned is the strongest evidence available and is graded
   * as unaided. Clearing it after a conversation still earns real credit, just less.
   *
   * Deliberately approximate, and approximate in the learner's favour. The alternative — a button
   * asking "did you solve it?" — puts friction on the one interaction that should have none.
   */
  noteResolved(
    signature: DiagnosticSignature,
    involvement: TutorInvolvement,
    startedAt: number,
    now: number
  ): Resolution | null {
    const concept = this.conceptFor(signature);
    if (!concept) return null;

    const wasDiscussed = involvement === 'discussed' || this.discussed.has(concept.id);
    const resolution: Resolution = wasDiscussed ? 'self_level_2' : 'unaided';
    this.discussed.delete(concept.id);

    this.record(concept.id, signature, wasDiscussed ? 2 : 0, resolution, startedAt, now);
    return resolution;
  }

  /**
   * The session ended with a concept still unresolved after the tutor engaged with it.
   *
   * Without this, giving up looks identical to never having struggled, and the model would only
   * ever learn from successes.
   */
  noteAbandoned(now: number): void {
    for (const [conceptId, at] of this.discussed) {
      this.record(conceptId, undefined, 2, 'abandoned', at, now);
    }
    this.discussed.clear();
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
