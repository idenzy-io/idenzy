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
import { index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { config, credential, ephemeralChallenge } from "./presets.js";
import { projects } from "./projects.js";
import { createdAtColumn, projectIdColumn } from "./shared.js";

/**
 * OTP challenges, the default passwordless path (PROJECT.md 4.7).
 *
 * The target is stored twice and never in clear. `target_hash` is what "is there already
 * a live code for this address" is asked against, and it is a plain digest because that
 * lookup has to be an index seek. `target_encrypted` is what verification reads back to
 * learn which address proved control, and it is envelope encrypted under the project's
 * own data key (PROJECT.md 4.13.4).
 *
 * Both are needed. A hash alone cannot be reversed, and a flow that cannot name the
 * address cannot create the account behind it, which is what OTP sign-up is. Encryption
 * alone cannot be searched. Together, a read of this table yields no addresses, which is
 * the property worth having: an OTP table is a list of who is signing in right now.
 */
export const otpChallenges = classifiedTable(
  "otp_challenges",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    channel: classified(text("channel").notNull(), { ...config, loggable: true }),
    targetHash: classified(text("target_hash").notNull(), ephemeralChallenge),
    targetEncrypted: encrypted(text("target_encrypted").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      subjectField: true,
      erasure: Erasure.RowDeleted,
      note: "The address itself, read back at verification to establish the subject.",
    }),
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
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: null,
      note: "Holds a hash of the address rather than the address, so a subject is reached by hashing their identifier the same way rather than by a lookup. Short-lived besides: the retention sweep clears these well inside any statutory deadline.",
    },
  },
);

/**
 * The nonce a WebAuthn ceremony has to sign over (PROJECT.md 4.7).
 *
 * Only the digest is kept. Unlike the OAuth verifier we never have to present this value
 * to anybody: the browser sends the challenge back inside `clientDataJSON` and our only
 * job is to say whether it is the one we issued, which a comparison of digests answers.
 * So a leak of this table yields nothing an attacker could sign against.
 *
 * `userId` is set for registration and null for authentication, and the asymmetry is the
 * design rather than a missing column. Registration happens inside a session, so the
 * challenge is pinned to the account it may enrol a credential onto and cannot be
 * redirected to another. Authentication has nobody yet: the credential the browser
 * chooses is what names the user, which is what makes a passkey sign-in usernameless.
 */
export const webauthnChallenges = classifiedTable(
  "webauthn_challenges",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    ceremony: classified(text("ceremony").notNull(), { ...config, loggable: true }),
    challengeHash: classified(text("challenge_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    userId: classified(
      uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
      {
        ...ephemeralChallenge,
        loggable: true,
        note: "Set for registration, which happens in a session. Null for authentication.",
      },
    ),
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
    uniqueIndex("webauthn_challenges_hash_key").on(t.challengeHash),
    index("webauthn_challenges_expiry_idx").on(t.expiresAt),
    // What an erasure deletes by, over the rows that name somebody.
    index("webauthn_challenges_user_idx").on(t.projectId, t.userId).where(sql`user_id is not null`),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
      note: "Null for a sign-in ceremony, which names nobody until the credential does, and expires within minutes.",
    },
  },
);

/**
 * Magic link tokens.
 *
 * `redirectUri` is resolved against the project allowlist at issue time and stored, so
 * the redirect target cannot be changed between sending the mail and clicking it. The
 * link lands on the customer's own route, never a page of ours (PROJECT.md 4.7).
 *
 * `targetEncrypted` carries the address for the same reason `otp_challenges` does: the
 * click has to be able to name who it belongs to, and a link for an address with no
 * account yet has no `userId` to point at.
 */
