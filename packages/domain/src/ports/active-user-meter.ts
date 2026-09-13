import type { Clock } from "@idenzy/core/time/clock";
import type { User } from "../entities/user.js";

/** `YYYY-MM-DD` in UTC. A billing period has to be somebody's day, and ours is the column's. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * What counts as a monthly active user, and the only place that decides (PROJECT.md 5.1).
 *
 * The definition is two exclusions on top of "authenticated at least once", and both of them
 * have to be applied here, at the moment of the authentication, because neither survives into
 * what is stored: the sketch behind this holds no dates and no identities to filter on later.
 *
 * **First-day-free.** An account is not billed on the day it was created, so somebody who signs
 * up, looks around and never returns is free. That is Clerk's idea and it is worth copying:
 * the alternative charges a customer for every abandoned sign-up, which is the one number their
 * marketing spend moves directly.
 *
 * **Anonymous until upgraded.** An anonymous account is a cart or a draft, not a user, and
 * counting it would bill a customer for traffic rather than for people.
 *
 * The base owns both, and a subclass supplies only where the record goes, so a second meter —
 * the analytics store is the one coming — cannot answer a different number from the invoice.
 */
export abstract class ActiveUserMeter {
  protected constructor(protected readonly clock: Clock) {}

  /**
   * Template method: what is billable is inherited, never re-decided per call site.
   *
   * The instant is the meter's own rather than the caller's, because the two things calling it
   * hold different times to hand — a session's expiry, a rotation's `now` — and the difference
   * between them is which UTC day a midnight sign-in is billed in.
   */
  async mark(projectId: string, user: User): Promise<void> {
    const at = this.clock.now();
    if (user.isAnonymous()) return;
    if (utcDay(user.createdAt) === utcDay(at)) return;
    await this.record(projectId, user.id, at);
  }

  protected abstract record(projectId: string, userId: string, at: Date): Promise<void>;
}
