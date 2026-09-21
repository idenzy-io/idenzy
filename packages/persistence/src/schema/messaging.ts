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
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { config } from "./presets.js";
import { projects } from "./projects.js";
import { createdAtColumn, projectIdColumn, updatedAtColumn } from "./shared.js";

const delivery = {
  class: DataClass.Operational,
  purpose: Purpose.MessageDelivery,
  retention: Retention.ProjectLifetime,
  erasure: Erasure.NotApplicable,
} as const;

/** Per-project, per-locale transactional templates. */
export const emailTemplates = classifiedTable(
  "email_templates",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), delivery),
    projectId: projectIdColumn(() => projects.id),
    type: classified(text("type").notNull(), { ...delivery, loggable: true }),
    locale: classified(text("locale").notNull(), { ...delivery, loggable: true }),
    subject: classified(text("subject").notNull(), delivery),
    mjml: classified(text("mjml").notNull(), delivery),
    html: classified(text("html"), { ...delivery, note: "Compiled output, cached by version." }),
    text: classified(text("text"), delivery),
    version: classified(integer("version").notNull().default(1), delivery),
    updatedBy: classified(text("updated_by"), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Years1,
      erasure: Erasure.RetainPseudonymous,
      note: "Customer staff identifier, kept for change attribution.",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("email_templates_project_type_locale_key").on(t.projectId, t.type, t.locale)],
);

/**
 * The fraud and spend controls every SMS send is measured against (PROJECT.md 4.8).
 *
 * One row per project, read on the request path before a message costs anything. The
 * controls live in the database rather than in Valkey because this is the only limit
 * whose failure mode is a bill: a cache outage must not be able to lift a spend cap, and
 * `usage_daily.sms_cost` is already the durable counter to measure against.
 *
 * `allowedCountries` defaults to empty and that is the point. SMS pumping picks the
 * destination, so the countries a product does not serve are exactly the ones an
 * attacker sends to, and a default-allow list is one nobody ever narrows.
 *
 * `dailySpendCap` carries the same precision as `usage_daily.sms_cost`, so the cap and
 * the spend are compared as they are stored and no conversion sits between them.
 */
export const smsPolicies = classifiedTable(
  "sms_policies",
  {
    projectId: projectIdColumn(() => projects.id),
    allowedCountries: classified(text("allowed_countries").array().notNull().default([]), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
      loggable: true,
      note: "ISO 3166-1 alpha-2, default deny. Empty means the project sends no SMS at all.",
    }),
    dailySpendCap: classified(
      numeric("daily_spend_cap", { precision: 12, scale: 6 }).notNull().default("2.000000"),
      {
        ...delivery,
        purpose: Purpose.SecurityAndAbusePrevention,
        note: "Hard stop, not an alert threshold. Same scale as usage_daily.sms_cost.",
      },
    ),
    currency: classified(text("currency").notNull().default("USD"), delivery),
    attestationRequired: classified(boolean("attestation_required").notNull().default(true), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
      loggable: true,
      note: "On by default. A project turning it off is accepting the pumping risk itself.",
    }),
    perNumberDailyLimit: classified(integer("per_number_daily_limit").notNull().default(5), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
    }),
    perIpHourlyLimit: classified(integer("per_ip_hourly_limit").notNull().default(10), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
    }),
    maxSendsPerVerify: classified(integer("max_sends_per_verify").notNull().default(6), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
      note: "Pumping signal: codes that are never entered. Applied above a daily floor.",
    }),
    senderId: classified(text("sender_id"), {
      ...delivery,
      note: "Alphanumeric sender id, registered per country. Null uses the shared number.",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [primaryKey({ columns: [t.projectId] })],
);

/**
 * Addresses that must never be sent to again.
 *
 * Hard bounces and complaints. Enforced by the EmailProvider base class before any
 * transport runs, so no adapter can skip it (PROJECT.md 11.1).
 */
export const suppressions = classifiedTable(
  "suppressions",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), delivery),
    projectId: projectIdColumn(() => projects.id),
    channel: classified(text("channel").notNull(), { ...delivery, loggable: true }),
    targetHash: classified(text("target_hash").notNull(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.MessageDelivery,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.RetainPseudonymous,
      note: "Hashed, so a suppression list is not a harvestable address list.",
    }),
    reason: classified(text("reason").notNull(), { ...delivery, loggable: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("suppressions_project_channel_target_key").on(t.projectId, t.channel, t.targetHash),
  ],
);

