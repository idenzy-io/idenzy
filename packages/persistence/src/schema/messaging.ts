import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
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
  },
  (t) => [
    index("outbox_unpublished_idx").on(t.publishedAt, t.createdAt),
    tenantIsolationPolicy("outbox"),
  ],
).enableRLS();
