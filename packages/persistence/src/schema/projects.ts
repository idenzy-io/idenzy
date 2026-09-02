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
import {
  boolean,
  index,
  jsonb,
  pgPolicy,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orgs, regionCells } from "./control-plane.js";
import { config, credential } from "./presets.js";
import { appRole } from "./roles.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/** A customer project. The unit of tenancy, key isolation and residency. */
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
    cellId: classified(
      uuid("cell_id")
        .notNull()
        .references(() => regionCells.id),
      { ...config, note: "Immutable after creation. Moving a project is an audited migration." },
    ),
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
    // The tenant key of this table is its own id, not a project_id column, so the
    // shared policy does not fit. Without this, a tenant could read every project row.
    pgPolicy("projects_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: appRole,
      using: sql`id = nullif(current_setting('app.project_id', true), '')::uuid`,
      withCheck: sql`id = nullif(current_setting('app.project_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

/** Custom auth and email domains, with their DNS verification state. */
export const projectDomains = classifiedTable(
  "project_domains",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    domain: classified(text("domain").notNull(), { ...config, loggable: true }),
    type: classified(text("type").notNull(), config),
    status: classified(text("status").notNull().default("pending"), { ...config, loggable: true }),
    dnsRecords: classified(jsonb("dns_records").notNull().default([]), config),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("project_domains_domain_key").on(t.domain),
    index("project_domains_project_idx").on(t.projectId),
    tenantIsolationPolicy("project_domains"),
  ],
).enableRLS();

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
    projectId: projectIdColumn(),
    uri: classified(text("uri").notNull(), config),
    kind: classified(text("kind").notNull(), config),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("redirect_uris_project_uri_kind_key").on(t.projectId, t.uri, t.kind),
    tenantIsolationPolicy("redirect_uris"),
  ],
).enableRLS();

/** Publishable and secret API keys. Only the hash and a display prefix are stored. */
export const apiKeys = classifiedTable(
  "api_keys",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
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
    tenantIsolationPolicy("api_keys"),
  ],
).enableRLS();

/** Per-project OAuth provider credentials. Secrets are envelope encrypted. */
export const oauthProviders = classifiedTable(
  "oauth_providers",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    provider: classified(text("provider").notNull(), { ...config, loggable: true }),
    clientId: classified(text("client_id"), config),
    clientSecretEncrypted: encrypted(text("client_secret_encrypted"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
    }),
    scopes: classified(text("scopes").array().notNull().default([]), config),
    enabled: classified(boolean("enabled").notNull().default(false), config),
    mode: classified(text("mode").notNull().default("custom"), {
      ...config,
      note: "instant mode uses our shared app and is blocked on production domains (4.6).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("oauth_providers_project_provider_key").on(t.projectId, t.provider),
    tenantIsolationPolicy("oauth_providers"),
  ],
).enableRLS();