/**
 * Customer webhook endpoints, and the secret each one's deliveries are signed with.
 *
 * **The secret is encrypted, not hashed** (ADR-0012), which revises PROJECT.md 12. A digest
 * cannot sign, and a column called `secret_hash` on a table whose whole purpose is producing
 * HMACs was a design that could not work. So it is envelope-encrypted under the project's own
 * data key with the project id as additional authenticated data, exactly as provider credentials
 * and TOTP secrets are: we can sign, and we do not re-reveal. The second half is a policy with an
 * audit trail behind it rather than a property of the storage, and saying which is which is the
 * whole of what the panel's note asked for.
 *
 * Rotation is two secrets in force at once. The new one signs first, the previous one keeps
 * signing until `previous_secret_until`, and both appear in the header so a customer can redeploy
 * their verifier inside the window without a failed delivery. The old ciphertext is cleared when
 * the window closes, which is a write somebody has to make: a rotation is not finished by time
 * passing.
 */
export const webhooks = classifiedTable(
  "webhooks",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    url: classified(text("url").notNull(), config),
    /** The customer's own note about what this endpoint is for. Shown, never parsed. */
    description: classified(text("description").notNull().default(""), config),
    secretCiphertext: encrypted(text("secret_ciphertext").notNull(), {
      class: DataClass.Secret,
      purpose: Purpose.MessageDelivery,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
      note: "Encrypted rather than hashed: signing needs the value back (ADR-0012).",
    }),
    /** The secret before the last rotation, still signing until the window closes. */
    previousSecretCiphertext: encrypted(text("previous_secret_ciphertext"), {
      class: DataClass.Secret,
      purpose: Purpose.MessageDelivery,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
    }),
    previousSecretUntil: classified(
      timestamp("previous_secret_until", { withTimezone: true }),
      config,
    ),
    /** When the secret was last replaced. Null means it is the one the endpoint was made with. */
    rolledAt: classified(timestamp("rolled_at", { withTimezone: true }), config),
    events: classified(text("events").array().notNull().default([]), config),
    /**
     * Everything, including events that do not exist yet.
     *
     * A flag rather than a list kept in step with the catalogue: a project that asked for
     * everything means everything, and a new event type must not silently miss the endpoints
     * whose owner said so.
     */
    allEvents: classified(boolean("all_events").notNull().default(false), config),
    /**
     * Whether the fan-out will write a delivery for it. Defaults to off, on purpose.
     *
     * The screen makes a new endpoint start off so a test event can come before real ones, and
     * the column agrees with it: a row inserted by something that forgot the flag is silent
     * rather than live.
     */
    enabled: classified(boolean("enabled").notNull().default(false), config),
    /** When it was switched off, and by what. Null exactly while `enabled` is true. */
    disabledAt: classified(timestamp("disabled_at", { withTimezone: true }), config),
    /** `paused` for a person, `failing` for the breaker. Null while it is on. */
    disabledReason: classified(text("disabled_reason"), { ...config, loggable: true }),
    /** The membership that paused it. Null for the breaker, which is nobody. */
    disabledBy: classified(uuid("disabled_by"), config),
    /**
     * Consecutive failed deliveries, which is the breaker's durable half.
     *
     * Valkey holds the hot counter; this is what survives a cache restart, so an endpoint
     * nineteen failures deep is not forgiven by an unrelated eviction.
     */
    consecutiveFailures: classified(integer("consecutive_failures").notNull().default(0), {
      ...config,
      loggable: true,
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // The fan-out's own query: every enabled endpoint on a project, per event.
    index("webhooks_project_enabled_idx").on(t.projectId, t.enabled),
  ],
);

/**
 * Deliveries: the work still owed, and a short window of what happened (ADR-0012).
 *
 * This table is a queue rather than a log, which is the decision that makes webhooks affordable
 * at the volume the plan aims at. A row exists while the delivery is open; on a terminal outcome
 * the payload is cleared and the row is dropped once it leaves the 72-hour window. What it is
 * deliberately not is a record of every delivery ever made: 100M rows a month of somebody else's
 * 200 responses, on the instance that authenticates users, would cost more than the sending.
 *
 * `attempts` is a bounded JSON array rather than a child table, capped by
 * `WEBHOOK_MAX_ATTEMPTS`: a delivery has at most eight of them, they are only ever read together
 * with the delivery, and a second table would double the row count of the busiest write path we
 * have to store a list that cannot grow.
 *
 * Not partitioned yet. Daily partitions dropped by a retention pass are the plan, and the pass
 * that drops them is the same worker that will maintain them — shipping the partitions before
 * their keeper is a table that stops accepting inserts on a date nobody wrote down.
 */
export const webhookDeliveries = classifiedTable(
  "webhook_deliveries",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    webhookId: classified(
      uuid("webhook_id")
        .notNull()
        .references(() => webhooks.id, { onDelete: "cascade" }),
      config,
    ),
    event: classified(text("event").notNull(), { ...delivery, loggable: true }),
    /**
     * The event's place in the outbox's total order, carried through to the receiver.
     *
     * Delivery is unordered by construction, so this is how a receiver that cares about order
     * sorts rather than assumes. It is also what makes the fan-out idempotent: the same event
     * relayed twice would produce the same (endpoint, sequence) pair.
     */
    sequence: classified(bigint("sequence", { mode: "number" }).notNull(), {
      ...delivery,
      loggable: true,
    }),
    /** `queued`, `delivering`, `delivered` or `failed`. The screen's pending is the first two. */
    status: classified(text("status").notNull().default("queued"), {
      ...delivery,
      loggable: true,
    }),
    /**
     * The body as signed, while the delivery might still be sent.
     *
     * Cleared the moment a delivery is taken, which is both cheaper and less exposure: an event
     * payload names a user, and keeping it for a month would put a copy of their data in the
     * erasure path for the sake of a record that a 200 came back (PROJECT.md 4.13.6). A *failed*
     * delivery keeps it until the window drops the row, because a replay sends the body it was
     * signed from — clearing it on either outcome made the replay route impossible to honour.
     */
    payload: classified(jsonb("payload"), {
      class: DataClass.Pii,
      purpose: Purpose.MessageDelivery,
      retention: Retention.Hours72,
      erasure: Erasure.RowDeleted,
      note: "Cleared when a delivery is taken; a failed one keeps it for the window, so a replay can send it.",
    }),
    attemptCount: classified(integer("attempt_count").notNull().default(0), {
      ...delivery,
      loggable: true,
    }),
    /**
     * One entry per attempt, oldest first: when, what answered, how long it took, and an
     * excerpt of the response.
     *
     * The excerpt is the customer's own bytes coming back and is capped, because it is shown on
     * a screen and could carry anything their server chose to say.
     */
    attemptLog: classified(jsonb("attempt_log").notNull().default([]), {
      class: DataClass.Pii,
      purpose: Purpose.MessageDelivery,
      retention: Retention.Hours72,
      erasure: Erasure.RowDeleted,
      note: "Carries a capped excerpt of the receiver's own response, which may contain anything.",
    }),
    /**
     * When the event happened, which is not when this row was written.
     *
     * The envelope promises a receiver the instant of the event, and the row is the only thing the
     * dispatcher reads — so without this column that promise was quietly the relay's own schedule:
     * seconds out normally, minutes or hours out after a cold start or a backlog. It comes from the
     * outbox row and never moves, so a retry a day later carries the instant the first attempt did.
     */
    occurredAt: classified(
      timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      delivery,
    ),
    /** When the next attempt is due. Null once the delivery is terminal. */
    nextAttemptAt: classified(timestamp("next_attempt_at", { withTimezone: true }), delivery),
    deliveredAt: classified(timestamp("delivered_at", { withTimezone: true }), delivery),
    /** Sent by "send a test event" rather than by something that happened. */
    test: classified(boolean("test").notNull().default(false), { ...delivery, loggable: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // What the screen reads: one endpoint's deliveries, newest first.
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
    // What the dispatcher reads: everything due, across projects, oldest first. Partial on
    // `next_attempt_at` so the index holds open deliveries only and not the window behind them.
    index("webhook_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.nextAttemptAt} is not null`),
    // The fan-out writes one delivery per endpoint per event, and relaying the same outbox row
    // twice must not send it twice.
    uniqueIndex("webhook_deliveries_webhook_sequence_key").on(t.webhookId, t.sequence),
  ],
);

/**
 * What an endpoint has done, a day at a time.
 *
 * The health figures on the screen are counters rather than a scan: reading "97% delivered over
 * seven days" out of the delivery window would mean scanning every delivery a project made, which
 * is the cost the window exists to avoid. Valkey holds the live counters and this is the rollup
 * they land in, so the figures survive a cache restart and a day's row is one row per endpoint.
 *
 * Kept for as long as the project rather than for 72 hours, because a count is not an event: it
 * names nobody, a day's row is a few dozen bytes, and a customer asking whether last month was
 * worse than this one is asking about exactly this.
 */
export const webhookEndpointStats = classifiedTable(
  "webhook_endpoint_stats",
  {
    projectId: projectIdColumn(() => projects.id),
    webhookId: classified(
      uuid("webhook_id")
        .notNull()
        .references(() => webhooks.id, { onDelete: "cascade" }),
      config,
    ),
    /** The UTC day being counted. One row per endpoint per day. */
    day: classified(date("day").notNull(), { ...config, loggable: true }),
    delivered: classified(integer("delivered").notNull().default(0), { ...config, loggable: true }),
    failed: classified(integer("failed").notNull().default(0), { ...config, loggable: true }),
    /** Attempts made, which is more than deliveries: a retry is an attempt and not a delivery. */
    attempts: classified(integer("attempts").notNull().default(0), { ...config, loggable: true }),
    lastDeliveredAt: classified(timestamp("last_delivered_at", { withTimezone: true }), config),
    lastFailedAt: classified(timestamp("last_failed_at", { withTimezone: true }), config),
  },
  (t) => [primaryKey({ columns: [t.webhookId, t.day] })],
);

/**
 * Transactional outbox (PROJECT.md 9.4).
 *
 * Written in the same transaction as the state change, then relayed to Pub/Sub, so we
 * never emit an event for a write that rolled back.
 */
export const outbox = classifiedTable(
  "outbox",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    topic: classified(text("topic").notNull(), { ...config, loggable: true }),
    payload: classified(jsonb("payload").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.MessageDelivery,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
    }),
    attempts: classified(integer("attempts").notNull().default(0), { ...config, loggable: true }),
    publishedAt: classified(timestamp("published_at", { withTimezone: true }), config),
    createdAt: createdAtColumn(),
    seq: classified(
      bigint("seq", { mode: "number" }).notNull().default(sql`nextval('outbox_seq')`),
      {
        ...config,
        loggable: true,
        note: "Total order for consumers, from one cluster sequence. A consumer's watermark cannot be created_at: it ties at millisecond precision, so an event sharing the last instant would be skipped by an exclusive bound and never relayed (PROJECT.md 4.13.3).",
      },
    ),
  },
  (t) => [
    index("outbox_unpublished_idx").on(t.publishedAt, t.createdAt),
    index("outbox_topic_seq_idx").on(t.topic, t.seq),
  ],
);

/**
 * Counters kept as long as the daily usage rollup is, because they answer the same kind of
 * question over the same window and a rate whose two halves aged out separately would be wrong
 * rather than merely stale.
 */
const deliveryStat = {
  ...delivery,
  retention: Retention.Years2,
  loggable: true,
} as const;

/**
 * A received provider event, kept only long enough to make a redelivery idempotent.
 *
 * SNS retries for hours, not months, so the window a duplicate can arrive in is short; keeping
 * the ledger past it would be storing rows whose only purpose has expired.
 */
const providerEvent = {
  ...delivery,
  retention: Retention.Days30,
  loggable: true,
} as const;

/**
 * Deliverability as SES reports it, per project per day.
 *
 * The denominator and the numerator of the bounce rate come from this one table on purpose.
 * `usage_daily.emails_sent` counts what we handed to SES, which is not the same population as
 * what SES then told us about — a message rejected before it left has no delivery event, and a
 * rate computed across the two would move whenever the pipeline lagged rather than when a
 * customer's list got worse.
 *
 * Counts and never addresses. Which address bounced is a `suppressions` row and is a digest
 * there; this table is arithmetic and holds nothing about anybody.
 */
export const emailDeliveryStats = classifiedTable(
  "email_delivery_stats",
  {
    projectId: projectIdColumn(() => projects.id),
    day: classified(date("day").notNull(), {
      ...deliveryStat,
      note: "UTC day the event was received, not the day the message was sent.",
    }),
    sent: classified(bigint("sent", { mode: "number" }).notNull().default(0), {
      ...deliveryStat,
      note: "SES accepted it. The denominator every rate on this row is over.",
    }),
    delivered: classified(
      bigint("delivered", { mode: "number" }).notNull().default(0),
      deliveryStat,
    ),
    bouncedHard: classified(bigint("bounced_hard", { mode: "number" }).notNull().default(0), {
      ...deliveryStat,
      note: "Permanent bounces. These suppress the address as well as counting here.",
    }),
    bouncedSoft: classified(bigint("bounced_soft", { mode: "number" }).notNull().default(0), {
      ...deliveryStat,
      note: "Transient and undetermined. They suppress nothing and still count towards our rate at AWS.",
    }),
    complained: classified(
      bigint("complained", { mode: "number" }).notNull().default(0),
      deliveryStat,
    ),
    rejected: classified(bigint("rejected", { mode: "number" }).notNull().default(0), {
      ...deliveryStat,
      note: "SES refused it outright, usually for a virus or an address on its account suppression list.",
    }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.day] }),
    index("email_delivery_stats_day_idx").on(t.day),
  ],
);

