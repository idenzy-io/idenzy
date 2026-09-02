/**
 * Injectable time. Every expiry, TTL and rate-limit window reads from here, so tests
 * can advance time instead of sleeping, and so token lifetimes are testable at all.
 */
export abstract class Clock {
  abstract now(): Date;

  nowMs(): number {
    return this.now().getTime();
  }

  /** A Date `seconds` in the future. Used for every `expires_at` we write. */
  inSeconds(seconds: number): Date {
    return new Date(this.nowMs() + seconds * 1000);
  }

  hasPassed(instant: Date): boolean {
    return this.nowMs() >= instant.getTime();
  }
}

export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}
