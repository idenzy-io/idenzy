import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type { ClickHouseClient } from "../client/clickhouse-client.js";
import { ANALYTICS_TABLES } from "../schema/tables.js";
import { streamFor } from "./analytics-ingest-queue.js";
import type { StreamCommands, StreamEntry } from "./stream-commands.js";

export interface IngestWorkerOptions {
  /**
   * Rows per INSERT.
   *
   * ClickHouse's own guidance is at least a thousand rows per insert and no more than one insert
   * per second per table, which is the same number said twice: a part per insert, and merges that
   * cannot keep up with a writer producing them faster. Larger is better here until a batch stops
   * fitting comfortably in memory.
   */
  readonly batchSize?: number;
  /**
   * How long between passes.
   *
   * A second, which is the other half of ClickHouse's guidance: at least a thousand rows per
   * insert and at most one insert per second per table. A shorter interval does not make anything
   * more current — it makes the batches smaller, which is the failure this worker exists to
   * prevent.
   */
  readonly idleMs?: number;
  /**
   * Passes to run back-to-back while a backlog is clearing.
   *
   * A pass that filled its batch almost certainly has more waiting, and sleeping a second between
   * each would mean a queue that built up over an outage drains at `batchSize` per second forever.
   * Bounded so one busy table cannot starve the others in the same tick.
   */
  readonly maxPassesPerTick?: number;
  /**
   * How long an unacknowledged entry sits before another worker may claim it.
   *
   * Longer than a batch takes, or two workers end up inserting the same rows — which is not a
   * correctness problem here (ClickHouse has no unique constraint to violate) but is a duplicated
   * row in somebody's chart.
   */
  readonly claimAfterMs?: number;
  /**
   * Attempts before an entry is set aside.
   *
   * A batch that fails is almost always a store that is down, and those entries come back on the
   * next pass. What this catches is the other kind: a row ClickHouse will never accept — a column
   * that changed type, a value that will not parse — which would otherwise fail its batch forever
   * and take every healthy row queued behind it down with it.
   */
  readonly maxAttempts?: number;
}

const DEFAULT_BATCH = 5_000;
const DEFAULT_IDLE_MS = 1_000;
const DEFAULT_CLAIM_AFTER_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_PASSES = 20;
const GROUP = "ingest";

/** Where entries go when they cannot be inserted. Read by a human, never by this. */
export function deadLetterStreamFor(table: string): string {
  return `analytics:dead:${table}`;
}

/** What one pass did, which is what the log line reports and what a test asserts. */
export interface IngestPass {
  readonly inserted: number;
  readonly deadLettered: number;
  readonly pending: number;
}

/**
 * Drains the ingest queue into ClickHouse in batches (ADR-0013, todo.md 3.2).
 *
 * The whole reason it exists is that ClickHouse wants few large writes and an API produces many
 * small ones. Everything else follows from that: it reads up to a batch at a time, inserts once,
 * and only then acknowledges — so a crash between the insert and the acknowledgement replays the
 * batch rather than losing it. ClickHouse has no unique constraint to violate, so a replay shows
 * up as duplicated rows in a chart, which is the cheaper of the two failures by a distance.
 *
 * **At-least-once, and the consumer group is what makes it so.** An entry stays pending until it
 * is acknowledged, and `XAUTOCLAIM` is how this worker picks up what a dead one was carrying. A
 * list with `LPOP` would have handed the batch over and forgotten it.
 *
 * A batch that will not insert is retried, and after `maxAttempts` its entries are moved to a
 * dead-letter stream and acknowledged. That is not for the common failure — a store that is down
 * comes back and so do its entries — but for the one that never resolves: a row ClickHouse will
 * never accept, failing its batch forever and blocking every healthy row queued behind it.
 *
 * Every pass that does anything logs what it did, because this runs where nobody is watching a
 * terminal: rows inserted, how long it took, and what is still waiting.
 */