/**
 * A project whose sending is stopped because its bounce or complaint rate would cost us the
 * SES account (risks.md 2).
 *
 * A stored decision rather than a rate recomputed on every send, for three reasons. It is one
 * indexed read on the send path instead of a windowed aggregate. It is a record somebody can
 * be shown, with the figures that caused it, rather than a number that has since moved. And it
 * can be released by a person — an automated denial with no manual override is a control that
 * will eventually be wrong at the worst possible moment, which is the argument risks.md 7 makes
 * about the billing controls and applies here word for word.
 *
 * A release keeps the row. What was decided, on what evidence, and who undid it outlives the
 * block, exactly as a suppression release does.
 */
export const emailSendingHolds = classifiedTable(
  "email_sending_holds",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), delivery),
    projectId: projectIdColumn(() => projects.id),
    reason: classified(text("reason").notNull(), {
      ...delivery,
      purpose: Purpose.SecurityAndAbusePrevention,
      loggable: true,
      note: "Which rate tripped: bounce_rate or complaint_rate.",
    }),
    bounceRatePpm: classified(integer("bounce_rate_ppm").notNull(), {
      ...delivery,
      loggable: true,
      note: "Parts per million, so a 5% threshold is an integer comparison and not a float one.",
    }),
    complaintRatePpm: classified(integer("complaint_rate_ppm").notNull(), {
      ...delivery,
      loggable: true,
    }),
    observedSends: classified(bigint("observed_sends", { mode: "number" }).notNull(), {
      ...delivery,
      loggable: true,
      note: "What the rates were over. Below the floor no rate is actionable, so this is the evidence.",
    }),
    openedAt: classified(timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(), {
      ...delivery,
      loggable: true,
    }),
    releasedAt: classified(timestamp("released_at", { withTimezone: true }), {
      ...delivery,
      loggable: true,
      note: "Null is the open hold. The partial unique index is what keeps there being only one.",
    }),
    releasedBy: classified(text("released_by"), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.RetainPseudonymous,
      note: "Staff identifier, or null where the breaker released it because the window went clean.",
    }),
    releasedReason: classified(text("released_reason"), delivery),
  },
  (t) => [
    uniqueIndex("email_sending_holds_open_key").on(t.projectId).where(sql`released_at is null`),
    index("email_sending_holds_project_opened_idx").on(t.projectId, t.openedAt),
  ],
);

