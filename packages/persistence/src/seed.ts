import { randomUUID } from "node:crypto";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ApiKeyPrefix } from "@idenzy/protocol/schemas/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { orgs } from "./schema/organisation.js";
import { apiKeys, projects } from "./schema/projects.js";

/**
 * What a local database needs before anything can happen in it.
 *
 * One thing: Idenzy's own dashboard project, which is the bootstrap. We run the panel on our
 * own product (PROJECT.md 9.5), so the panel cannot sign anybody in until the project it
 * signs them in to already exists, and that project cannot be created through the panel.
 *
 * **Development only, and it refuses to run anywhere else.** The ids below are fixed so
 * `.env.example` can carry them, and a fixed identifier is exactly what must never reach a
 * real deployment. In production the same three rows are provisioning's job, with generated
 * ids and the origin and auth domain that go with them:
 *
 *   orgs                Idenzy
 *   projects            Dashboard
 *   api_keys            one publishable key, shown once
 *   project_domains     auth.idenzy.io, type `auth`, verified — cookie mode needs it
 *   project_origins     https://app.idenzy.io
 *
 * The last two are absent here on purpose rather than forgotten. Outside production the
 * transport guard skips its eligibility check and the CORS policy allows loopback as code
 * rather than as data, so seeding either would be a row that changes nothing locally and
 * misleads whoever reads it into thinking it is what makes development work.
 *
 * Runs as `idenzy_app` with the tenant keys bound, which is the same path the management
 * API takes rather than a privileged shortcut. If provisioning is ever refused by a policy,
 * it is refused here too, and finding that out on a laptop is the point.
 *
 * One of the files exempt from the noProcessEnv rule, like `migrate.ts` and for the same
 * reason: a standalone job that runs before the application exists to read config for it.
 *
 * Runs from `dist` rather than from source, unlike `migrate.ts`. That one imports nothing
 * of ours, so Node's type stripping never has to resolve a relative specifier; this one
 * uses the schema, and `./schema/organisation.js` does not exist until `tsc` has written it.
 * Build first — `pnpm turbo run build --filter @idenzy/persistence`.
 */

/**
 * Fixed so `.env.example` can name them, and obviously a fixture rather than something
 * random that happened once. `DASHBOARD_PROJECT_ID` is the public form of the second.
 */
const IDENZY_ORG_ID = "00000000-0000-4000-8000-000000000001";
const DASHBOARD_PROJECT_ID = "00000000-0000-4000-8000-000000000002";

async function main(): Promise<void> {
  const environment = process.env["IDENZY_ENV"] ?? "development";
  if (environment !== "development") {
    process.stderr.write(
      `Refusing to seed: IDENZY_ENV is "${environment}". This writes fixed identifiers and is for development only.\n`,
    );
    process.exit(1);
  }

  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    process.stderr.write("DATABASE_MIGRATION_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // The runtime role, not the owner. Seeding as a superuser would bypass every policy
    // and prove nothing about whether the application can do this.
    await client.query("SET ROLE idenzy_app");
    const db = drizzle(client);

    await seedDashboard(client, db);
    process.stdout.write("seed complete\n");
  } finally {
    await client.end();
  }
}

/**
 * Idenzy's own organisation, its dashboard project, and one publishable key for the panel.
 *
 * Every statement runs with `app.org_id` and `app.project_id` bound to the ids being
 * created, which is what makes the inserts pass their own WITH CHECK clauses — the same
 * mechanism `UnitOfWork.provision` uses, and the reason neither needs a SECURITY DEFINER
 * function (ADR-0011).
 */
async function seedDashboard(client: pg.Client, db: NodePgDatabase): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.org_id', $1, true)", [IDENZY_ORG_ID]);
    await client.query("SELECT set_config('app.project_id', $1, true)", [DASHBOARD_PROJECT_ID]);

    const org = await db.select({ id: orgs.id }).from(orgs).limit(1);
    if (org.length === 0) {
      await db.insert(orgs).values({ id: IDENZY_ORG_ID, name: "Idenzy" });
      process.stdout.write("seeded organisation Idenzy\n");
    }

    const project = await db.select({ id: projects.id }).from(projects).limit(1);
    if (project.length === 0) {
      await db.insert(projects).values({
        id: DASHBOARD_PROJECT_ID,
        orgId: IDENZY_ORG_ID,
        name: "Dashboard",
        kmsKeyName: `projects/${DASHBOARD_PROJECT_ID}/keys/signing`,
      });
      process.stdout.write("seeded project Dashboard\n");
    }

    await mintPublishableKey(db);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * One publishable key, printed once and never again.
 *
 * Only the hash is stored, so this cannot show an existing key a second time — which is
 * the same promise the panel's own key screen makes, and worth meeting here rather than
 * quietly writing a fixed value that would then be the one key every developer shares.
 *
 * A publishable key is designed to sit in a browser bundle, so printing it to a terminal
 * is not a leak. The browser-facing header takes this prefix only, and a secret key in it
 * is refused before any lookup (PROJECT.md 4.3).
 */
async function mintPublishableKey(db: NodePgDatabase): Promise<void> {
  const existing = await db.select({ id: apiKeys.id }).from(apiKeys).limit(1);
  if (existing.length > 0) {
    process.stdout.write(
      "a publishable key already exists; only its hash is stored, so it cannot be shown again.\n" +
        "  Delete it and re-run to mint another: DELETE FROM api_keys;\n",
    );
    return;
  }

  // `pk_` and 32 random bytes — the same shape the management API mints, because a dev key
  // that parsed differently from a real one would hide exactly the bugs this seed is for. The
  // prefix column keeps enough to identify a key in a log line without being enough to use it.
  const head = ApiKeyPrefix.Publishable;
  const key = `${head}${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  await db.insert(apiKeys).values({
    projectId: DASHBOARD_PROJECT_ID,
    kind: ApiKeyKind.Publishable,
    prefix: key.slice(0, head.length + 8),
    hash: hashToken(key),
    scopes: [],
  });

  process.stdout.write(
    `\n  Publishable key for the dashboard project, shown once:\n\n    ${key}\n\n` +
      "  Put it in .env as NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY.\n\n",
  );
}

await main();
