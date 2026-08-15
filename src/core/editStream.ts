import type { DetectorConfig } from './config.js';

/** The line range touched by an edit, inclusive. */
export interface ChangedRange {
  startLine: number;
  endLine: number;
}

/**
 * Compare two document snapshots and return the changed line span.
 *
 * Deliberately cheap: trim the common prefix and suffix, and call whatever is left the edit. This
 * misreads some multi-site edits as one wide range, which is acceptable — the consumer is a churn
 * heuristic, not a refactoring engine. The design notes tree-sitter region tracking as the upgrade
 * once the heuristics prove directionally right.
 */
export function changedLineRange(prev: string, next: string): ChangedRange | null {
  if (prev === next) return null;

  const a = prev.split('\n');
  const b = next.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let fromEnd = 0;
  while (
    fromEnd < a.length - start &&
    fromEnd < b.length - start &&
    a[a.length - 1 - fromEnd] === b[b.length - 1 - fromEnd]
  ) {
    fromEnd++;
  }

  const endLine = Math.max(start, b.length - 1 - fromEnd);
  return { startLine: start, endLine };
}

interface FileState {
  text: string;
  lastEditAt: number;
}

/**
 * Rolling snapshots plus churn bookkeeping.
 *
 * Holds no opinion about when to interrupt — it only answers "what changed, where, and how often
 * lately". The detector owns the judgement.
 */
export class EditStream {
  private files = new Map<string, FileState>();
  /** uri -> region bucket -> timestamps of touches */
  private touches = new Map<string, Map<number, number[]>>();
  private lastEditAtAny = 0;

  constructor(private config: DetectorConfig) {}

  /** Adopt new thresholds, keeping the snapshots and churn history already recorded. */
  reconfigure(config: DetectorConfig): void {
    this.config = config;
  }

  /** Record a new snapshot. Returns the changed range, or null for a no-op edit. */
  onEdit(uri: string, text: string, at: number): ChangedRange | null {
    const prev = this.files.get(uri);
    this.files.set(uri, { text, lastEditAt: at });
    this.lastEditAtAny = Math.max(this.lastEditAtAny, at);

    // First sight of a file is not an edit — opening a 400-line file is not 400 lines of churn.
    if (!prev) return null;

    const range = changedLineRange(prev.text, text);
    if (!range) return null;

    const byBucket = this.touches.get(uri) ?? new Map<number, number[]>();
    const firstBucket = Math.floor(range.startLine / this.config.churnRegionLines);
    const lastBucket = Math.floor(range.endLine / this.config.churnRegionLines);
    for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
      const list = byBucket.get(bucket) ?? [];
      list.push(at);
      byBucket.set(bucket, list);
    }
    this.touches.set(uri, byBucket);

    return range;
  }

  snapshot(uri: string): string | undefined {
    return this.files.get(uri)?.text;
  }

  /** When the learner last typed anywhere, or 0 if they never have. */
  lastActivityAt(): number {
    return this.lastEditAtAny;
  }

  /** Milliseconds since the learner last typed anywhere. */
  idleMs(now: number): number {
    if (this.lastEditAtAny === 0) return Number.POSITIVE_INFINITY;
    return now - this.lastEditAtAny;
  }

  /**
   * Regions rewritten often enough, recently enough, to read as thrashing.
   * Prunes expired touches as it goes.
   */
  churningRegions(now: number): Array<{ uri: string; startLine: number; touches: number }> {
    const cutoff = now - this.config.churnWindowMs;
    const out: Array<{ uri: string; startLine: number; touches: number }> = [];

    for (const [uri, byBucket] of this.touches) {
      for (const [bucket, list] of byBucket) {
        const live = list.filter((t) => t > cutoff);
        if (live.length === 0) {
          byBucket.delete(bucket);
          continue;
        }
        byBucket.set(bucket, live);
        if (live.length >= this.config.churnTouches) {
          out.push({
            uri,
            startLine: bucket * this.config.churnRegionLines,
            touches: live.length,
          });
        }
      }
    }
    return out;
  }
}