/**
 * Every SES delivery event we have been told about, once.
 *
 * The same shape and the same argument as `payment_provider_events`: SNS delivers at least
 * once, the receiver has no tenant bound when the message lands, and the unique index is the
 * idempotency check rather than a lookup before one. Without it a redelivered bounce would be
 * counted twice, and a rate is the one thing double counting actually breaks — suppressing an
 * address twice is harmless, deciding a project bounces at 10% when it bounces at 5% is not.
 *
 * **It keeps no payload, and that is the divergence.** `payment_provider_events` stores the
 * provider's verbatim body because a disputed charge is reconciled against it. A bounce is not
 * evidence of anything anybody will dispute, and its payload carries the recipient address and
 * a diagnostic code that usually repeats it — so storing it would put personal data in a table
 * for no purpose that survives being asked what the purpose is. What is kept is the verdict:
 * enumerated, not identifying, and all the breaker and the suppression decision ever read.
 */
export const emailProviderEvents = classifiedTable(
  "email_provider_events",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), providerEvent),
    provider: classified(text("provider").notNull(), providerEvent),
    providerEventId: classified(text("provider_event_id").notNull(), {
      ...providerEvent,
      note: "The SNS MessageId. The insert is the idempotency check, not a lookup before it.",
    }),
    type: classified(text("type").notNull(), providerEvent),
    projectId: classified(uuid("project_id"), {
      ...providerEvent,
      note: "From the message tag. Null where the message was sent before sends carried one. No FK: unlike a tenant table this row exists before the project is resolved.",
    }),
    bounceType: classified(text("bounce_type"), {
      ...providerEvent,
      note: "Permanent, Transient or Undetermined. Only Permanent suppresses.",
    }),
    bounceSubType: classified(text("bounce_sub_type"), providerEvent),
    receivedAt: classified(
      timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
      providerEvent,
    ),
    processedAt: classified(timestamp("processed_at", { withTimezone: true }), {
      ...providerEvent,
      note: "Null means received and not yet acted on.",
    }),
    failureReason: classified(text("failure_reason"), providerEvent),
  },
  (t) => [
    uniqueIndex("email_provider_events_provider_event_key").on(t.provider, t.providerEventId),
    index("email_provider_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`processed_at is null`),
  ],
);
