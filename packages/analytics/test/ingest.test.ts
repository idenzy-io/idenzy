import { beforeEach, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "../src/client/clickhouse-client.js";
import { AnalyticsIngestQueue, streamFor } from "../src/ingest/analytics-ingest-queue.js";
import {
  AnalyticsIngestWorker,
  deadLetterStreamFor,
} from "../src/ingest/analytics-ingest-worker.js";
import { CapturingLogger, FixedClock, InMemoryStreams } from "./fakes.js";

const TABLE = "auth_events";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

/** Records what it was asked to write, and can be told to refuse. */
class RecordingClickHouse {
  readonly batches: { table: string; rows: readonly Readonly<Record<string, unknown>>[] }[] = [];
  refuse: Error | null = null;

  insertBatch(table: string, rows: readonly Readonly<Record<string, unknown>>[]): Promise<void> {
    if (this.refuse !== null) return Promise.reject(this.refuse);
    this.batches.push({ table, rows });
    return Promise.resolve();
  }
}

let streams: InMemoryStreams;
let clickhouse: RecordingClickHouse;
let logger: CapturingLogger;
let queue: AnalyticsIngestQueue;

function workerWith(options = {}): AnalyticsIngestWorker {
  return new AnalyticsIngestWorker(
    streams,
    clickhouse as unknown as ClickHouseClient,
    new FixedClock(),
    logger,
    // Zero, so the fake re-delivers whatever is pending on the next pass. In production this is a
    // minute: long enough that two workers do not both claim a batch one of them is still writing.
    { claimAfterMs: 0, ...options },
  );
}

async function enqueue(projectId: string, event: string): Promise<void> {
  await queue.enqueue({ table: TABLE, projectId, row: { event, at: "2026-03-04 12:00:00.000" } });
}

beforeEach(() => {
  streams = new InMemoryStreams();
  clickhouse = new RecordingClickHouse();
  logger = new CapturingLogger();
  queue = new AnalyticsIngestQueue(streams, logger);
});

describe("queuing an analytics event", () => {
  it("never throws when the queue is unreachable, and says one was dropped", async () => {
    streams.failWrites = true;
    await expect(enqueue(A, "session.created")).resolves.toBeUndefined;

    expect(await queue.enqueue({ table: TABLE, projectId: A, row: {} })).toBe(false);
    expect(logger.of("analytics event dropped")?.fields).toMatchObject({
      outcome: "dropped",
      table: TABLE,
    });
  });

  it("puts one stream behind each table, so a batch needs no grouping", async () => {
    await enqueue(A, "session.created");
    expect(streams.contents(streamFor(TABLE))).toHaveLength(1);
    expect(await queue.depth(TABLE)).toBe(1);
  });
});

describe("draining the queue into ClickHouse", () => {
  /* The whole reason any of this exists: many small writes become one large one. */
  it("inserts everything waiting as a single batch", async () => {
    await enqueue(A, "session.created");
    await enqueue(B, "user.created");
    await enqueue(A, "session.created");

    const pass = await workerWith().drain(TABLE, "worker-1");

    expect(clickhouse.batches).toHaveLength(1);
    expect(clickhouse.batches[0]?.rows).toHaveLength(3);
    expect(pass).toMatchObject({ inserted: 3, deadLettered: 0, pending: 0 });
  });

  it("carries the tenant each row was stamped with at enqueue", async () => {
    await enqueue(A, "session.created");
    await enqueue(B, "user.created");

    await workerWith().drain(TABLE, "worker-1");

    expect(clickhouse.batches[0]?.rows.map((row) => row["project_id"])).toEqual([A, B]);
  });

  it("logs what it did, because nobody is watching a terminal", async () => {
    await enqueue(A, "session.created");
    await workerWith().drain(TABLE, "worker-1");

    expect(logger.of("analytics batch inserted")?.fields).toMatchObject({
      component: "analytics",
      outcome: "inserted",
      table: TABLE,
      count: 1,
      pending: 0,
    });
  });

  it("takes the queue down to nothing, rather than leaving what it wrote behind", async () => {
    await enqueue(A, "session.created");
    await workerWith().drain(TABLE, "worker-1");
    expect(await queue.depth(TABLE)).toBe(0);
  });
});

describe("when ClickHouse will not take the batch", () => {
  beforeEach(async () => {
    await enqueue(A, "session.created");
    clickhouse.refuse = new Error("TOO_MANY_PARTS");
  });

  /* The common failure is a store that is down, and those entries must simply come back. */
  it("keeps the entries and says it is retrying", async () => {
    const pass = await workerWith().drain(TABLE, "worker-1");

    expect(pass).toMatchObject({ inserted: 0, deadLettered: 0, pending: 1 });
    expect(logger.of("analytics batch insert failed")?.fields).toMatchObject({
      outcome: "retrying",
      table: TABLE,
      count: 1,
    });
  });

  it("inserts them once the store comes back", async () => {
    const worker = workerWith();
    await worker.drain(TABLE, "worker-1");
    clickhouse.refuse = null;

    const pass = await worker.drain(TABLE, "worker-1");
    expect(pass.inserted).toBe(1);
    expect(clickhouse.batches[0]?.rows).toHaveLength(1);
  });

  /**
   * The other kind of failure, and the reason for a dead letter at all.
   *
   * A row ClickHouse will never accept fails its batch forever and blocks every healthy row queued
   * behind it. After enough attempts it is set aside so the queue can move.
   */
  it("sets an entry aside once it has been tried too often, and keeps it", async () => {
    const worker = workerWith({ maxAttempts: 3 });
    // Two passes leave it on its second delivery; the third is the one that reaches the limit.
    for (let attempt = 0; attempt < 2; attempt += 1) await worker.drain(TABLE, "worker-1");

    const pass = await worker.drain(TABLE, "worker-1");
    expect(pass.deadLettered).toBe(1);
    expect(pass.pending).toBe(0);
    expect(streams.contents(deadLetterStreamFor(TABLE))).toHaveLength(1);
    // The last of the three, because the two before it are the retries that led here.
    expect(logger.lastOf("analytics batch insert failed")?.fields).toMatchObject({
      outcome: "dead_lettered",
      failures: 1,
    });
  });

  it("stops blocking the entries behind it once it has been set aside", async () => {
    const worker = workerWith({ maxAttempts: 2 });
    await worker.drain(TABLE, "worker-1");
    await worker.drain(TABLE, "worker-1");

    await enqueue(B, "user.created");
    clickhouse.refuse = null;

    const pass = await worker.drain(TABLE, "worker-1");
    expect(pass.inserted).toBe(1);
    expect(clickhouse.batches[0]?.rows[0]?.["project_id"]).toBe(B);
  });
});

describe("a worker that died mid-batch", () => {
  /* An entry stays pending until it is acknowledged, which is the difference between
     at-least-once and a list that hands a batch over and forgets it. */
  it("has its entries picked up by the next one", async () => {
    await enqueue(A, "session.created");
    clickhouse.refuse = new Error("connection reset");
    await workerWith().drain(TABLE, "worker-1");

    clickhouse.refuse = null;
    const pass = await workerWith().drain(TABLE, "worker-2");

    expect(pass.inserted).toBe(1);
  });
});
