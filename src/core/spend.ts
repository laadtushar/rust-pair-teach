/**
 * A daily ceiling on model calls (B3).
 *
 * The design targets under $0.02 per teachable moment, and chat sends the full lesson context every
 * turn — materially more than that estimate assumed. More importantly, the tutor now speaks
 * unprompted, so a loop in the nudge logic could bill without anyone touching the keyboard. A cap
 * is the difference between a bug that annoys and a bug that costs money overnight.
 */

export interface SpendState {
  /** ISO date, YYYY-MM-DD. Rolls the counters over. */
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SpendStore {
  load(): SpendState | null;
  save(state: SpendState): void;
}

export interface SpendGuardOptions {
  /** Calls per day. Provisional, like every number in this project. */
  dailyCallLimit: number;
  store?: SpendStore;
}

export const DEFAULT_DAILY_CALL_LIMIT = 200;

export function dayOf(nowIso: string): string {
  return nowIso.slice(0, 10);
}

function fresh(day: string): SpendState {
  return { day, calls: 0, promptTokens: 0, completionTokens: 0 };
}

export class SpendGuard {
  private state: SpendState;

  constructor(private opts: SpendGuardOptions, nowIso: string) {
    const loaded = opts.store?.load();
    this.state = loaded && loaded.day === dayOf(nowIso) ? loaded : fresh(dayOf(nowIso));
  }

  /**
   * Raise or lower the ceiling mid-session.
   *
   * Today's spend is kept: someone who lifts the cap after hitting it wants the rest of their day
   * back, not a fresh budget that forgets what they already used.
   */
  setDailyLimit(dailyCallLimit: number): void {
    this.opts = { ...this.opts, dailyCallLimit };
  }

  /** Whether another call is permitted, and why not when it is not. */
  check(nowIso: string): { allowed: boolean; reason?: string } {
    this.rollover(nowIso);
    if (this.state.calls >= this.opts.dailyCallLimit) {
      return {
        allowed: false,
        reason: `Daily limit of ${String(this.opts.dailyCallLimit)} model calls reached. It resets at midnight, or you can raise rustPairTeacher.dailyCallLimit. The built-in lessons and hints still work.`,
      };
    }
    return { allowed: true };
  }

  /** Count a call that actually went out, with whatever usage the provider reported. */
  record(
    nowIso: string,
    usage?: { promptTokens?: number; completionTokens?: number }
  ): void {
    this.rollover(nowIso);
    this.state = {
      ...this.state,
      calls: this.state.calls + 1,
      promptTokens: this.state.promptTokens + (usage?.promptTokens ?? 0),
      completionTokens: this.state.completionTokens + (usage?.completionTokens ?? 0),
    };
    this.opts.store?.save(this.state);
  }

  snapshot(): SpendState {
    return { ...this.state };
  }

  remaining(): number {
    return Math.max(0, this.opts.dailyCallLimit - this.state.calls);
  }

  private rollover(nowIso: string): void {
    const today = dayOf(nowIso);
    if (this.state.day !== today) {
      this.state = fresh(today);
      this.opts.store?.save(this.state);
    }
  }
}
