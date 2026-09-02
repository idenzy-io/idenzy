import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { config, credential, ephemeralChallenge } from "./presets.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/**
 * OTP challenges, the default passwordless path (PROJECT.md 4.7).
 *
 * The target is stored hashed, not in clear: an OTP table is a list of who is signing in
 * right now, and hashing it means a read of this table alone yields no addresses.
 */
export const otpChallenges = classifiedTable(
  "otp_challenges",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    channel: classified(text("channel").notNull(), { ...config, loggable: true }),
    targetHash: classified(text("target_hash").notNull(), ephemeralChallenge),
    codeHash: classified(text("code_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    flowId: classified(text("flow_id").notNull(), ephemeralChallenge),
    attempts: classified(integer("attempts").notNull().default(0), {
      ...config,
      retention: Retention.Days30,
      loggable: true,
      note: "Capped at 5. Exhaustion invalidates the challenge (PROJECT.md 4.7).",
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
    index("otp_challenges_project_target_idx").on(t.projectId, t.targetHash),
    index("otp_challenges_expiry_idx").on(t.expiresAt),
    tenantIsolationPolicy("otp_challenges"),
  ],
).enableRLS();

/**
 * Magic link tokens.
 *
 * `redirectUri` is resolved against the project allowlist at issue time and stored, so
 * the redirect target cannot be changed between sending the mail and clicking it. The
 * link lands on the customer's own route, never a page of ours (PROJECT.md 4.7).
 */
export const magicLinkTokens = classifiedTable(
  "magic_link_tokens",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    tokenHash: classified(text("token_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    userId: classified(uuid("user_id"), ephemeralChallenge),
    redirectUri: classified(text("redirect_uri").notNull(), {
      ...config,
      retention: Retention.Days30,
      note: "Validated against redirect_uris at issue time and pinned for the token's life.",
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
    uniqueIndex("magic_link_tokens_hash_key").on(t.tokenHash),
    tenantIsolationPolicy("magic_link_tokens"),
  ],
).enableRLS();

/** In-flight OAuth authorization codes. Holds the PKCE verifier hash, state and nonce. */
export const oauthFlows = classifiedTable(
  "oauth_flows",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    provider: classified(text("provider").notNull(), { ...config, loggable: true }),
    codeVerifierHash: classified(text("code_verifier_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    state: classified(text("state").notNull(), {
      ...ephemeralChallenge,
      note: "Bound to the client session. Mismatch is the CSRF signal (PROJECT.md 4.6).",
    }),
    nonce: classified(text("nonce"), ephemeralChallenge),
    redirectUri: classified(text("redirect_uri").notNull(), {
      ...config,
      retention: Retention.Days30,
    }),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("oauth_flows_project_state_key").on(t.projectId, t.state),
    index("oauth_flows_expiry_idx").on(t.expiresAt),
    tenantIsolationPolicy("oauth_flows"),
  ],
).enableRLS();
