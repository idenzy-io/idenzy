import { randomUUID } from "node:crypto";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ApiKeyPrefix } from "@idenzy/protocol/schemas/common";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { orgs } from "./schema/organisation.js";
import { apiKeys, oauthProviders, projects, redirectUris } from "./schema/projects.js";

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
/** Idenzy's operator console (ADR-0018). `OPERATOR_PROJECT_ID` is its public form. */
const OPERATOR_PROJECT_ID = "00000000-0000-4000-8000-000000000003";
/** Where the operator console runs locally, and so where Google sign-in returns to. */
const OPERATOR_CONSOLE_URL = "http://localhost:3004";

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
    await seedOperatorConsole(client, db);
    process.stdout.write("seed complete\n");
  } finally {
    await client.end();
  }
}

/**
 * Idenzy's own organisation, its dashboard project, and one publishable key for the panel.
 *
 * Idempotent by inspection rather than by upsert: each step looks for what it would create
 * and skips it, so running this against a database that already holds the dashboard adds
 * nothing and rotates no key.
 *
 * It used to bind `app.org_id` and `app.project_id` first, so the inserts would pass their
 * own WITH CHECK clauses. There are no policies left to satisfy and the bindings are gone
 * with them; what remains is one transaction, for the ordinary reason that a half-seeded
 * organisation is worse than none.
 */
async function seedDashboard(client: pg.Client, db: NodePgDatabase): Promise<void> {
  await client.query("BEGIN");
  try {
    // By id rather than "is there any": an unfiltered check was true as soon as anything existed,
    // which is how a second project could never be seeded beside the first.
    const org = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, IDENZY_ORG_ID));
    if (org.length === 0) {
      await db.insert(orgs).values({ id: IDENZY_ORG_ID, name: "Idenzy" });
      process.stdout.write("seeded organisation Idenzy\n");
    }

    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, DASHBOARD_PROJECT_ID));
    if (project.length === 0) {
      await db.insert(projects).values({
        id: DASHBOARD_PROJECT_ID,
        orgId: IDENZY_ORG_ID,
        name: "Dashboard",
        kmsKeyName: `projects/${DASHBOARD_PROJECT_ID}/keys/signing`,
      });
      process.stdout.write("seeded project Dashboard\n");
    }

    await mintPublishableKey(db, DASHBOARD_PROJECT_ID, "NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY");
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
async function mintPublishableKey(
  db: NodePgDatabase,
  projectId: string,
  variable: string,
): Promise<void> {
  const existing = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId))
    .limit(1);
  if (existing.length > 0) {
    process.stdout.write(
      `a publishable key for ${projectId} already exists; only its hash is stored, so it cannot be shown again.\n` +
        `  Delete it and re-run to mint another: DELETE FROM api_keys WHERE project_id = '${projectId}';\n`,
    );
    return;
  }

  // `pk_` and 32 random bytes — the same shape the management API mints, because a dev key
  // that parsed differently from a real one would hide exactly the bugs this seed is for. The
  // prefix column keeps enough to identify a key in a log line without being enough to use it.
  const head = ApiKeyPrefix.Publishable;
  const key = `${head}${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  await db.insert(apiKeys).values({
    projectId,
    kind: ApiKeyKind.Publishable,
    prefix: key.slice(0, head.length + 8),
    hash: hashToken(key),
    scopes: [],
  });

  process.stdout.write(
    `\n  Publishable key for ${projectId}, shown once:\n\n    ${key}\n\n` +
      `  Put it in .env as ${variable}.\n\n`,
  );
}

/**
 * Idenzy's operator console project (ADR-0018): Google sign-in only, idenzy.io Workspace only.
 *
 * The Google provider is seeded only when `OPERATOR_GOOGLE_CLIENT_ID` and
 * `OPERATOR_GOOGLE_CLIENT_SECRET` are set, because a provider row with no credentials would be one
 * that looks configured and cannot sign anybody in. The secret is encrypted under the project's
 * data key exactly as the management API stores one; `hostedDomain` is what makes the provider
 * refuse any Google account the idenzy.io Workspace does not manage.
 */
async function seedOperatorConsole(client: pg.Client, db: NodePgDatabase): Promise<void> {
  await client.query("BEGIN");
  try {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, OPERATOR_PROJECT_ID));
    if (project.length === 0) {
      await db.insert(projects).values({
        id: OPERATOR_PROJECT_ID,
        orgId: IDENZY_ORG_ID,
        name: "Operator console",
        kmsKeyName: `projects/${OPERATOR_PROJECT_ID}/keys/signing`,
      });
      process.stdout.write("seeded project Operator console\n");
    }

    // Where Google sign-in hands the browser back to. The OAuth start route refuses any
    // return address the project has not listed.
    await db
      .insert(redirectUris)
      .values({
        projectId: OPERATOR_PROJECT_ID,
        uri: `${OPERATOR_CONSOLE_URL}/auth/callback`,
        kind: "oauth",
      })
      .onConflictDoNothing();

    const clientId = process.env["OPERATOR_GOOGLE_CLIENT_ID"];
    const clientSecret = process.env["OPERATOR_GOOGLE_CLIENT_SECRET"];
    if (clientId && clientSecret) {
      const encryptor = new FieldEncryptor(developmentDataKey("development"));
      const secret = encryptor.encrypt(clientSecret, OPERATOR_PROJECT_ID);
      await db
        .insert(oauthProviders)
        .values({
          projectId: OPERATOR_PROJECT_ID,
          provider: "google",
          clientId,
          clientSecretEncrypted: secret,
          settings: { hostedDomain: "idenzy.io" },
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [oauthProviders.projectId, oauthProviders.provider],
          set: {
            clientId,
            clientSecretEncrypted: secret,
            settings: { hostedDomain: "idenzy.io" },
            enabled: true,
          },
        });
      process.stdout.write("seeded Google sign-in for the operator console, idenzy.io only\n");
    } else {
      process.stdout.write(
        "operator console: set OPERATOR_GOOGLE_CLIENT_ID and OPERATOR_GOOGLE_CLIENT_SECRET and re-run\n" +
          "  to enable Google sign-in. The Google client's redirect URI is\n" +
          "  <ISSUER_BASE_URL>/v1/auth/oauth/google/callback.\n",
      );
    }

    await mintPublishableKey(db, OPERATOR_PROJECT_ID, "NUXT_PUBLIC_OPERATOR_PUBLISHABLE_KEY");
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

await main();
