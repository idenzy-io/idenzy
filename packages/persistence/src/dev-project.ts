import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ClaimSource, claimTemplateSchema } from "@idenzy/protocol/schemas/claims";
import { ApiKeyPrefix, IdPrefix } from "@idenzy/protocol/schemas/common";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { claimTemplates } from "./schema/claims.js";
import { orgs } from "./schema/organisation.js";
import { apiKeys, projects, redirectUris } from "./schema/projects.js";

/**
 * A customer's project on a laptop, for building an application against a local Idenzy.
 *
 *   pnpm dev:project --name acme --origin http://acme.localhost:3000
 *
 * The panel can do all of this, one screen at a time, after signing in with a code read off
 * the API's log. An application being integrated needs the same four things every time and
 * needs them again after every reset of the database, so they are one command:
 *
 * - the project, in an organisation called "Local development" that exists for nothing else;
 * - `<origin>/auth/callback` as a return address, which the OAuth start route requires;
 * - a claim template putting the standard profile claims (`email`, `email_verified`, `name`,
 *   `picture`) into the access token, so a backend can verify a token offline and still know
 *   who it names (`--no-claims` leaves the template alone);
 * - a publishable key and a secret key, printed once as env lines on stdout.
 *
 * Every other setting is the project default, which already allows passwords, emailed codes,
 * passkeys and an authenticator app. CORS needs nothing: outside production any loopback
 * origin is allowed by code. An origin on a subdomain of `localhost` gives the application a
 * cookie jar of its own, which is what keeps two applications on one laptop from signing each
 * other out.
 *
 * Idempotent by name. A second run finds the project, adds any origin it has not seen, and
 * mints no key, because only hashes are stored and an existing key cannot be shown again;
 * `--rotate-keys` revokes the project's keys and mints a fresh pair.
 *
 * **Development only**, like `seed.ts`, and for the same reason: it writes as the runtime
 * role through the same tables the management API uses, and a fixed organisation id is
 * something that must never reach a real deployment. Messages go to stderr so stdout can be
 * appended to an `.env` as it is.
 */

/** Fixed, so every project made here sits in one place and is recognisably local. */
const LOCAL_ORG_ID = "00000000-0000-4000-8000-000000000010";

/** OpenID Connect's names for the four profile fields a backend most often wants. */
const PROFILE_CLAIMS = [
  { name: "email", path: "email" },
  { name: "email_verified", path: "emailVerified" },
  { name: "name", path: "displayName" },
  { name: "picture", path: "avatarUrl" },
] as const;

interface Options {
  readonly name: string;
  readonly origins: readonly string[];
  readonly claims: boolean;
  readonly rotateKeys: boolean;
}

function options(): Options {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      origin: { type: "string", multiple: true, default: [] },
      "no-claims": { type: "boolean", default: false },
      "rotate-keys": { type: "boolean", default: false },
    },
  });
  const name = values.name?.trim() ?? "";
  if (name === "") fail("--name is required: the project's name, such as --name acme");
  const origins = values.origin.map((origin) => {
    const url = URL.parse(origin);
    if (url === null || url.origin === "null") fail(`--origin ${origin} is not an origin`);
    return url.origin;
  });
  return { name, origins, claims: !values["no-claims"], rotateKeys: values["rotate-keys"] };
}

