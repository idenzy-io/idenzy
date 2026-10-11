import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { ClickHouseHarness } from "@idenzy/testing/clickhouse-harness";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseClient } from "../src/client/clickhouse-client.js";
import { AnalyticsIngestQueue, streamFor } from "../src/ingest/analytics-ingest-queue.js";
import { AnalyticsIngestWorker } from "../src/ingest/analytics-ingest-worker.js";
import type { StreamCommands } from "../src/ingest/stream-commands.js";
import { migrateAnalytics } from "../src/migrate.js";
import { CapturingLogger, FixedClock } from "./fakes.js";

/**
 * The whole pipeline, on the two servers it actually runs against.
 *
 * The unit suite covers what the worker decides; this covers what the unit suite cannot, which is
 * whether the commands are the commands. A consumer group, an autoclaim window, a `JSONEachRow`
 * body and a row policy are all shapes a fake agrees with by construction and a server does not.
 */

const clickhouse = new ClickHouseHarness();
const valkey = new ValkeyHarness();
const DATABASE = "idenzy_analytics";
const TABLE = "auth_events";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

let client: ValkeyClient;
let reader: ClickHouseClient;
let queue: AnalyticsIngestQueue;
let worker: AnalyticsIngestWorker;
let logger: CapturingLogger;

function event(at: string, name: string): Readonly<Record<string, unknown>> {
  return {
    at,
    event: name,
    method: "password",
    outcome: "succeeded",
    user_id: "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6e",
    session_id: "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6f",
    ip: "203.0.113.1",
    user_agent: "vitest",
    country: "GB",
  };
}

beforeAll(async () => {
  await Promise.all([clickhouse.start(), valkey.start()]);
  client = createValkeyClient({ url: valkey.url, onError: () => {} });
  logger = new CapturingLogger();

  const shared = { database: DATABASE, password: "idenzy" };
  const owner = new ClickHouseClient({ ...shared, url: clickhouse.url, user: "idenzy_owner" });
  await migrateAnalytics(owner, {
    database: DATABASE,
    appUser: "idenzy_app",
    ingestUser: "idenzy_ingest",
    eraserUser: "idenzy_eraser",
  });

  reader = new ClickHouseClient({ ...shared, url: clickhouse.url, user: "idenzy_app" });
  const writer = new ClickHouseClient({ ...shared, url: clickhouse.url, user: "idenzy_ingest" });

  queue = new AnalyticsIngestQueue(client as unknown as StreamCommands, logger);
  worker = new AnalyticsIngestWorker(
    client as unknown as StreamCommands,
    writer,
    new FixedClock(),
    logger,
    { claimAfterMs: 0 },
  );
}, 240_000);

afterAll(async () => {
  await client.quit();
  await Promise.all([clickhouse.stop(), valkey.stop()]);
});

/** ClickHouse merges parts asynchronously; a read straight after a write may not see them yet. */
async function countFor(projectId: string): Promise<number> {
  const rows = await reader.query<{ n: string }>(projectId, {
    sql: `SELECT count() AS n FROM ${DATABASE}.${TABLE}`,
  });
  return Number(rows[0]?.n ?? "0");
}

describe("the ingest pipeline end to end", () => {
  it("carries events from the queue into ClickHouse as one batch", async () => {
    await queue.enqueue({
      table: TABLE,
      projectId: A,
      row: event("2026-03-01 09:00:00.000", "session.created"),
    });
    await queue.enqueue({
      table: TABLE,
      projectId: A,
      row: event("2026-03-01 09:01:00.000", "user.created"),
    });
    await queue.enqueue({
      table: TABLE,
      projectId: B,
      row: event("2026-03-01 09:02:00.000", "session.created"),
    });

    expect(await queue.depth(TABLE)).toBe(3);

    const pass = await worker.drain(TABLE, "worker-1");

    expect(pass.inserted).toBe(3);
    expect(pass.pending).toBe(0);
    // One INSERT for three projects' worth of rows, which no tenant-scoped writer could have done.
    expect(logger.lastOf("analytics batch inserted")?.fields).toMatchObject({
      outcome: "inserted",
      table: TABLE,
      count: 3,
      pending: 0,
    });
  });

  /* The rows went in through one cross-tenant write and still read back scoped, which is the two
     halves of ADR-0013 meeting: the producer stamped the tenant, the policy filters on it. */
  it("still hands each project only its own rows afterwards", async () => {
    expect(await countFor(A)).toBe(2);
    expect(await countFor(B)).toBe(1);
  });

  it("leaves nothing behind in the stream it drained", async () => {
    const length = await client.xlen(streamFor(TABLE));
    expect(length).toBe(0);
  });

  /**
   * The property a list could not have given.
   *
   * An entry a worker took and never acknowledged stays pending, and another worker reclaims it —
   * so a process that dies between reading and inserting costs a duplicate at worst rather than
   * the batch it was holding.
   */
  it("reclaims what a worker took and never acknowledged", async () => {
    await queue.enqueue({
      table: TABLE,
      projectId: B,
      row: event("2026-03-02 09:00:00.000", "session.created"),
    });

    // Read as one consumer and simply never acknowledge, which is what a crash looks like.
    const taken = await client.xreadgroup(
      "GROUP",
      "ingest",
      "worker-dead",
      "COUNT",
      10,
      "STREAMS",
      streamFor(TABLE),
      ">",
    );
    expect(taken).not.toBeNull();

    const pass = await worker.drain(TABLE, "worker-2");
    expect(pass.inserted).toBe(1);
    expect(await countFor(B)).toBe(2);
  });
});
