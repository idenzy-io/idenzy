import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
  SubjectPopulation,
} from "@idenzy/compliance/classification/vocabulary";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { config, credential, ephemeralChallenge, securitySignal } from "./presets.js";
import { projects } from "./projects.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/** A server-side session. Revocable individually or in bulk (PROJECT.md 4.2). */
export const sessions = classifiedTable(
  "sessions",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    deviceId: classified(text("device_id"), securitySignal),
    deviceName: classified(text("device_name"), {
      ...securitySignal,
      note: "Client-supplied label for the 'your devices' list. Free text a user often puts their own name in, so it is PII and never a security decision.",
    }),
    ip: classified(text("ip"), {
      ...securitySignal,
      note: "Personal data under GDPR. Retained one year for abuse investigation.",
    }),
    userAgent: classified(text("user_agent"), securitySignal),
    amr: classified(text("amr").array().notNull().default([]), {
      ...config,
      loggable: true,
      note: "Authentication methods used, mirrored into the access token amr claim.",
    }),
    factorVerifiedAt: classified(timestamp("factor_verified_at", { withTimezone: true }), {
      ...config,
      note: "Backs the fva claim, so step-up can require a recent second factor.",
    }),
    lastActiveAt: classified(
      timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
      {
        ...securitySignal,
        class: DataClass.Operational,
        subjectField: true,
        erasure: Erasure.NotApplicable,
      },
    ),
    idleExpiresAt: classified(
      timestamp("idle_expires_at", { withTimezone: true }).notNull(),
      config,
    ),
    absoluteExpiresAt: classified(
      timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
      config,
    ),
    revokedAt: classified(timestamp("revoked_at", { withTimezone: true }), config),
    revokeReason: classified(text("revoke_reason"), { ...config, loggable: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("sessions_project_user_idx").on(t.projectId, t.userId),
    index("sessions_absolute_expiry_idx").on(t.absoluteExpiresAt),
    tenantIsolationPolicy("sessions"),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
).enableRLS();

/**
 * Rotating refresh tokens with family-based reuse detection (PROJECT.md 4.2).
 *
 * Only the SHA-256 hash is stored. `familyId` groups every token descended from one
 * sign-in, and `parentId` records the rotation chain: presenting a token whose `usedAt`
 * is already set means the whole family is compromised and must be revoked.
 */
export const refreshTokens = classifiedTable(
  "refresh_tokens",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    sessionId: classified(
      uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    familyId: classified(uuid("family_id").notNull(), {
      ...config,
      loggable: true,
      note: "Reuse of any member revokes the entire family.",
    }),
    tokenHash: classified(text("token_hash").notNull(), credential),
    parentId: classified(uuid("parent_id"), config),
    usedAt: classified(timestamp("used_at", { withTimezone: true }), {
      ...config,
      note: "Non-null means rotated. Presenting it again is the reuse signal.",
    }),
    revokedAt: classified(timestamp("revoked_at", { withTimezone: true }), config),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), config),
    deviceKeyId: classified(text("device_key_id"), {
      ...config,
      note: "Set when the client bound the token to a Secure Enclave key (PROJECT.md 4.4).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_key").on(t.tokenHash),
    index("refresh_tokens_family_idx").on(t.familyId),
    index("refresh_tokens_session_idx").on(t.sessionId),
    tenantIsolationPolicy("refresh_tokens"),
  ],
).enableRLS();

/** Idempotency and replay protection for mutating management endpoints. */
export const idempotencyKeys = classifiedTable(
  "idempotency_keys",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    key: classified(text("key").notNull(), ephemeralChallenge),
    requestFingerprint: classified(text("request_fingerprint").notNull(), ephemeralChallenge),
    responseStatus: classified(text("response_status"), ephemeralChallenge),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), {
      class: DataClass.Operational,
      purpose: Purpose.ServiceConfiguration,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_project_key").on(t.projectId, t.key),
    tenantIsolationPolicy("idempotency_keys"),
  ],
).enableRLS();
