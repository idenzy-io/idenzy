import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { regionCells } from "./schema/control-plane.js";

/**
 * The rows a local database needs before anything can be created in it.
 *
 * Only `region_cells`, and only in development. A cell is a real regional stack with its
 * own Cloud SQL, its own KMS key ring and its own endpoint; in production it is created
 * by Terraform when the stack is, and a migration that inserted one would be claiming
 * infrastructure exists because a row does. Locally there is no Terraform and nothing can
 * be provisioned without at least one, so this stands in.
 *
 * Idempotent by code, so running it twice is a no-op and running it after a schema change
 * costs nothing.
 *
 * One of the files exempt from the noProcessEnv rule, like `migrate.ts` and for the same
 * reason: a standalone job that runs before the application exists to read config for it.
 *
 * Runs from `dist` rather than from source, unlike `migrate.ts`. That one imports nothing
 * of ours, so Node's type stripping never has to resolve a relative specifier; this one
 * uses the schema, and `./schema/control-plane.js` does not exist until `tsc` has written
 * it. Build first — `pnpm turbo run build --filter @idenzy/persistence`.
 */
const CELLS = [
  {
    code: "eu-west-1",
    jurisdiction: "European Union",
    endpoint: "https://eu.idenzy.dev",
    kmsKeyRing: "idenzy-eu-west-1",
  },
  {
    code: "us-east-1",
    jurisdiction: "United States",
    endpoint: "https://us.idenzy.dev",
    kmsKeyRing: "idenzy-us-east-1",
  },
] as const;

async function main(): Promise<void> {
  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    process.stderr.write("DATABASE_MIGRATION_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const db = drizzle(client);
    for (const cell of CELLS) {
      const existing = await db
        .select({ id: regionCells.id })
        .from(regionCells)
        .where(eq(regionCells.code, cell.code))
        .limit(1);
      if (existing.length > 0) continue;
      await db.insert(regionCells).values(cell);
      process.stdout.write(`seeded region cell ${cell.code}\n`);
    }
    process.stdout.write("seed complete\n");
  } finally {
    await client.end();
  }
}

await main();
