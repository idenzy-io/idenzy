import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Applies every migration this package ships, over one connection.
 *
 * The connection is the schema owner's (`idenzy_owner`, or a login whose default role is it), never
 * the runtime role's: the migrations create what the runtime role is then granted one verb at a
 * time. Forward-only: a mistake is corrected by a new migration rather than by rewinding a live
 * auth database.
 */
export async function applyMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    await migrate(drizzle(client), { migrationsFolder: join(here, "..", "drizzle") });
  } finally {
    await client.end();
  }
}
