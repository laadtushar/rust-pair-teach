/**
 * Every tunable threshold, in one place.
 *
 * All of these numbers are PROVISIONAL. The design docs call them placeholders and mean it — they
 * were reasoned about, not measured. Phase 1 exists to replace them with values tuned from a real
 * candidate log, and the session-replay suite exists so that retuning them is a safe, reviewable
 * diff rather than a gamble. See docs/engineering-plan.md §3.2.
 */
export interface DetectorConfig {
  /** How long a diagnostic must survive before it reads as a struggle rather than a typo. */
  diagnosticAgeMs: number;
  /** How long the learner must be quiet before a lingering diagnostic is worth interrupting. */
  idleThresholdMs: number;
  /** Region height, in lines, for churn bucketing. */
  churnRegionLines: number;
  /** Rewrites of one region within the window that count as thrashing. */
  churnTouches: number;
  churnWindowMs: number;
  /** Interruption budget (N5): at most one ambient nudge per this interval, across all kinds. */
  globalCooldownMs: number;
  /** And at most one per signature per this interval, so a single error can't dominate a session. */
  signatureCooldownMs: number;
}

export const defaultConfig: DetectorConfig = {
  diagnosticAgeMs: 20_000,
  idleThresholdMs: 8_000,
  churnRegionLines: 5,
  churnTouches: 3,
  churnWindowMs: 120_000,
  globalCooldownMs: 180_000,
  signatureCooldownMs: 600_000,
};
