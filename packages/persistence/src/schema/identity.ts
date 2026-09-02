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
import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accountOperational, config, credential, identifyingPii } from "./presets.js";
import {
  createdAtColumn,
  projectIdColumn,
  tenantIsolationPolicy,
  updatedAtColumn,
} from "./shared.js";

/**
 * An end user of a customer's application.
 *
 * `deletedAt` is a tombstone, not a soft delete for convenience: erasure keeps the row
 * as a shell with no personal data so audit entries stay referentially intact
 * (PROJECT.md 4.13.6).
 */
export const users = classifiedTable(
  "users",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.Authentication,
      retention: Retention.Years6,
      erasure: Erasure.RetainPseudonymous,
      loggable: true,
      note: "Survives erasure so the audit trail keeps a stable pseudonymous subject.",
    }),
    projectId: projectIdColumn(),
    email: classified(text("email"), identifyingPii),
    emailVerified: classified(
      boolean("email_verified").notNull().default(false),
      accountOperational,
    ),
    phone: classified(text("phone"), identifyingPii),
    phoneVerified: classified(
      boolean("phone_verified").notNull().default(false),
      accountOperational,
    ),
    passwordHash: classified(text("password_hash"), credential),
    passwordAlgoVersion: classified(integer("password_algo_version"), {
      ...config,
      note: "Lets a hash be upgraded transparently on next login (PROJECT.md 4.5).",
    }),
    displayName: classified(text("display_name"), identifyingPii),
    avatarUrl: classified(text("avatar_url"), { ...identifyingPii, class: DataClass.Pii }),
    metadataPublic: classified(jsonb("metadata_public").notNull().default({}), {
      ...identifyingPii,
      note: "Customer-controlled. Assume it holds personal data, because it usually does.",
    }),
    metadataPrivate: classified(jsonb("metadata_private").notNull().default({}), {
      ...identifyingPii,
      note: "Readable only with a secret key. Never returned to a client SDK.",
    }),
    bannedUntil: classified(timestamp("banned_until", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.SecurityAndAbusePrevention,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NotApplicable,
    }),
    lastSignInAt: classified(timestamp("last_sign_in_at", { withTimezone: true }), {
      ...accountOperational,
      subjectField: true,
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: classified(timestamp("deleted_at", { withTimezone: true }), {
      ...accountOperational,
      note: "Tombstone marker. The row survives erasure with its personal columns cleared.",
    }),
  },
  (t) => [
    uniqueIndex("users_project_email_key").on(t.projectId, t.email),
    uniqueIndex("users_project_phone_key").on(t.projectId, t.phone),
    index("users_project_created_idx").on(t.projectId, t.createdAt),
    tenantIsolationPolicy("users"),
  ],
).enableRLS();

/** A federated identity linked to a user. One row per provider account. */
export const identities = classifiedTable(
  "identities",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    provider: classified(text("provider").notNull(), { ...config, loggable: true }),
    providerUserId: classified(text("provider_user_id").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      subjectField: true,
      erasure: Erasure.Tombstone,
    }),
    email: classified(text("email"), identifyingPii),
    providerData: classified(jsonb("provider_data").notNull().default({}), identifyingPii),
    encryptedTokens: encrypted(text("encrypted_tokens"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NullOut,
      note: "Provider access and refresh tokens. Stored only when the customer opts in (4.6).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("identities_project_provider_subject_key").on(
      t.projectId,
      t.provider,
      t.providerUserId,
    ),
    index("identities_user_idx").on(t.userId),
    tenantIsolationPolicy("identities"),
  ],
).enableRLS();
