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
  SubjectPopulation,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { accountOperational, config, credential, ephemeralChallenge } from "./presets.js";
import { projects } from "./projects.js";
import { sessions } from "./sessions.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/**
 * Enrolled second factors, one row per device (PROJECT.md 4.5).
 *
 * The TOTP secret is envelope encrypted rather than hashed, because we are the party
 * that has to compute the expected code: there is nothing here to compare a digest
 * against. Recovery codes are the opposite case and live in their own table below.
 */
export const mfaFactors = classifiedTable(
  "mfa_factors",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
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
    label: classified(text("label"), {
      class: DataClass.Pii,
      purpose: Purpose.AccountManagement,
      retention: Retention.UntilAccountDeletion,
      subjectField: true,
      erasure: Erasure.Tombstone,
      note: "User-chosen name for the authenticator, so two of them are tellable apart.",
    }),
    counter: classified(bigint("counter", { mode: "number" }), {
      ...accountOperational,
      note: "The last TOTP step this factor spent. A code from that step or earlier is refused however well it verifies, which is what stops a shoulder-surfed code being replayed inside its own window.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("mfa_factors_user_idx").on(t.userId),
    // Verified rows only. An abandoned enrolment must not stand between a user and a
    // second attempt, and until it is confirmed it can satisfy nothing anyway.
    uniqueIndex("mfa_factors_user_type_key")
      .on(t.projectId, t.userId, t.type)
      .where(sql`verified_at is not null`),
    tenantIsolationPolicy("mfa_factors"),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
).enableRLS();

/**
 * The codes that stand in for a factor the user cannot reach (PROJECT.md 4.5).
 *
 * A row per code rather than a set on the factor, because each is spent on its own and
 * the count of what is left is what a security screen shows. Only the digest is stored:
 * a recovery code is compared and never read back, so there is nothing to decrypt and
 * nothing a leak of this table would yield. That the digest is a plain SHA-256 rather
 * than a password hash is a property of the code's own length, not a shortcut.
 *
 * They are not an `mfa_factors` row. Ten single-use secrets on a printed sheet are not a
 * device, they have no counter and no confirmation step, and giving them one would mean
 * a factor row that is enrolled but never used.
 */
export const mfaRecoveryCodes = classifiedTable(
  "mfa_recovery_codes",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    codeHash: classified(text("code_hash").notNull(), credential),
    usedAt: classified(timestamp("used_at", { withTimezone: true }), {
      ...accountOperational,
      subjectField: true,
      note: "Single use. Set in the same statement that reads the row, so two requests cannot spend one code.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("mfa_recovery_codes_hash_key").on(t.projectId, t.codeHash),
    index("mfa_recovery_codes_user_idx").on(t.projectId, t.userId),
    tenantIsolationPolicy("mfa_recovery_codes"),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
).enableRLS();

/**
 * A proved first factor waiting on a second (PROJECT.md 4.5).
 *
 * It exists because the alternative is worse. Without a row, the server would have to
 * either issue a half-privileged session or hand the client something it presents back,
 * and both are a credential that a first factor alone minted. This is a five-minute row
 * with an attempt cap that proves nothing on its own.
 *
 * `amr` is carried rather than recomputed, because the session that comes out of a
 * completed challenge has to claim both what was proved at the door and what was proved
 * here. `sessionId` is set only for a step-up, which is the one purpose that has a
 * session already: pinning it means a challenge minted in one session cannot raise the
 * factor age of another.
 */
export const mfaChallenges = classifiedTable(
  "mfa_challenges",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...ephemeralChallenge, loggable: true },
    ),
    purpose: classified(text("purpose").notNull(), { ...config, loggable: true }),
    sessionId: classified(
      uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
      {
        ...ephemeralChallenge,
        loggable: true,
        note: "Set for a step-up and null for a sign-in, so a challenge cannot raise the factor age of a session it was not minted in.",
      },
    ),
    amr: classified(text("amr").array().notNull().default([]), {
      ...ephemeralChallenge,
      loggable: true,
      note: "What the first factor proved, carried so the issued session claims both halves.",
    }),
    attempts: classified(integer("attempts").notNull().default(0), {
      ...ephemeralChallenge,
      loggable: true,
      note: "Capped at 5, as for an OTP. Exhaustion kills the challenge (PROJECT.md 4.7).",
    }),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    consumedAt: classified(timestamp("consumed_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("mfa_challenges_expiry_idx").on(t.expiresAt),
    tenantIsolationPolicy("mfa_challenges"),
  ],
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
    projectId: projectIdColumn(() => projects.id),
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
    backupEligible: classified(boolean("backup_eligible").notNull().default(false), {
      ...accountOperational,
      note: "The signed BE flag. Fixed for the credential's life: an authenticator that changes it is not the one we registered.",
    }),
    backupState: classified(boolean("backup_state").notNull().default(false), {
      ...accountOperational,
      note: "The signed BS flag, which does move: an eligible credential is backed up later, not at registration.",
    }),
    lastUsedAt: classified(timestamp("last_used_at", { withTimezone: true }), {
      ...accountOperational,
      subjectField: true,
      note: "Advanced on every successful assertion, so the owner can tell which passkey is stale.",
    }),
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
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
).enableRLS();
