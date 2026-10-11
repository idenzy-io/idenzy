import { AnalyticsUnavailableError } from "@idenzy/core/errors";
import { ClickHouseHarness } from "@idenzy/testing/clickhouse-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseClient } from "../src/client/clickhouse-client.js";
import { AnalyticsEraser, ERASABLE_ANALYTICS_TABLES } from "../src/erasure/analytics-eraser.js";
import { migrateAnalytics } from "../src/migrate.js";

/**
 * An erasure in the analytics store, against a real ClickHouse.
 *
 * Two things only a server can answer: that the mutation removes the erased user's rows and
 * nobody else's — the pair, not the user id alone — and that the identity running it can do
 * nothing but that.
 */

const harness = new ClickHouseHarness();
const DATABASE = "idenzy_erasure";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const ERASED = "0191f3c2-9a4d-7b21-8c3e-000000000001";
const KEPT = "0191f3c2-9a4d-7b21-8c3e-000000000002";

let app: ClickHouseClient;
let eraser: ClickHouseClient;

function event(projectId: string, userId: string, at: string): Record<string, unknown> {
  return {
    project_id: projectId,
    at,
    event: "session.created",
    method: "magic_link",
    outcome: "succeeded",
    user_id: userId,
    session_id: "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6f",
    ip: "203.0.113.1",
    user_agent: "vitest",
    country: "GB",
  };
}

async function rowsOf(projectId: string, userId: string): Promise<number> {
  const rows = await app.query<{ n: string }>(projectId, {
    sql: `SELECT count() AS n FROM ${DATABASE}.auth_events WHERE user_id = {user:UUID}`,
    params: { user: userId },
  });
  return Number(rows[0]?.n ?? 0);
}

/** A mutation is asynchronous by design, so the test waits for it rather than racing it. */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

beforeAll(async () => {
  await harness.start();
  const shared = { database: DATABASE, password: "idenzy", url: harness.url };
  const owner = new ClickHouseClient({ ...shared, user: "idenzy_owner" });
  app = new ClickHouseClient({ ...shared, user: "idenzy_app" });
  eraser = new ClickHouseClient({ ...shared, user: "idenzy_eraser" });
  const ingest = new ClickHouseClient({ ...shared, user: "idenzy_ingest" });

  await migrateAnalytics(owner, {
    database: DATABASE,
    appUser: "idenzy_app",
    ingestUser: "idenzy_ingest",
    eraserUser: "idenzy_eraser",
  });
  // Two months, so the mutation has to reach more than one partition.
  await ingest.insertBatch("auth_events", [
    event(A, ERASED, "2026-03-01 09:00:00.000"),
    event(A, ERASED, "2026-04-01 09:00:00.000"),
    event(A, KEPT, "2026-04-01 10:00:00.000"),
    event(B, ERASED, "2026-04-01 11:00:00.000"),
  ]);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("erasing a user from the analytics store", () => {
  it("covers the table that keys events on a user", () => {
    expect(ERASABLE_ANALYTICS_TABLES.map((table) => table.name)).toEqual(["auth_events"]);
  });

  it("deletes the erased user's rows in that project and nothing else", async () => {
    await new AnalyticsEraser(eraser, DATABASE).erase([{ projectId: A, userId: ERASED }]);
    expect(await eventually(async () => (await rowsOf(A, ERASED)) === 0)).toBe(true);

    expect(await rowsOf(A, KEPT)).toBe(1);
    // The same id under another project is that project's row, and stays.
    expect(await rowsOf(B, ERASED)).toBe(1);
  });

  it("runs as an identity that can neither read nor write", async () => {
    await expect(
      eraser.query(A, { sql: `SELECT count() FROM ${DATABASE}.auth_events` }),
    ).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(
      eraser.insertBatch("auth_events", [event(A, KEPT, "2026-04-02 09:00:00.000")]),
    ).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });

  it("refuses an id that is not a uuid rather than writing it into a statement", async () => {
    await expect(
      new AnalyticsEraser(eraser, DATABASE).erase([{ projectId: A, userId: "x') OR 1=1 --" }]),
    ).rejects.toThrow();
  });
});