export class AnalyticsIngestWorker {
  private readonly started = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly commands: StreamCommands,
    private readonly clickhouse: ClickHouseClient,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: IngestWorkerOptions = {},
  ) {}

  async start(consumer: string): Promise<void> {
    await this.sweep(consumer);
    this.timer = setInterval(() => {
      // Caught here and not only inside: `sweep` rethrows what its stream commands throw, and a
      // rejection with nobody listening takes the whole worker process down — every sweeper
      // and the billing tick with it — over one Valkey command that took longer than 250ms.
      this.sweep(consumer).catch((cause: unknown) => {
        this.logger.warn("analytics ingest deferred", {
          component: "analytics",
          outcome: "deferred",
          errorName: cause instanceof Error ? cause.name : "unknown",
        });
      });
    }, this.options.idleMs ?? DEFAULT_IDLE_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One tick: every table, and each one again while it keeps filling its batch.
   *
   * Guarded against overlapping itself, because a tick that runs long — a large backlog, a slow
   * store — would otherwise have the next one join it, and two consumers of the same group racing
   * is how the same rows get claimed twice.
   */
  async sweep(consumer: string): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const batch = this.options.batchSize ?? DEFAULT_BATCH;
      const maxPasses = this.options.maxPassesPerTick ?? DEFAULT_MAX_PASSES;
      let inserted = 0;
      for (const table of ANALYTICS_TABLES) {
        for (let pass = 0; pass < maxPasses; pass += 1) {
          const result = await this.drain(table.name, consumer);
          inserted += result.inserted;
          if (result.inserted < batch) break;
        }
      }
      return inserted;
    } finally {
      this.running = false;
    }
  }

  /** One pass over one table. Answers what it did, so a caller can decide whether to wait. */
  async drain(table: string, consumer: string): Promise<IngestPass> {
    const stream = streamFor(table);
    await this.ensureGroup(stream);

    const entries = [
      ...(await this.reclaim(stream, consumer)),
      ...(await this.read(stream, consumer)),
    ];
    if (entries.length === 0) {
      return { inserted: 0, deadLettered: 0, pending: await this.commands.xlen(stream) };
    }

    const startedAt = this.clock.now().getTime();
    const rows = entries.map(([, fields]) => rowOf(fields)).filter((row) => row !== null);

    try {
      await this.clickhouse.insertBatch(table, rows);
    } catch (error) {
      return await this.failed(stream, table, entries, error);
    }

    const ids = entries.map(([id]) => id);
    await this.commands.xack(stream, GROUP, ...ids);
    // Acknowledged *and* deleted: an acknowledged entry still occupies the stream, and this one
    // has been written somewhere durable. The MAXLEN cap would eventually evict it, but only
    // after it had pushed something newer out.
    await this.commands.xdel(stream, ...ids);

    const pending = await this.commands.xlen(stream);
    this.logger.info("analytics batch inserted", {
      component: "analytics",
      outcome: "inserted",
      table,
      count: rows.length,
      pending,
      durationMs: this.clock.now().getTime() - startedAt,
    });
    return { inserted: rows.length, deadLettered: 0, pending };
  }

  /**
   * A batch that would not insert.
   *
   * Entries that have been tried too often are set aside and acknowledged; the rest are simply
   * left pending, which is the retry — `XAUTOCLAIM` brings them back on a later pass with their
   * delivery count one higher. Nothing sleeps or backs off in here: the pass interval is the
   * backoff, and a store that is down is not helped by a worker spinning.
   */
  private async failed(
    stream: string,
    table: string,
    entries: readonly StreamEntry[],
    error: unknown,
  ): Promise<IngestPass> {
    const exhausted = await this.exhausted(stream, entries);
    for (const [id, fields] of entries) {
      if (!exhausted.has(id)) continue;
      await this.commands.xadd(deadLetterStreamFor(table), "MAXLEN", "~", 10_000, "*", ...fields);
      await this.commands.xack(stream, GROUP, id);
      await this.commands.xdel(stream, id);
    }

    const pending = await this.commands.xlen(stream);
    this.logger.error("analytics batch insert failed", {
      component: "analytics",
      outcome: exhausted.size > 0 ? "dead_lettered" : "retrying",
      table,
      count: entries.length,
      failures: exhausted.size,
      pending,
      errorCode: errorCodeOf(error),
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { inserted: 0, deadLettered: exhausted.size, pending };
  }

  /** Which of these entries have been delivered too many times to be worth another try. */
  private async exhausted(
    stream: string,
    entries: readonly StreamEntry[],
  ): Promise<ReadonlySet<string>> {
    const limit = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const pending = await this.commands.xpending(
      stream,
      GROUP,
      "IDLE",
      0,
      "-",
      "+",
      entries.length,
    );
    return new Set(pending.filter(([, , , deliveries]) => deliveries >= limit).map(([id]) => id));
  }

  private async read(stream: string, consumer: string): Promise<readonly StreamEntry[]> {
    const read = await this.commands.xreadgroup(
      "GROUP",
      GROUP,
      consumer,
      "COUNT",
      this.options.batchSize ?? DEFAULT_BATCH,
      "STREAMS",
      stream,
      ">",
    );
    return read?.[0]?.[1] ?? [];
  }

  /** What a worker that died was holding. Oldest first, so nothing starves behind a stuck batch. */
  private async reclaim(stream: string, consumer: string): Promise<readonly StreamEntry[]> {
    const [, entries] = await this.commands.xautoclaim(
      stream,
      GROUP,
      consumer,
      this.options.claimAfterMs ?? DEFAULT_CLAIM_AFTER_MS,
      "0-0",
      "COUNT",
      this.options.batchSize ?? DEFAULT_BATCH,
    );
    return entries;
  }

  /**
   * Creates the consumer group, once per stream per process.
   *
   * `MKSTREAM` so a worker that starts before anything has been produced does not fail, and the
   * BUSYGROUP error is swallowed because "it already exists" is the normal answer on every boot
   * after the first.
   */
  private async ensureGroup(stream: string): Promise<void> {
    if (this.started.has(stream)) return;
    try {
      await this.commands.xgroup("CREATE", stream, GROUP, "0", "MKSTREAM");
    } catch (error) {
      if (!String(error).includes("BUSYGROUP")) throw error;
    }
    this.started.add(stream);
  }
}

/** The row an entry carries, or null for one this cannot read — which is a bug, not an attack. */
function rowOf(fields: readonly string[]): Readonly<Record<string, unknown>> | null {
  const index = fields.indexOf("row");
  const raw = index === -1 ? undefined : fields[index + 1];
  const projectIndex = fields.indexOf("project_id");
  const projectId = projectIndex === -1 ? undefined : fields[projectIndex + 1];
  if (raw === undefined || projectId === undefined) return null;
  try {
    return { ...(JSON.parse(raw) as Record<string, unknown>), project_id: projectId };
  } catch {
    return null;
  }
}

function errorCodeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "unknown";
}
