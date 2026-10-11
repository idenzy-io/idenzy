import { randomUUID } from "node:crypto";
import type { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ApiKeyPrefix } from "@idenzy/protocol/schemas/common";
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { orgs } from "./schema/organisation.js";
import {
  apiKeys,
  oauthProviders,
  projectDomains,
  projectOrigins,
  projects,
  redirectUris,
} from "./schema/projects.js";

/** What a deployment's own two projects need to know about where they are served. */
export interface PlatformOptions {
  /** The panel, e.g. `https://app.idenzy.io`. */
  readonly dashboardOrigin: string;
  /**
   * The host the panel signs in through, e.g. `auth.idenzy.io`: a verified auth domain is what
   * lets the dashboard project use cookie mode, which keeps the refresh token out of the page.
   */
  readonly dashboardAuthDomain: string;
  /** The operator console, e.g. `https://console.idenzy.io`. */
  readonly operatorOrigin: string;
  /** The Google client staff sign in with (ADR-0018). Without it the console has no way in yet. */
  readonly operatorGoogle?: { readonly clientId: string; readonly clientSecret: string };
  /** Encrypts the Google client secret the way the management API stores one. */
  readonly encryptor: FieldEncryptor;
}

export interface ProvisionedPlatform {
  readonly dashboardProjectId: string;
  readonly operatorProjectId: string;
  /** Minted by this run, shown once. Absent for a project that already had one. */
  readonly publishableKeys: { readonly dashboard?: string; readonly operator?: string };
  readonly done: readonly string[];
}

/** One transaction, which every step below runs in. */
type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

const ORG_NAME = "Idenzy";
const DASHBOARD = "Dashboard";
const OPERATOR = "Operator console";

/**
 * A deployment's own organisation and its two projects: the dashboard the panel signs customers in
 * through, and the operator console staff sign in to (PROJECT.md 9.5, ADR-0018).
 *
 * The bootstrap a deployment cannot do from its own panel, because the panel cannot sign anybody
 * in until the project it signs them in to exists. The development seed does the same with fixed
 * ids and localhost; this generates ids and registers the real origins and the auth domain.
 *
 * Idempotent by looking: each step finds what it would make and leaves it alone, so running it
 * again changes nothing, mints no second key and rotates nothing. Runs in one transaction as the
 * runtime role, the same path the management API takes.
 */
export async function provisionPlatform(
  db: NodePgDatabase,
  options: PlatformOptions,
): Promise<ProvisionedPlatform> {
  return await db.transaction(async (tx) => {
    const done: string[] = [];
    const note = (line: string) => done.push(line);

    const org = await findOrCreateOrg(tx, note);
    const dashboard = await findOrCreateProject(tx, org, DASHBOARD, note);
    const operator = await findOrCreateProject(tx, org, OPERATOR, note);

    await origin(tx, dashboard, options.dashboardOrigin, note);
    await authDomain(tx, dashboard, options.dashboardAuthDomain, note);
    await origin(tx, operator, options.operatorOrigin, note);
    await tx
      .insert(redirectUris)
      .values({
        projectId: operator,
        uri: `${options.operatorOrigin}/auth/callback`,
        kind: "oauth",
      })
      .onConflictDoNothing();

    if (options.operatorGoogle !== undefined) {
      const { clientId, clientSecret } = options.operatorGoogle;
      const secret = options.encryptor.encrypt(clientSecret, operator);
      const settings = { hostedDomain: "idenzy.io" };
      await tx
        .insert(oauthProviders)
        .values({
          projectId: operator,
          provider: "google",
          clientId,
          clientSecretEncrypted: secret,
          settings,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [oauthProviders.projectId, oauthProviders.provider],
          set: { clientId, clientSecretEncrypted: secret, settings, enabled: true },
        });
      note("operator console: Google sign-in, idenzy.io Workspace accounts only");
    }

    const publishableKeys = {
      ...optional("dashboard", await mintPublishableKey(tx, dashboard)),
      ...optional("operator", await mintPublishableKey(tx, operator)),
    };
    return { dashboardProjectId: dashboard, operatorProjectId: operator, publishableKeys, done };
  });
}

async function findOrCreateOrg(db: Tx, note: (line: string) => void): Promise<string> {
  const found = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.name, ORG_NAME))
    .orderBy(asc(orgs.createdAt))
    .limit(1);
  if (found[0] !== undefined) return found[0].id;
  const id = randomUUID();
  await db.insert(orgs).values({ id, name: ORG_NAME });
  note(`organisation ${ORG_NAME}`);
  return id;
}

async function findOrCreateProject(
  db: Tx,
  orgId: string,
  name: string,
  note: (line: string) => void,
): Promise<string> {
  const found = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.name, name)))
    .limit(1);
  if (found[0] !== undefined) return found[0].id;
  const id = randomUUID();
  // `kms_key_name` is read by nothing since ADR-0021; the column is NOT NULL until it is dropped.
  await db.insert(projects).values({ id, orgId, name, kmsKeyName: "unused" });
  note(`project ${name}`);
  return id;
}

async function origin(
  db: Tx,
  projectId: string,
  value: string,
  note: (line: string) => void,
): Promise<void> {
  const found = await db
    .select({ id: projectOrigins.id })
    .from(projectOrigins)
    .where(and(eq(projectOrigins.projectId, projectId), eq(projectOrigins.origin, value)))
    .limit(1);
  if (found.length > 0) return;
  await db.insert(projectOrigins).values({ projectId, origin: value });
  note(`origin ${value}`);
}

/**
 * Registered as verified. It is our own domain, pointed at this deployment by the same DNS change
 * that made it reachable, so there is nothing for the verification flow a customer goes through to
 * prove.
 */
async function authDomain(
  db: Tx,
  projectId: string,
  domain: string,
  note: (line: string) => void,
): Promise<void> {
  const found = await db
    .select({ id: projectDomains.id })
    .from(projectDomains)
    .where(and(eq(projectDomains.projectId, projectId), eq(projectDomains.domain, domain)))
    .limit(1);
  if (found.length > 0) return;
  await db
    .insert(projectDomains)
    .values({ projectId, domain, type: "auth", status: "verified", checkedAt: new Date() });
  note(`auth domain ${domain}`);
}

/** One publishable key per project, printed once: only its hash is stored. */
async function mintPublishableKey(db: Tx, projectId: string): Promise<string | null> {
  const existing = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.kind, ApiKeyKind.Publishable)))
    .limit(1);
  if (existing.length > 0) return null;

  const head = ApiKeyPrefix.Publishable;
  const key = `${head}${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  await db.insert(apiKeys).values({
    projectId,
    kind: ApiKeyKind.Publishable,
    prefix: key.slice(0, head.length + 8),
    hash: hashToken(key),
    scopes: [],
  });
  return key;
}

function optional<K extends string>(name: K, value: string | null): Partial<Record<K, string>> {
  return value === null ? {} : ({ [name]: value } as Record<K, string>);
}
