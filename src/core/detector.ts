import type { DetectorConfig } from './config.js';
import type { EditStream } from './editStream.js';
import {
  signatureKey,
  type CandidateDecision,
  type CandidateKind,
  type DiagnosticObservation,
  type DiagnosticSignature,
  type SuppressionReason,
} from './types.js';

interface TrackedDiagnostic {
  uri: string;
  signature: DiagnosticSignature;
  startLine: number;
  firstSeenAt: number;
}

function trackKey(uri: string, sig: DiagnosticSignature, startLine: number): string {
  return `${uri}|${signatureKey(sig)}|${startLine}`;
}

export interface DetectorOptions {
  config: DetectorConfig;
  editStream: EditStream;
  /** Signatures this learner has met before. Backed by the learner model from Phase 3 on. */
  seenSignatures?: Set<string>;
  ambient?: boolean;
}

/**
 * Decides when a learner is stuck.
 *
 * Runs entirely locally and never calls a model — that is a hard constraint (N2), not an
 * optimization: detection has to be free and instant so that teaching can be the only thing that
 * costs anything.
 *
 * Every decision it reaches is recorded, including the suppressed ones. During Phase 1 that log is
 * the entire product: there is no UI and no LLM, just a record of when this thing *would* have
 * spoken, so the thresholds can be tuned against real behaviour before anything is built on top.
 */
export class MomentDetector {
  private readonly config: DetectorConfig;
  private readonly editStream: EditStream;
  private readonly seen: Set<string>;

  private tracked = new Map<string, TrackedDiagnostic>();
  private firedFor = new Set<string>();
  private lastGlobalFire = Number.NEGATIVE_INFINITY;
  private lastSignatureFire = new Map<string, number>();

  ambient: boolean;

  constructor(opts: DetectorOptions) {
    this.config = opts.config;
    this.editStream = opts.editStream;
    this.seen = opts.seenSignatures ?? new Set();
    this.ambient = opts.ambient ?? true;
  }

  /**
   * Replace the diagnostic set for one file.
   *
   * Diagnostics that vanish are forgotten, which is what makes "resolved without a hint" legible
   * later: the absence is the signal.
   */
  onDiagnostics(uri: string, observations: DiagnosticObservation[], now: number): void {
    const live = new Set<string>();

    for (const obs of observations) {
      const key = trackKey(uri, obs.signature, obs.startLine);
      live.add(key);
      if (!this.tracked.has(key)) {
        this.tracked.set(key, {
          uri,
          signature: obs.signature,
          startLine: obs.startLine,
          firstSeenAt: now,
        });
      }
    }

    for (const [key, t] of this.tracked) {
      if (t.uri === uri && !live.has(key)) {
        this.tracked.delete(key);
        this.firedFor.delete(key);
      }
    }
  }

  /** Signatures currently on screen, for "did they solve it alone" bookkeeping. */
  activeSignatures(): DiagnosticSignature[] {
    return [...this.tracked.values()].map((t) => t.signature);
  }

  /**
   * Evaluate the world. Returns every decision reached this tick, fired and suppressed alike.
   */
  tick(now: number): CandidateDecision[] {
    const decisions: CandidateDecision[] = [];
    const idle = this.editStream.idleMs(now);

    for (const [key, t] of this.tracked) {
      if (this.firedFor.has(key)) continue;

      const age = now - t.firstSeenAt;
      if (age < this.config.diagnosticAgeMs) continue;
      if (idle < this.config.idleThresholdMs) continue;

      const sigKey = signatureKey(t.signature);
      const novel = !this.seen.has(sigKey);
      const kind: CandidateKind = novel ? 'novel_signature' : 'lingering_diagnostic';

      decisions.push(
        this.decide({
          now,
          kind,
          uri: t.uri,
          signature: t.signature,
          startLine: t.startLine,
          trackedKey: key,
          reason: novel
            ? `first encounter with ${sigKey}; unresolved ${Math.round(age / 1000)}s, idle ${Math.round(idle / 1000)}s`
            : `${sigKey} unresolved ${Math.round(age / 1000)}s, idle ${Math.round(idle / 1000)}s`,
        })
      );
    }

    for (const region of this.editStream.churningRegions(now)) {
      const key = `churn|${region.uri}|${region.startLine}`;
      if (this.firedFor.has(key)) continue;

      decisions.push(
        this.decide({
          now,
          kind: 'churn',
          uri: region.uri,
          startLine: region.startLine,
          trackedKey: key,
          reason: `region rewritten ${region.touches}x within ${Math.round(this.config.churnWindowMs / 1000)}s`,
        })
      );
    }

    return decisions;
  }

  private decide(input: {
    now: number;
    kind: CandidateKind;
    uri: string;
    signature?: DiagnosticSignature;
    startLine: number;
    trackedKey: string;
    reason: string;
  }): CandidateDecision {
    const { now, kind, uri, signature, startLine, trackedKey, reason } = input;
    const suppressedBy = this.suppressionFor(now, signature);

    const base = {
      at: now,
      kind,
      uri,
      startLine,
      reason,
      ...(signature ? { signature } : {}),
    };

    if (suppressedBy) {
      return { ...base, fired: false, suppressedBy };
    }

    this.lastGlobalFire = now;
    this.firedFor.add(trackedKey);
    if (signature) {
      const sigKey = signatureKey(signature);
      this.lastSignatureFire.set(sigKey, now);
      this.seen.add(sigKey);
    }
    return { ...base, fired: true };
  }

  private suppressionFor(
    now: number,
    signature: DiagnosticSignature | undefined
  ): SuppressionReason | undefined {
    if (!this.ambient) return 'ambient_disabled';
    if (now - this.lastGlobalFire < this.config.globalCooldownMs) return 'global_cooldown';
    // Speaking twice into an unchanged room is noise, however patient the cooldown was.
    if (
      Number.isFinite(this.lastGlobalFire) &&
      this.editStream.lastActivityAt() <= this.lastGlobalFire
    ) {
      return 'no_activity_since_last_nudge';
    }
    if (signature) {
      const last = this.lastSignatureFire.get(signatureKey(signature));
      if (last !== undefined && now - last < this.config.signatureCooldownMs) {
        return 'signature_cooldown';
      }
    }
    return undefined;
  }
}
