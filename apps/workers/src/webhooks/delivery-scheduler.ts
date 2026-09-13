/** The bit of a delivery a timer needs: which one, whose, and which endpoint it is for. */
export interface ScheduledDelivery {
  readonly id: string;
  readonly projectId: string;
  /**
   * The endpoint, which is what a sharded queue pool is keyed on (ADR-0012).
   *
   * Sharding by endpoint rather than by delivery is the whole point: one endpoint's retries land in
   * one queue and are bounded by that queue's dispatch rate, so a customer whose receiver is down
   * cannot spend the pool's capacity on behalf of everybody else.
   */
  readonly webhookId: string;
}

/**
 * How a later attempt is armed.
 *
 * The port exists because the two ways of getting back to a delivery are not alternatives: they are
 * a fast path and a durable one (ADR-0012). Cloud Tasks holds a `scheduleTime` and calls the
 * dispatcher at it, which is how a retry lands within a second of when it is due. The sweeper finds
 * whatever is due by reading the table, which is how a delivery whose task was never created, or
 * whose dispatcher died holding it, still goes out.
 *
 * The durable one is the one that has to exist, so it is the one every environment has. A scheduler
 * is an optimisation on top of it, and an implementation that schedules nothing is therefore correct
 * rather than a stub — it costs latency, not deliveries.
 */
export abstract class DeliveryScheduler {
  /**
   * Arms an attempt for this delivery at that time, if it can.
   *
   * Failure is swallowed by the caller on purpose: the delivery row already says when it is next
   * due, so a scheduler that could not be reached delays the attempt to the next sweep rather than
   * losing it. Throwing here would turn a queue outage into a failed delivery.
   */
  abstract schedule(delivery: ScheduledDelivery, at: Date): Promise<void>;
}

/**
 * The scheduler for every environment that has no queue: the sweeper is the timer.
 *
 * Named for what it relies on rather than called a no-op, because that is the difference that
 * matters — the attempt happens, on the sweeper's interval rather than to the second. Every
 * developer machine runs this one, and so does any deployment that has not been given a queue.
 */
export class SweepingScheduler extends DeliveryScheduler {
  schedule(): Promise<void> {
    return Promise.resolve();
  }
}