async function main(): Promise<void> {
  const environment = process.env["IDENZY_ENV"] ?? "development";
  if (environment !== "development") {
    fail(`Refusing to run: IDENZY_ENV is "${environment}". This is for development only.`);
  }
  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") fail("DATABASE_MIGRATION_URL or DATABASE_URL must be set.");
  const wanted = options();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // The runtime role, as seed.ts does: what this writes, the application could write.
    await client.query("SET ROLE idenzy_app");
    const db = drizzle(client);
    await client.query("BEGIN");
    try {
      const projectId = await project(db, wanted.name);
      for (const origin of wanted.origins) await returnUri(db, projectId, origin);
      if (wanted.claims) await profileClaims(db, projectId);
      const keys = await mintKeys(db, projectId, wanted.rotateKeys);
      await client.query("COMMIT");

      const publicId = PublicId.encode(IdPrefix.Project, projectId).value;
      process.stdout.write(`IDENZY_PROJECT_ID=${publicId}\n`);
      if (keys !== null) {
        process.stdout.write(`IDENZY_PUBLISHABLE_KEY=${keys.publishable}\n`);
        process.stdout.write(`IDENZY_SECRET_KEY=${keys.secret}\n`);
      }
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function project(db: NodePgDatabase, name: string): Promise<string> {
  const org = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, LOCAL_ORG_ID));
  if (org.length === 0) {
    await db.insert(orgs).values({ id: LOCAL_ORG_ID, name: "Local development" });
    say("created organisation Local development");
  }

  const found = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, LOCAL_ORG_ID), eq(projects.name, name)));
  const existing = found[0];
  if (existing !== undefined) {
    say(`found project ${name}`);
    return existing.id;
  }

  const id = randomUUID();
  await db.insert(projects).values({
    id,
    orgId: LOCAL_ORG_ID,
    name,
    kmsKeyName: `projects/${id}/keys/signing`,
  });
  say(`created project ${name}`);
  return id;
}

/** The one return address an application built from the starters uses. */
async function returnUri(db: NodePgDatabase, projectId: string, origin: string): Promise<void> {
  const uri = `${origin}/auth/callback`;
  await db.insert(redirectUris).values({ projectId, uri, kind: "oauth" }).onConflictDoNothing();
  say(`return address ${uri}`);
}

/**
 * The profile claims, merged into whatever template the project already has.
 *
 * Merged rather than replaced, so a claim somebody added in the panel survives a re-run, and
 * parsed with the protocol's schema, so this cannot store a template the API would refuse.
 */
async function profileClaims(db: NodePgDatabase, projectId: string): Promise<void> {
  const rows = await db
    .select({ claims: claimTemplates.claims })
    .from(claimTemplates)
    .where(eq(claimTemplates.projectId, projectId));
  const held = claimTemplateSchema.shape.claims.safeParse(rows[0]?.claims ?? []);
  const current = held.success ? held.data : [];
  const names = new Set(current.map((claim) => claim.name));
  const added = PROFILE_CLAIMS.filter((claim) => !names.has(claim.name)).map((claim) => ({
    name: claim.name,
    source: ClaimSource.User,
    path: claim.path,
    required: false,
  }));
  if (added.length === 0) return;

  const { claims } = claimTemplateSchema.parse({ claims: [...current, ...added] });
  await db
    .insert(claimTemplates)
    .values({ projectId, claims, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: claimTemplates.projectId,
      set: { claims, updatedAt: new Date() },
    });
  say(`claims ${added.map((claim) => claim.name).join(", ")} added to the token`);
}

interface MintedKeys {
  readonly publishable: string;
  readonly secret: string;
}

/**
 * A key of each kind, or none while live ones exist and nobody asked to rotate.
 *
 * Only hashes are stored, which is the promise the panel's own key screen makes, so a key
 * minted on an earlier run cannot be shown again.
 */
async function mintKeys(
  db: NodePgDatabase,
  projectId: string,
  rotate: boolean,
): Promise<MintedKeys | null> {
  const live = and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt));
  const held = await db.select({ id: apiKeys.id }).from(apiKeys).where(live).limit(1);
  if (held.length > 0 && !rotate) {
    say(
      "keys already exist; only their hashes are stored, so they cannot be shown again. " +
        "Re-run with --rotate-keys to revoke them and mint a new pair.",
    );
    return null;
  }
  if (held.length > 0) {
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(live);
    say("revoked the project's keys");
  }
  return {
    publishable: await mintKey(db, projectId, ApiKeyKind.Publishable, ApiKeyPrefix.Publishable),
    secret: await mintKey(db, projectId, ApiKeyKind.Secret, ApiKeyPrefix.Secret),
  };
}

/** The kind's prefix and 32 random bytes, the shape the management API mints. */
async function mintKey(
  db: NodePgDatabase,
  projectId: string,
  kind: ApiKeyKind,
  head: string,
): Promise<string> {
  const key = `${head}${generateOpaqueToken(32)}`;
  await db.insert(apiKeys).values({
    projectId,
    kind,
    prefix: key.slice(0, head.length + 8),
    hash: hashToken(key),
    scopes: [],
  });
  return key;
}

function say(line: string): void {
  process.stderr.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
