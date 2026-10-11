import type { ClickHouseClient } from "./client/clickhouse-client.js";
import { TENANT_SETTING } from "./client/clickhouse-client.js";
import { ERASABLE_ANALYTICS_TABLES } from "./erasure/analytics-eraser.js";
import { ANALYTICS_TABLES } from "./schema/tables.js";

export interface MigrateSettings {
  readonly database: string;
  /** The reading identity every row policy is attached to. Holds SELECT and no INSERT. */
  readonly appUser: string;
  /** The pipeline's identity. Holds INSERT and no SELECT, and carries no policy. */
  readonly ingestUser: string;
  /** Granted ALTER DELETE on the tables an erasure removes rows from, and nothing else. */
  readonly eraserUser: string;
}

/** What one run created, for the log line that says whether anything changed. */
export interface MigrationResult {
  readonly tables: readonly string[];
}

/**
 * Creates the analytics tables and, in the same pass, the row policy each one needs.
 *
 * The two are deliberately not separable. A ClickHouse table with no policy is readable across
 * every project by the runtime user and nothing errors — it is the one failure mode ADR-0013 has,
 * and it looks exactly like a working deployment. So there is no "create the tables" step that
 * could be run on its own, and the test that matters sweeps `system.row_policies` rather than
 * trusting this function.
 *
 * Idempotent throughout: both statements are `IF NOT EXISTS`, so this runs on every boot of
 * whatever owns it rather than being a step somebody remembers.
 *
 * Run as the owner identity. The runtime user holds no DDL grant, which is the point.
 */
export async function migrateAnalytics(
  client: ClickHouseClient,
  settings: MigrateSettings,
): Promise<MigrationResult> {
  await client.execute(`CREATE DATABASE IF NOT EXISTS ${settings.database}`);
  // Access travels with the database rather than being a provisioning step somebody repeats, and
  // it is one verb each. The reader cannot write, because a row policy filters reads and does not
  // constrain writes — a tenant-scoped identity holding INSERT could plant a row under another
  // project and the policy would then serve it to them faithfully. The writer cannot read.
  await client.execute(`GRANT SELECT ON ${settings.database}.* TO ${settings.appUser}`);
  await client.execute(`GRANT INSERT ON ${settings.database}.* TO ${settings.ingestUser}`);

  for (const table of ANALYTICS_TABLES) {
    await client.execute(table.createTable(settings.database));
    await client.execute(
      table.createRowPolicy(settings.database, settings.appUser, TENANT_SETTING),
    );
  }
  // Per table rather than on the database, and after the tables exist, because a grant on a
  // table names it: the erasure identity can delete from what erasure deletes from and no more.
  for (const table of ERASABLE_ANALYTICS_TABLES) {
    await client.execute(
      `GRANT ALTER DELETE ON ${settings.database}.${table.name} TO ${settings.eraserUser}`,
    );
  }

  return { tables: ANALYTICS_TABLES.map((table) => table.name) };
}