export const magicLinkTokens = classifiedTable(
  "magic_link_tokens",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    tokenHash: classified(text("token_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    userId: classified(uuid("user_id"), ephemeralChallenge),
    targetEncrypted: encrypted(text("target_encrypted").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      subjectField: true,
      erasure: Erasure.RowDeleted,
      note: "The address the link was sent to, read back when it is clicked.",
    }),
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
    // What an erasure deletes by. A link for an address with no account names nobody.
    index("magic_link_tokens_user_idx").on(t.projectId, t.userId).where(sql`user_id is not null`),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
);

/**
 * In-flight OAuth authorizations: the PKCE verifier, state and nonce (PROJECT.md 4.6).
 *
 * The verifier is **encrypted, not hashed**, and that is a correction rather than a
 * preference. We are the OAuth client here, so we have to present the verifier itself at
 * the token endpoint; a digest is a value nobody can present. Every other single-use
 * secret in this schema is hashed because we only ever compare it, and this one is the
 * exception because we have to reproduce it.
 *
 * `consumedAt` is what makes `state` a one-shot CSRF token rather than a value that
 * merely has to match, and it is decided by the database so two callbacks racing on one
 * state cannot both proceed.
 */
export const oauthFlows = classifiedTable(
  "oauth_flows",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    provider: classified(text("provider").notNull(), { ...config, loggable: true }),
    codeVerifierEncrypted: encrypted(text("code_verifier_encrypted").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
      note: "Presented to the provider at the token exchange, so it cannot be a digest.",
    }),
    state: classified(text("state").notNull(), {
      ...ephemeralChallenge,
      note: "Bound to the client session. Mismatch is the CSRF signal (PROJECT.md 4.6).",
    }),
    nonce: classified(text("nonce"), ephemeralChallenge),
    redirectUri: classified(text("redirect_uri").notNull(), {
      ...config,
      retention: Retention.Days30,
      note: "The customer route this flow returns to. Re-checked against the allowlist.",
    }),
    clientCodeChallenge: classified(text("client_code_challenge"), {
      ...ephemeralChallenge,
      note: "The SDK's PKCE challenge for OUR exchange code. Not code_verifier_encrypted, which is ours for the provider.",
    }),
    linkUserId: classified(uuid("link_user_id"), {
      ...config,
      retention: Retention.Days30,
      loggable: true,
      note: "Set when a signed-in user is attaching a provider rather than signing in.",
    }),
    consumedAt: classified(timestamp("consumed_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
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
    // The provider's callback arrives with a state and nothing else, so its project is
    // found from the state alone (resolve_project_by_oauth_state).
    index("oauth_flows_state_idx").on(t.state),
    index("oauth_flows_expiry_idx").on(t.expiresAt),
    // What an erasure deletes by. Only a flow attaching a provider names a user.
    index("oauth_flows_link_user_idx")
      .on(t.projectId, t.linkUserId)
      .where(sql`link_user_id is not null`),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "link_user_id",
      note: "Only a flow attaching a provider to a signed-in user names one. A sign-in flow learns who it is for when it completes, and expires within minutes.",
    },
  },
);

/**
 * Single-use tokens for email verification and password reset.
 *
 * One table rather than one per purpose, because the rules are identical: hashed at
 * rest, one use, short expiry, and consuming one invalidates every other token
 * outstanding for that user and purpose. A second table would be a second place to
 * forget one of those.
 */
export const verificationTokens = classifiedTable(
  "verification_tokens",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    purpose: classified(text("purpose").notNull(), { ...config, loggable: true }),
    tokenHash: classified(text("token_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
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
    uniqueIndex("verification_tokens_hash_key").on(t.tokenHash),
    index("verification_tokens_user_purpose_idx").on(t.projectId, t.userId, t.purpose),
    index("verification_tokens_expiry_idx").on(t.expiresAt),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
);

/**
 * A pending email change, which is two confirmations and not one (PROJECT.md 4.5).
 *
 * Both token hashes live on the request row rather than in `verification_tokens`,
 * because the pair is the unit: neither half means anything alone, and the address only
 * moves when both have been confirmed. Splitting them across rows would make "confirmed
 * one side" a state that has to be reassembled by a join every time it is read.
 *
 * The old address is mailed too, and that is the point of the design: an attacker who
 * has taken an account wants the change to be invisible to the person losing it.
 */
export const emailChangeRequests = classifiedTable(
  "email_change_requests",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    newEmail: classified(text("new_email").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      subjectField: true,
      erasure: Erasure.RowDeleted,
    }),
    oldTokenHash: classified(text("old_token_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    newTokenHash: classified(text("new_token_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    oldConfirmedAt: classified(timestamp("old_confirmed_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    newConfirmedAt: classified(timestamp("new_confirmed_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    appliedAt: classified(timestamp("applied_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.Authentication,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
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
    uniqueIndex("email_change_requests_old_token_key").on(t.oldTokenHash),
    uniqueIndex("email_change_requests_new_token_key").on(t.newTokenHash),
    index("email_change_requests_user_idx").on(t.projectId, t.userId),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
);

/**
 * The single-use code a redirect carries back to the customer's own route
 * (PROJECT.md 4.6, 4.7).
 *
 * Every flow that ends in a browser redirect finishes here: magic link now, OAuth next.
 * The redirect target cannot carry a session, because a token in a URL is a token in
 * browser history, in a Referer header and in the customer's access logs. It carries a
 * code that is worth nothing without a POST from the SDK, and worth nothing twice.
 *
 * `amr` is pinned at issue time so the exchange cannot claim a stronger method than the
 * one that was actually proved.
 */
export const authCodes = classifiedTable(
  "auth_codes",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    userId: classified(
      uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      { ...config, loggable: true },
    ),
    codeHash: classified(text("code_hash").notNull(), {
      ...credential,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    amr: classified(text("amr").array().notNull().default([]), {
      ...config,
      loggable: true,
      note: "Pinned at issue time, so an exchange cannot claim a method it did not prove.",
    }),
    codeChallenge: classified(text("code_challenge"), {
      ...ephemeralChallenge,
      note: "S256 only, and null for magic links, which are clicked in a different browser.",
    }),
    redirectUri: classified(text("redirect_uri").notNull(), {
      ...config,
      retention: Retention.Days30,
      note: "The allowlisted target this code was minted for. Kept for the audit trail.",
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
    uniqueIndex("auth_codes_hash_key").on(t.codeHash),
    index("auth_codes_expiry_idx").on(t.expiresAt),
    // What an erasure deletes by. Without it, deleting one user's codes reads the table.
    index("auth_codes_user_idx").on(t.projectId, t.userId),
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "user_id",
    },
  },
);
