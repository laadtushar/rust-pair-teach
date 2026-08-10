import type { HintLevel } from './lesson/staticHint.js';
import type { Resolution } from './learner/types.js';
import type { SuppressionReason } from './types.js';

/**
 * Opt-in, local, and readable by the person it describes.
 *
 * This is not incidental instrumentation — it is the measurement apparatus for the two questions
 * the whole project turns on: do ambient interruptions feel helpful or noisy, and does concept
 * tracking change what people study. It has to exist before anyone is recruited, because a first
 * cohort that generates no evidence is a wasted cohort.
 *
 * What it must never contain: code, file paths, or anything identifying a project. Counts, error
 * codes, and concept ids only.
 */

export interface TelemetrySnapshot {
  since: string;
  momentsFired: number;
  momentsSuppressed: Record<string, number>;
  hintsShown: Record<HintLevel, number>;
  hintsOffline: number;
  hintsRefused: number;
  resolutions: Record<string, number>;
  onDemandRequests: number;
  ambientDisabledCount: number;
  ambientEnabledCount: number;
  conceptsTaught: Record<string, number>;
}

export class Telemetry {
  private snap: TelemetrySnapshot;

  constructor(
    /** Off unless the learner turns it on. */
    public enabled: boolean,
    sinceIso: string
  ) {
    this.snap = {
      since: sinceIso,
      momentsFired: 0,
      momentsSuppressed: {},
      hintsShown: { 1: 0, 2: 0, 3: 0 },
      hintsOffline: 0,
      hintsRefused: 0,
      resolutions: {},
      onDemandRequests: 0,
      ambientDisabledCount: 0,
      ambientEnabledCount: 0,
      conceptsTaught: {},
    };
  }

  momentFired(): void {
    if (this.enabled) this.snap.momentsFired++;
  }

  momentSuppressed(reason: SuppressionReason): void {
    if (!this.enabled) return;
    this.snap.momentsSuppressed[reason] = (this.snap.momentsSuppressed[reason] ?? 0) + 1;
  }

  hintShown(level: HintLevel, conceptId: string, offline: boolean): void {
    if (!this.enabled) return;
    this.snap.hintsShown[level]++;
    if (offline) this.snap.hintsOffline++;
    this.snap.conceptsTaught[conceptId] = (this.snap.conceptsTaught[conceptId] ?? 0) + 1;
  }

  hintRefused(): void {
    if (this.enabled) this.snap.hintsRefused++;
  }

  resolved(resolution: Resolution): void {
    if (!this.enabled) return;
    this.snap.resolutions[resolution] = (this.snap.resolutions[resolution] ?? 0) + 1;
  }

  onDemand(): void {
    if (this.enabled) this.snap.onDemandRequests++;
  }

  ambientToggled(on: boolean): void {
    if (!this.enabled) return;
    if (on) this.snap.ambientEnabledCount++;
    else this.snap.ambientDisabledCount++;
  }

  snapshot(): TelemetrySnapshot {
    return structuredClone(this.snap);
  }

  reset(sinceIso: string): void {
    const enabled = this.enabled;
    Object.assign(this, new Telemetry(enabled, sinceIso));
  }
}

export type Verdict = 'helpful' | 'noisy' | 'insufficient_data';

export interface ValidationReading {
  /** Stage-1 question 1: do ambient interruptions feel helpful, or like noise? */
  ambient: { verdict: Verdict; dismissRate: number | null; sample: number };
  /** Stage-1 question 2: does the learner reach for the tutor deliberately? */
  deliberateUse: { onDemandShare: number | null; sample: number };
  notes: string[];
}

const MIN_SAMPLE = 20;
const NOISY_DISMISS_RATE = 0.5;

/**
 * Read the instrument.
 *
 * Deliberately conservative: below a usable sample it returns `insufficient_data` rather than a
 * number that looks like an answer. The failure mode this guards against is shipping a pivot
 * decision built on nine data points — this whole project's premise came out of research that
 * warned against exactly that kind of overreading.
 */
export function interpret(snap: TelemetrySnapshot): ValidationReading {
  const resolved = Object.values(snap.resolutions).reduce((a, b) => a + b, 0);
  const abandoned = snap.resolutions['abandoned'] ?? 0;
  const notes: string[] = [];

  const dismissRate = resolved > 0 ? abandoned / resolved : null;
  let verdict: Verdict = 'insufficient_data';
  if (resolved >= MIN_SAMPLE && dismissRate !== null) {
    verdict = dismissRate > NOISY_DISMISS_RATE ? 'noisy' : 'helpful';
  } else {
    notes.push(`Only ${String(resolved)} resolved lessons — need ${String(MIN_SAMPLE)} to read this.`);
  }

  // Turning ambient off is the loudest possible signal and does not wait for a sample size.
  if (snap.ambientDisabledCount > 0) {
    verdict = 'noisy';
    notes.push(
      `Ambient watching was switched off ${String(snap.ambientDisabledCount)} time(s) — treat that as the answer regardless of the other numbers.`
    );
  }

  const totalTeaching = snap.momentsFired + snap.onDemandRequests;
  const onDemandShare = totalTeaching > 0 ? snap.onDemandRequests / totalTeaching : null;
  if (onDemandShare !== null && onDemandShare > 0.6) {
    notes.push(
      'Most teaching is being requested rather than offered — the on-demand-only pivot is worth considering.'
    );
  }

  if (snap.hintsRefused > 0) {
    notes.push(
      `${String(snap.hintsRefused)} model response(s) were refused for trying to give the answer away.`
    );
  }

  return {
    ambient: { verdict, dismissRate, sample: resolved },
    deliberateUse: { onDemandShare, sample: totalTeaching },
    notes,
  };
}
