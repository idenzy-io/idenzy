import type { ClickHouseClient } from "./client/clickhouse-client.js";
import { TENANT_SETTING } from "./client/clickhouse-client.js";
import { ANALYTICS_TABLES } from "./schema/tables.js";

export interface MigrateSettings {
  readonly database: string;
  /** The runtime identity every row policy is attached to. */
  readonly appUser: string;
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
  // The runtime user's access travels with the database rather than being a provisioning step
  // somebody repeats. Forgetting it is the Postgres trap in the other direction: there a missing
  // grant makes a table unreadable, which is loud; here a missing *policy* makes it readable by
  // everyone, which is not — so the two statements that matter are issued together, below.
  await client.execute(`GRANT SELECT, INSERT ON ${settings.database}.* TO ${settings.appUser}`);

  for (const table of ANALYTICS_TABLES) {
    await client.execute(table.createTable(settings.database));
    await client.execute(
      table.createRowPolicy(settings.database, settings.appUser, TENANT_SETTING),
    );
  }

  return { tables: ANALYTICS_TABLES.map((table) => table.name) };
}
