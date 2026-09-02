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
import { users } from "./identity.js";
import { accountOperational, config, credential } from "./presets.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/** Enrolled second factors. TOTP secrets and recovery codes are envelope encrypted. */
export const mfaFactors = classifiedTable(
  "mfa_factors",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    type: classified(text("type").notNull(), { ...config, loggable: true }),
    secretEncrypted: encrypted(text("secret_encrypted"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NullOut,
    }),
    credential: classified(jsonb("credential").notNull().default({}), credential),
    verifiedAt: classified(timestamp("verified_at", { withTimezone: true }), accountOperational),
    lastUsedAt: classified(timestamp("last_used_at", { withTimezone: true }), {
      ...accountOperational,
      subjectField: true,
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("mfa_factors_user_idx").on(t.userId), tenantIsolationPolicy("mfa_factors")],
).enableRLS();

/**
 * WebAuthn credentials.
 *
 * The public key is not a secret, but the credential id identifies a physical
 * authenticator, so it is treated as personal data.
 */
export const webauthnCredentials = classifiedTable(
  "webauthn_credentials",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    credentialId: classified(text("credential_id").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      subjectField: true,
      erasure: Erasure.Tombstone,
    }),
    publicKey: classified(text("public_key").notNull(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NullOut,
    }),
    signCount: classified(integer("sign_count").notNull().default(0), {
      ...accountOperational,
      note: "A decrease suggests a cloned authenticator and is a security signal.",
    }),
    transports: classified(text("transports").array().notNull().default([]), accountOperational),
    aaguid: classified(text("aaguid"), accountOperational),
    backupEligible: classified(
      boolean("backup_eligible").notNull().default(false),
      accountOperational,
    ),
    name: classified(text("name"), {
      class: DataClass.Pii,
      purpose: Purpose.AccountManagement,
      retention: Retention.UntilAccountDeletion,
      subjectField: true,
      erasure: Erasure.Tombstone,
      note: "User-chosen label, such as the name of a phone.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("webauthn_credentials_credential_key").on(t.projectId, t.credentialId),
    index("webauthn_credentials_user_idx").on(t.userId),
    tenantIsolationPolicy("webauthn_credentials"),
  ],
).enableRLS();
