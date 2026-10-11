import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ClaimSource, claimTemplateSchema } from "@idenzy/protocol/schemas/claims";
import { ApiKeyPrefix, IdPrefix } from "@idenzy/protocol/schemas/common";
import { type ProjectSettings, projectSettingsSchema } from "@idenzy/protocol/schemas/management";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { claimTemplates } from "./schema/claims.js";
import { orgs } from "./schema/organisation.js";
import { apiKeys, oauthProviders, projects, redirectUris } from "./schema/projects.js";

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
 * - the return addresses, which Idenzy only ever sends a browser to once registered:
 *   `<origin>/auth/callback` for OAuth, `<origin>/auth/link` for magic links,
 *   `<origin>/auth/reset` for password-reset links and `<origin>/auth/verify-email` for
 *   email-verification links;
 * - with `--methods`, exactly the first-party ways in named (`password`, `email_code`,
 *   `magic_link`), every other one off; without it, the project's defaults;
 * - each social provider whose credentials are in the environment
 *   (`IDENZY_DEV_OAUTH_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET`, for `GITHUB`, `GOOGLE`,
 *   `MICROSOFT`, …), with its OAuth app's callback at `<ISSUER_BASE_URL>/v1/auth/oauth/<provider>/callback`;
 * - a claim template putting the standard profile claims (`email`, `email_verified`, `name`,
 *   `picture`) into the access token, so a backend can verify a token offline and still know
 *   who it names (`--no-claims` leaves the template alone);
 * - a publishable key and a secret key, printed once as env lines on stdout.
 *
 * Every other setting is the project default (which allows passwords, emailed codes, passkeys
 * and an authenticator app). CORS needs nothing: outside production any loopback
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

/** The first-party ways in `--methods` can name, and the settings each one is. */
const METHODS = ["password", "email_code", "magic_link"] as const;
type Method = (typeof METHODS)[number];

/** The social providers whose credentials are looked for in the environment. */
const PROVIDERS = ["github", "google", "microsoft", "apple", "gitlab"] as const;

interface Options {
  readonly name: string;
  readonly origins: readonly string[];
  readonly claims: boolean;
  readonly rotateKeys: boolean;
  readonly methods: readonly Method[] | null;
}

function options(): Options {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      origin: { type: "string", multiple: true, default: [] },
      "no-claims": { type: "boolean", default: false },
      "rotate-keys": { type: "boolean", default: false },
      methods: { type: "string" },
    },
  });
  const name = values.name?.trim() ?? "";
  if (name === "") fail("--name is required: the project's name, such as --name acme");
  const origins = values.origin.map((origin) => {
    const url = URL.parse(origin);
    if (url === null || url.origin === "null") fail(`--origin ${origin} is not an origin`);
    return url.origin;
  });
  let methods: Method[] | null = null;
  if (values.methods !== undefined) {
    methods = values.methods.split(",").map((raw) => {
      const method = raw.trim() as Method;
      if (!METHODS.includes(method)) fail(`--methods takes ${METHODS.join(", ")}; not ${raw}`);
      return method;
    });
  }
  return {
    name,
    origins,
    claims: !values["no-claims"],
    rotateKeys: values["rotate-keys"],
    methods,
  };
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
      if (wanted.methods !== null) await ways(db, projectId, wanted.methods, wanted.origins);
      await socialProviders(db, projectId);
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

/** Where each kind of redirect lands, by the paths the starters use. */
const RETURN_PATHS = [
  { kind: "oauth", path: "/auth/callback" },
  { kind: "magic_link", path: "/auth/link" },
  { kind: "password_reset", path: "/auth/reset" },
  { kind: "email_verification", path: "/auth/verify-email" },
] as const;

/**
 * The origin's return addresses. An emailed link goes to the first address registered for
 * its kind, so a second origin's are spares rather than replacements.
 */
async function returnUri(db: NodePgDatabase, projectId: string, origin: string): Promise<void> {
  for (const { kind, path } of RETURN_PATHS) {
    await db
      .insert(redirectUris)
      .values({ projectId, uri: `${origin}${path}`, kind })
      .onConflictDoNothing();
  }
  say(`return addresses under ${origin}/auth/`);
}

/**
 * Exactly the named first-party methods on, every other off. The settings sections are
 * replaced whole, as the management API does, so each is parsed from what is held first. A
 * magic link also lists its landing addresses in the settings, which is what the panel shows.
 */
async function ways(
  db: NodePgDatabase,
  projectId: string,
  methods: readonly Method[],
  origins: readonly string[],
): Promise<void> {
  const rows = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId));
  const held: ProjectSettings = projectSettingsSchema.parse(rows[0]?.settings ?? {});
  const on = (method: Method) => methods.includes(method);
  const links = new Set(held.otp.magicLink.redirectUris);
  for (const origin of origins) links.add(`${origin}/auth/link`);
  const settings: ProjectSettings = {
    ...held,
    password: { ...held.password, enabled: on("password") },
    otp: {
      ...held.otp,
      email: { ...held.otp.email, enabled: on("email_code") },
      magicLink: { ...held.otp.magicLink, enabled: on("magic_link"), redirectUris: [...links] },
    },
  };
  await db.update(projects).set({ settings }).where(eq(projects.id, projectId));
  say(`ways in: ${methods.join(", ") || "none"} (and any social provider configured)`);
}

/**
 * The social providers whose OAuth app credentials are in the environment, each enabled with
 * its secret encrypted under the project's development data key, as the management API
 * stores one. Absent credentials leave a provider as it is.
 */
async function socialProviders(db: NodePgDatabase, projectId: string): Promise<void> {
  const encryptor = new FieldEncryptor(developmentDataKey("development"));
  for (const provider of PROVIDERS) {
    const prefix = `IDENZY_DEV_OAUTH_${provider.toUpperCase()}`;
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) continue;
    const secret = encryptor.encrypt(clientSecret, projectId);
    await db
      .insert(oauthProviders)
      .values({ projectId, provider, clientId, clientSecretEncrypted: secret, enabled: true })
      .onConflictDoUpdate({
        target: [oauthProviders.projectId, oauthProviders.provider],
        set: { clientId, clientSecretEncrypted: secret, enabled: true },
      });
    say(`${provider} sign-in on, from ${prefix}_CLIENT_ID`);
  }
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
