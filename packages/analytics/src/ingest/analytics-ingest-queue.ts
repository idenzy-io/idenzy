import type { Logger } from "@idenzy/core/logging/logger";
import type { StreamCommands } from "./stream-commands.js";

/** One row on its way to ClickHouse, with the tenant already decided. */
export interface AnalyticsEvent {
  readonly table: string;
  /**
   * The project the row belongs to.
   *
   * Stamped here, where a request still has its `TenantContext`, because nothing downstream can
   * work it out again: the worker drains one queue for the whole cell and the identity it writes
   * with is cross-tenant by design. This value is what binds the row to its project, and ADR-0013
   * says so rather than implying the database checks it.
   */
  readonly projectId: string;
  readonly row: Readonly<Record<string, unknown>>;
}

export interface IngestQueueOptions {
  /**
   * Roughly how many entries a stream may hold before the oldest are dropped.
   *
   * A cap and not a guarantee, because the alternative to dropping is unbounded memory in a cache
   * that also serves rate limits and the revocation set. If the worker is down long enough to
   * reach this, analytics loses its oldest events — which is the right direction for this store:
   * nothing here is billed from and the figures that are live in Postgres.
   */
  readonly maxLen?: number;
}

const DEFAULT_MAX_LEN = 1_000_000;

/** One stream per table, so a batch drained from it needs no grouping before it is inserted. */
export function streamFor(table: string): string {
  return `analytics:ingest:${table}`;
}

/**
 * Where an analytics event goes on the request path, which is to say: not to ClickHouse.
 *
 * ClickHouse is emphatically not a store you write to a row at a time — every INSERT creates a
 * part, and a writer that outruns the background merges is refused with `TOO_MANY_PARTS`, so the
 * naive path does not degrade under load, it stops. This queue is the thing that turns many small
 * writes into few large ones, and it is also what keeps the analytics store off the request path
 * entirely: an outage there must not be able to fail a sign-in.
 *
 * **Enqueuing never throws.** An event that cannot be queued is dropped and counted, because the
 * alternative is letting a cache hiccup surface on an authentication. That is the same trade
 * `RateLimitStrategy.check` makes and the opposite of the one the SMS spend cap makes, and the
 * reason is the same in all three: what is on the other side. Here it is a chart.
 */
export class AnalyticsIngestQueue {
  private readonly maxLen: number;

  constructor(
    private readonly commands: StreamCommands,
    private readonly logger: Logger,
    options: IngestQueueOptions = {},
  ) {
    this.maxLen = options.maxLen ?? DEFAULT_MAX_LEN;
  }

  /**
   * Queues one event. Fire and forget by design.
   *
   * The row travels as JSON in a single field rather than as flattened pairs, because the shape
   * that reaches ClickHouse is `JSONEachRow` anyway and flattening it here would mean parsing a
   * schema out of field names on the way back.
   */
  async enqueue(event: AnalyticsEvent): Promise<boolean> {
    try {
      await this.commands.xadd(
        streamFor(event.table),
        "MAXLEN",
        "~",
        this.maxLen,
        "*",
        "project_id",
        event.projectId,
        "row",
        JSON.stringify(event.row),
      );
      return true;
    } catch (error) {
      // Dropped rather than raised. Nothing on a request path may fail because a chart will be
      // missing a point, and there is no retry worth doing inline: the next event is a moment
      // away and the store this feeds is not one anybody is billed from.
      this.logger.warn("analytics event dropped", {
        component: "analytics",
        outcome: "dropped",
        table: event.table,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  /** How many entries are waiting, which is the figure the worker logs beside every batch. */
  depth(table: string): Promise<number> {
    return this.commands.xlen(streamFor(table));
  }

  /**
   * When the oldest entry still waiting was queued, or null when nothing is.
   *
   * The worker deletes what it has inserted (and what it sets aside), so the head of the stream
   * is the oldest row not yet in ClickHouse, and its id is the millisecond it was queued at.
   * Erasure waits on this: deleting a user's rows while one of theirs is still queued would let
   * that one arrive afterwards and outlive them.
   */
  async oldestQueuedAt(table: string): Promise<Date | null> {
    const [head] = await this.commands.xrange(streamFor(table), "-", "+", "COUNT", 1);
    if (head === undefined) return null;
    const ms = Number(head[0].split("-")[0]);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
}
