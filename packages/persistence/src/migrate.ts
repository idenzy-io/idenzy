import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Applies migrations as `idenzy_owner`, not the runtime role.
 *
 * One of only two files exempt from the noProcessEnv rule: it is a standalone job that
 * runs before the application, and therefore before @idenzy/config exists to read for
 * it. The exemption is declared in biome.json, not suppressed inline.
 *
 * Run as a dedicated job before traffic shifts to a new revision (PROJECT.md 9.4).
 * Forward-only: there is no down migration, and a mistake is corrected by a new
 * migration rather than by rewinding a live auth database.
 */
async function main(): Promise<void> {
  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    process.stderr.write("DATABASE_MIGRATION_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: join(here, "..", "drizzle") });
    process.stdout.write("migrations applied\n");
  } finally {
    await client.end();
  }
}

await main();
