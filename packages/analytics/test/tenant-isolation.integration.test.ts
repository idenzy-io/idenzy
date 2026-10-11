import { AnalyticsUnavailableError } from "@idenzy/core/errors";
import { ClickHouseHarness } from "@idenzy/testing/clickhouse-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseClient, TENANT_SETTING } from "../src/client/clickhouse-client.js";
import { migrateAnalytics } from "../src/migrate.js";
import { ANALYTICS_TABLES } from "../src/schema/tables.js";

/**
 * ADR-0013's two lines, against a real ClickHouse.
 *
 * Nothing here is observable without the server. The first line is a client that has no unscoped
 * method, which a unit test can assert by reading the class; the second is a row policy, which is
 * a property of the database and of the privileges the runtime user holds. The cases worth
 * running are the ones where the first line has already failed — a query that names another
 * project explicitly, a tenant that was never set — because that is precisely when the second
 * line is the only thing left.
 */

const harness = new ClickHouseHarness();
const DATABASE = "idenzy_analytics";
const APP_USER = "idenzy_app";
const INGEST_USER = "idenzy_ingest";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

let owner: ClickHouseClient;
let app: ClickHouseClient;
let ingest: ClickHouseClient;

interface EventRow {
  readonly project_id: string;
  readonly event: string;
}

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
  await harness.start();
  const shared = { database: DATABASE, password: "idenzy" };
  owner = new ClickHouseClient({ ...shared, url: harness.url, user: "idenzy_owner" });
  app = new ClickHouseClient({ ...shared, url: harness.url, user: APP_USER });
  ingest = new ClickHouseClient({ ...shared, url: harness.url, user: INGEST_USER });

  await migrateAnalytics(owner, {
    database: DATABASE,
    appUser: APP_USER,
    ingestUser: INGEST_USER,
    eraserUser: "idenzy_eraser",
  });

  // One batch, many projects, which is the shape the queue drains and the reason the writer is
  // not tenant-scoped.
  await ingest.insertBatch("auth_events", [
    { ...event("2026-03-01 09:00:00.000", "session.created"), project_id: A },
    { ...event("2026-03-01 10:00:00.000", "user.created"), project_id: A },
    { ...event("2026-03-01 09:00:00.000", "session.created"), project_id: B },
  ]);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the analytics store's tenant isolation", () => {
  it("gives a scoped reader its own project and nothing else", async () => {
    const rows = await app.query<EventRow>(A, {
      sql: `SELECT project_id, event FROM ${DATABASE}.auth_events ORDER BY event`,
    });
    expect(rows.map((row) => row.event)).toEqual(["session.created", "user.created"]);
    expect(new Set(rows.map((row) => row.project_id))).toEqual(new Set([A]));
  });

  /* The case the policy exists for: the first line has failed and a predicate names somebody
     else's project outright. The policy ANDs, so it cannot be widened by anything the query says. */
  it("reads nothing when a query asks for another project while scoped to its own", async () => {
    const rows = await app.query<{ n: string }>(A, {
      sql: `SELECT count() AS n FROM ${DATABASE}.auth_events WHERE project_id = {other:UUID}`,
      params: { other: B },
    });
    expect(rows[0]?.n).toBe("0");
  });

  it("reads nothing at all when no tenant was set", async () => {
    const url = new globalThis.URL(harness.url);
    url.searchParams.set("database", DATABASE);
    const response = await fetch(url, {
      method: "POST",
      body: `SELECT count() FROM ${DATABASE}.auth_events`,
      headers: { "X-ClickHouse-User": APP_USER, "X-ClickHouse-Key": "idenzy" },
    });
    expect((await response.text()).trim()).toBe("0");
  });

  /**
   * The finding that decided the privilege split, asserted so it cannot quietly come back.
   *
   * A ClickHouse row policy filters reads and — unlike a Postgres `WITH CHECK` clause — does not
   * constrain writes at all. A reader holding INSERT could therefore plant a row under another
   * project and the policy would serve it to them faithfully afterwards. Taking the verb away is
   * the whole mitigation, so this asserts the verb is gone rather than asserting the policy
   * catches it, which it does not.
   */
  it("refuses the reading identity any write at all", async () => {
    await expect(
      app.insertBatch("auth_events", [
        { ...event("2026-03-09 09:00:00.000", "session.created"), project_id: B },
      ]),
    ).rejects.toThrow(AnalyticsUnavailableError);
  });

  it("refuses the writing identity any read at all", async () => {
    await expect(
      ingest.query(A, { sql: `SELECT count() FROM ${DATABASE}.auth_events` }),
    ).rejects.toThrow(AnalyticsUnavailableError);
  });

  it("refuses the runtime user the privileges that would undo the policy", async () => {
    await expect(
      app.execute(`DROP ROW POLICY auth_events_tenant ON ${DATABASE}.auth_events`),
    ).rejects.toThrow(AnalyticsUnavailableError);
    await expect(
      app.execute(`CREATE TABLE ${DATABASE}.sneaky (x UInt8) ENGINE = Memory`),
    ).rejects.toThrow(AnalyticsUnavailableError);
  });

  /**
   * The one failure this design has: a table created without its policy is readable across every
   * project and nothing errors. So it is asserted against the server rather than against the
   * migrator that was supposed to have created them.
   */
  it("has a row policy on every table it created", async () => {
    const policies = await owner.query<{ table: string }>(A, {
      sql: `SELECT table FROM system.row_policies WHERE database = {db:String}`,
      params: { db: DATABASE },
    });
    expect(new Set(policies.map((row) => row.table))).toEqual(
      new Set(ANALYTICS_TABLES.map((table) => table.name)),
    );
  });

  it("ages rows out by dropping parts rather than rewriting the table", async () => {
    const settings = await owner.query<{ create_table_query: string }>(A, {
      sql: `SELECT create_table_query FROM system.tables WHERE database = {db:String} AND name = 'auth_events'`,
      params: { db: DATABASE },
    });
    expect(settings[0]?.create_table_query).toContain("TTL toDateTime(at) + toIntervalYear(1)");
    expect(settings[0]?.create_table_query).toContain("ttl_only_drop_parts = 1");
  });

  /* `select_filter` and not `condition`: the column is named for what it is, a filter ANDed into
     every read, which is also why a query cannot widen it. */
  it("names the tenant setting the policies actually compare", async () => {
    const policies = await owner.query<{ select_filter: string }>(A, {
      sql: `SELECT select_filter FROM system.row_policies WHERE database = {db:String} AND table = 'auth_events'`,
      params: { db: DATABASE },
    });
    expect(policies[0]?.select_filter).toContain(TENANT_SETTING);
  });
});
