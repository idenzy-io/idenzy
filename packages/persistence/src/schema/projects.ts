import {
  classified,
  classifiedTable,
  encrypted,
} from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orgs } from "./organisation.js";
import { config, credential } from "./presets.js";
import { createdAtColumn, projectIdColumn } from "./shared.js";

/** A customer project. The unit of tenancy and of key isolation. */
export const projects = classifiedTable(
  "projects",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    orgId: classified(
      uuid("org_id")
        .notNull()
        .references(() => orgs.id),
      config,
    ),
    name: classified(text("name").notNull(), config),
    plan: classified(text("plan").notNull().default("free"), config),
    complianceTier: classified(text("compliance_tier").notNull().default("standard"), {
      ...config,
      loggable: true,
      note: "Drives audit retention, mandatory field encryption and subprocessor scope (4.13).",
    }),
    settings: classified(jsonb("settings").notNull().default({}), config),
    kmsKeyName: classified(text("kms_key_name").notNull(), {
      ...config,
      note: "Per-project signing key. The private half never leaves KMS.",
    }),
    dekWrapped: encrypted(text("dek_wrapped"), {
      class: DataClass.Secret,
      purpose: Purpose.ServiceConfiguration,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
      note: "Per-project data encryption key, wrapped by the cell KMS key (4.13.4).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("projects_org_idx").on(t.orgId),
    // This table is reached two ways and both are legitimate: the auth surface has one
    // project and must see that row, the dashboard has an organisation and must see the
    // projects it owns. Two row policies used to express that, OR'd together. With them gone
    // the distinction lives in the repositories — `ProjectRepository` filters on the row's own
    // `id`, `OrgProjectRepository` on its `org_id` — and the tenant key of this table being
    // its own id rather than a `project_id` column is why neither can use `tenantScope()`.
  ],
);

/** Custom auth and email domains, with their DNS verification state. */
export const projectDomains = classifiedTable(
  "project_domains",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    domain: classified(text("domain").notNull(), { ...config, loggable: true }),
    type: classified(text("type").notNull(), config),
    status: classified(text("status").notNull().default("pending"), { ...config, loggable: true }),
    dnsRecords: classified(jsonb("dns_records").notNull().default([]), config),
    checkedAt: classified(timestamp("checked_at", { withTimezone: true }), {
      ...config,
      loggable: true,
      note: "When DNS was last resolved, so a reader knows how stale a 'not found' is.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // Across every project, not per project. A hostname resolves to one project or the
    // routing is ambiguous, and `resolve_project_by_host` would have two answers.
    uniqueIndex("project_domains_domain_key").on(t.domain),
    index("project_domains_project_idx").on(t.projectId),
  ],
);

/**
 * Exact-match redirect allowlist (PROJECT.md 4.6, 4.7).
 *
 * Every OAuth return and every magic link lands on one of these. There are no wildcards
 * and no prefix matching, because we render no page of our own and this table is the
 * only thing standing between our redirect and an attacker's.
 */
export const redirectUris = classifiedTable(
  "redirect_uris",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    uri: classified(text("uri").notNull(), config),
    kind: classified(text("kind").notNull(), config),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("redirect_uris_project_uri_kind_key").on(t.projectId, t.uri, t.kind)],
);

/**
 * Browser origins allowed to call the API with credentials (PROJECT.md 4.3).
 *
 * Its own table rather than something derived from `redirect_uris`, and the distinction is
 * worth defending. Redirect targets include schemes that are not origins at all
 * (`myapp://callback`); the two sets legitimately differ, since an SPA served from
 * `www.example.com` may post to auth while the OAuth return lands on `app.example.com`; and
 * deriving one from the other would mean registering a redirect URI silently granted CORS,
 * which is an invisible privilege change.
 *
 * `webauthn_relying_parties.origins` is not reused either, despite looking identical.
 * WebAuthn forbids origins outside the RP's own registrable domain and CORS does not, so the
 * two allowlists have different legal shapes and merging them would narrow one or widen the
 * other.
 *
 * Exact match, no wildcards, for the same reason `redirect_uris` has none. The one exception
 * is a localhost rule that lives in application code and is gated on the environment, so it
 * cannot be switched on by data.
 */
export const projectOrigins = classifiedTable(
  "project_origins",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    origin: classified(text("origin").notNull(), {
      ...config,
      loggable: true,
      note: "Scheme, host and port only. Logged, because a refused origin is the whole diagnosis.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("project_origins_project_origin_key").on(t.projectId, t.origin)],
);

/**
 * The WebAuthn relying party a project's passkeys belong to (PROJECT.md 4.7).
 *
 * One row per project, and the unique index is what makes that structural. A credential
 * is bound to the RP ID it was created under and no other, so a project with two of them
 * would have two disjoint sets of passkeys and a sign-in that works or not depending on
 * which page the user started from. Better to make the second one impossible than to
 * explain it.
 *
 * `origins` is a second, exact-match allowlist rather than something derived from
 * `rpId`. The RP ID is a registrable suffix, so `example.com` covers every subdomain of
 * it, and inferring the origins from that would silently let any subdomain a customer
 * does not control assert their users' passkeys. Native apps need entries that are not
 * URLs at all (`android:apk-key-hash:...`), which the same column carries.
 */
export const webauthnRelyingParties = classifiedTable(
  "webauthn_relying_parties",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    rpId: classified(text("rp_id").notNull(), { ...config, loggable: true }),
    rpName: classified(text("rp_name").notNull(), {
      ...config,
      note: "Shown by the authenticator when it asks. The customer's product name, not ours.",
    }),
    origins: classified(text("origins").array().notNull().default([]), {
      ...config,
      note: "Exact match. No wildcards, for the same reason redirect_uris has none.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("webauthn_relying_parties_project_key").on(t.projectId)],
);

/** Publishable and secret API keys. Only the hash and a display prefix are stored. */
export const apiKeys = classifiedTable(
  "api_keys",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    kind: classified(text("kind").notNull(), { ...config, loggable: true }),
    prefix: classified(text("prefix").notNull(), {
      ...config,
      loggable: true,
      note: "First characters only, so a key can be identified in logs without being usable.",
    }),
    hash: classified(text("hash").notNull(), credential),
    scopes: classified(text("scopes").array().notNull().default([]), config),
    lastUsedAt: classified(timestamp("last_used_at", { withTimezone: true }), config),
    revokedAt: classified(timestamp("revoked_at", { withTimezone: true }), config),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.hash),
    index("api_keys_project_idx").on(t.projectId),
  ],
);

/** Per-project OAuth provider credentials. Secrets are envelope encrypted. */
export const oauthProviders = classifiedTable(
  "oauth_providers",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    provider: classified(text("provider").notNull(), { ...config, loggable: true }),
    clientId: classified(text("client_id"), config),
    clientSecretEncrypted: encrypted(text("client_secret_encrypted"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
    }),
    scopes: classified(text("scopes").array().notNull().default([]), config),
    settings: classified(jsonb("settings").notNull().default({}), {
      ...config,
      note: "Non-secret provider extras: Apple's team and key ids, a Microsoft directory.",
    }),
    enabled: classified(boolean("enabled").notNull().default(false), config),
    mode: classified(text("mode").notNull().default("custom"), {
      ...config,
      note: "instant mode uses our shared app and is blocked on production domains (4.6).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("oauth_providers_project_provider_key").on(t.projectId, t.provider)],
);

/**
 * The ES256 key pairs a project's access tokens are signed with (PROJECT.md 4.2, ADR-0017).
 *
 * **A table rather than a column, because rotation needs two keys alive at once.** §4.2 rotates
 * every 90 days and publishes both in JWKS during the overlap, so a token minted under the old
 * `kid` keeps verifying while customers' cached JWKS catch up. One column could hold one key and
 * every rotation would break every verifier that had not refetched yet.
 *
 * The private half is stored **wrapped by the cell's KMS key** and never in the clear. What that
 * buys, and what it costs, is the whole of ADR-0017: signing is local and therefore free and fast,
 * KMS is called once per key per process rather than once per token, and fixed cost per tenant
 * stays at zero because the KMS key belongs to the cell and not to the project. The cost is that
 * the unwrapped key exists in process memory, which is a weaker posture than a non-exportable HSM
 * key and is not a weaker control.
 */
export const projectSigningKeys = classifiedTable(
  "project_signing_keys",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    projectId: projectIdColumn(() => projects.id),
    kid: classified(text("kid").notNull(), {
      ...config,
      loggable: true,
      note: "Published in JWKS and carried in every token header, so it is public by design.",
    }),
    algorithm: classified(text("algorithm").notNull().default("ES256"), {
      ...config,
      loggable: true,
    }),
    publicJwk: classified(jsonb("public_jwk").notNull(), {
      ...config,
      note: "Served at the project's JWKS endpoint. Public half only; nothing here is secret.",
    }),
    privateKeyWrapped: classified(text("private_key_wrapped").notNull(), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
      note: "PKCS#8, wrapped by the cell KMS key with the project id as authenticated data, so a row lifted into another project cannot be opened.",
    }),
    isPrimary: classified(boolean("is_primary").notNull().default(false), {
      ...config,
      loggable: true,
      note: "The one new tokens are signed with. Exactly one per project, held by a partial index.",
    }),
    createdAt: createdAtColumn(),
    retiredAt: classified(timestamp("retired_at", { withTimezone: true }), {
      ...config,
      loggable: true,
      note: "Dropped from JWKS once set. Until then an old key still verifies tokens already minted.",
    }),
  },
  (t) => [
    uniqueIndex("project_signing_keys_kid_key").on(t.projectId, t.kid),
    // Exactly one primary per project, the same shape `org_members` uses for its single owner. A
    // rotation that promoted before it demoted would otherwise leave two keys claiming to be the
    // one tokens are signed with, and which won would depend on row order.
    uniqueIndex("project_signing_keys_primary_key").on(t.projectId).where(sql`is_primary`),
    index("project_signing_keys_live_idx").on(t.projectId, t.retiredAt),
  ],
);
