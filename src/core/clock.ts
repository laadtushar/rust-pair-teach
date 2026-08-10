/**
 * Injectable time.
 *
 * Every heuristic in this product is temporal — diagnostic age, idle windows, churn windows,
 * cooldowns, and later the multi-day decay that drives spaced review. If any of them reached for
 * `Date.now()` directly, a 45-minute recorded session could not replay in milliseconds and a
 * two-week decay curve could not be tested at all.
 *
 * So time is a parameter everywhere. This is the decision the whole test strategy rests on.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Test double: time only moves when a test says so. */
export class FakeClock implements Clock {
  constructor(private t = 0) {}

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }

  set(ms: number): void {
    this.t = ms;
  }
}
