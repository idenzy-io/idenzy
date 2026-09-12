import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
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
import { config, credential } from "./presets.js";
import {
  createdAtColumn,
  projectIdColumn,
  tenantIsolationPolicy,
  updatedAtColumn,
} from "./shared.js";

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
    projectId: projectIdColumn(),
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
  (t) => [
    uniqueIndex("email_templates_project_type_locale_key").on(t.projectId, t.type, t.locale),
    tenantIsolationPolicy("email_templates"),
  ],
).enableRLS();

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
    projectId: projectIdColumn(),
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
  (t) => [primaryKey({ columns: [t.projectId] }), tenantIsolationPolicy("sms_policies")],
).enableRLS();

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
    projectId: projectIdColumn(),
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
    tenantIsolationPolicy("suppressions"),
  ],
).enableRLS();

/** Customer webhook endpoints. Only the secret hash is stored. */
export const webhooks = classifiedTable(
  "webhooks",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    url: classified(text("url").notNull(), config),
    secretHash: classified(text("secret_hash").notNull(), credential),
    events: classified(text("events").array().notNull().default([]), config),
    enabled: classified(boolean("enabled").notNull().default(true), config),
    createdAt: createdAtColumn(),
  },
  (t) => [index("webhooks_project_idx").on(t.projectId), tenantIsolationPolicy("webhooks")],
).enableRLS();

/** Delivery attempts, retained short-term for the customer's debugging. */
export const webhookDeliveries = classifiedTable(
  "webhook_deliveries",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
    webhookId: classified(
      uuid("webhook_id")
        .notNull()
        .references(() => webhooks.id, { onDelete: "cascade" }),
      config,
    ),
    event: classified(text("event").notNull(), { ...delivery, loggable: true }),
    payload: classified(jsonb("payload").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.MessageDelivery,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
      note: "Event payloads carry user data, so they expire on the short retention clock.",
    }),
    statusCode: classified(integer("status_code"), { ...delivery, loggable: true }),
    attempts: classified(integer("attempts").notNull().default(0), { ...delivery, loggable: true }),
    deliveredAt: classified(timestamp("delivered_at", { withTimezone: true }), delivery),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhookId),
    tenantIsolationPolicy("webhook_deliveries"),
  ],
).enableRLS();

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
    projectId: projectIdColumn(),
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
    tenantIsolationPolicy("outbox"),
  ],
).enableRLS();
