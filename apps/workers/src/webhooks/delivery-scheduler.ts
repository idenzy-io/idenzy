/**
 * How a later attempt is armed.
 *
 * The port exists because the two ways of getting back to a delivery are not alternatives: they are
 * a fast path and a durable one (ADR-0012). Cloud Tasks holds a `scheduleTime` and calls the
 * dispatcher at it, which is how a retry lands within a second of when it is due. The sweeper finds
 * whatever is due by reading the table, which is how a delivery whose task was never created, or
 * whose dispatcher died holding it, still goes out.
 *
 * The durable one is the one that has to exist, so it is the one that ships first and the one every
 * environment has. A scheduler is an optimisation on top of it, and an implementation that schedules
 * nothing is therefore correct rather than a stub — it costs latency, not deliveries.
 */
export abstract class DeliveryScheduler {
  /**
   * Arms an attempt for this delivery at that time, if it can.
   *
   * Failure is swallowed by the caller on purpose: the delivery row already says when it is next
   * due, so a scheduler that could not be reached delays the attempt to the next sweep rather than
   * losing it. Throwing here would turn a queue outage into a failed delivery.
   */
  abstract schedule(
    delivery: { readonly id: string; readonly projectId: string },
    at: Date,
  ): Promise<void>;
}

/**
 * The scheduler for every environment that has no queue: the sweeper is the timer.
 *
 * Named for what it relies on rather than called a no-op, because that is the difference that
 * matters — the attempt happens, on the sweeper's interval rather than to the second.
 *
 * The Cloud Tasks implementation belongs beside this one and is deliberately not written yet: it
 * needs a queue, a service account and an OIDC audience that exist in Terraform first, and an SDK
 * dependency that would be added for code no test here could run (PROJECT.md 7.6). What it will do
 * is exactly this signature: create one task per attempt with `scheduleTime` set to `at`, targeting
 * the dispatcher's own authenticated endpoint.
 */
export class SweepingScheduler extends DeliveryScheduler {
  schedule(): Promise<void> {
    return Promise.resolve();
  }
}
