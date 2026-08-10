/**
 * Editor-agnostic domain types.
 *
 * Nothing in `src/core` may import `vscode` — this module is the future sidecar,
 * and the boundary is enforced by lint rather than discipline. See docs/engineering-plan.md §4.
 */

/**
 * How a diagnostic is identified across languages.
 *
 * Rust hands us stable codes (`E0382`); Python, Go and Ruby hand us prose only. Concept lookup,
 * novelty detection and cache keys all key on this rather than on a raw code string, so a codeless
 * language stays representable. See docs/language-extensibility.md.
 */
export type DiagnosticSignature =
  | { kind: 'code'; language: string; value: string }
  | { kind: 'pattern'; language: string; value: string };

/** Stable string form, safe as a map key or a cache key. */
export function signatureKey(sig: DiagnosticSignature): string {
  return `${sig.language}/${sig.kind}:${sig.value}`;
}

/** Concept ids are namespaced by language from the first write. `rust/borrows.mutable`. */
export type ConceptId = string;

/** A snapshot of one document at a moment in time. */
export interface EditEvent {
  uri: string;
  at: number;
  text: string;
}

/** One diagnostic as observed at a point in time, already normalized. */
export interface DiagnosticObservation {
  uri: string;
  signature: DiagnosticSignature;
  message: string;
  startLine: number;
  endLine: number;
}

export type CandidateKind =
  /** A diagnostic has persisted, and the learner has gone quiet — the classic stuck signal. */
  | 'lingering_diagnostic'
  /** The same small region rewritten repeatedly: thrashing, with or without a diagnostic. */
  | 'churn'
  /** First time this learner has ever hit this signature. Priority boost. */
  | 'novel_signature';

export type SuppressionReason =
  | 'global_cooldown'
  | 'signature_cooldown'
  | 'ambient_disabled'
  /**
   * We already spoke, and the learner has not typed since.
   *
   * Without this, a learner who walks away mid-struggle comes back to a second nudge about the
   * same stuck state, delivered to an empty chair — the cooldown recharges while nothing changes.
   * Found by the borrow-struggle replay fixture, not by reasoning.
   */
  | 'no_activity_since_last_nudge';

/**
 * A decision the detector reached — fired or suppressed.
 *
 * Suppressed candidates are recorded too, and that is deliberate: a detector that stays silent
 * through a genuine 20-minute struggle fails exactly as badly as one that chirps constantly, and
 * only the suppression record shows you which happened.
 */
export interface CandidateDecision {
  at: number;
  kind: CandidateKind;
  uri: string;
  /** Absent for pure-churn candidates, which need no diagnostic to exist. */
  signature?: DiagnosticSignature;
  startLine: number;
  fired: boolean;
  suppressedBy?: SuppressionReason;
  /** Human-readable trace of why this candidate was raised, for log review during dogfooding. */
  reason: string;
}
