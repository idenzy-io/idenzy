import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
  SubjectPopulation,
} from "@idenzy/compliance/classification/vocabulary";
import { DEFAULT_DSR_DEADLINE_RULE } from "@idenzy/protocol/enums/compliance";
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditRecord, config } from "./presets.js";
import { projects } from "./projects.js";
import { createdAtColumn, projectIdColumn, unreferencedProjectIdColumn } from "./shared.js";

/**
 * The audit trail (PROJECT.md 4.13.3).
 *
 * Two properties are enforced outside this file and matter more than anything in it:
 *
 * 1. `idenzy_app` is granted INSERT and SELECT only. There is no UPDATE or DELETE
 *    privilege on the connection, so no application code path can rewrite history.
 * 2. The table is partitioned by month, so retention is a DROP PARTITION rather than a
 *    mass delete.
 *
 * Both live in hand-authored migrations, because drizzle-kit generates neither. The
 * policy below is only the tenant filter; it is not the integrity control.
 *
 * `prevHash` and `entryHash` form a per-project chain, so tampering by anyone who does
 * hold direct database access is detectable by verifying it.
 */
export const auditEvents = classifiedTable(
  "audit_events",
  {
    id: classified(uuid("id").notNull().defaultRandom(), { ...auditRecord, loggable: true }),
    projectId: unreferencedProjectIdColumn(),
    actorType: classified(text("actor_type").notNull(), { ...auditRecord, loggable: true }),
    actorId: classified(text("actor_id"), {
      ...auditRecord,
      note: "Pseudonymous. Survives erasure so the trail stays attributable.",
    }),
    action: classified(text("action").notNull(), { ...auditRecord, loggable: true }),
    target: classified(text("target"), auditRecord),
    ip: classified(text("ip"), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Years1,
      subjectField: true,
      erasure: Erasure.RetainPseudonymous,
      note: "Retained under legal obligation, so erasure does not clear it (Art.17(3)(b)).",
    }),
    ua: classified(text("ua"), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Years1,
      subjectField: true,
      erasure: Erasure.RetainPseudonymous,
    }),
    metadata: classified(jsonb("metadata").notNull().default({}), auditRecord),
    seq: classified(
      bigint("seq", { mode: "number" }).notNull().default(sql`nextval('audit_events_seq')`),
      {
        ...auditRecord,
        loggable: true,
        note: "Total order across every partition, from one cluster sequence. The chain needs it: created_at ties at millisecond precision, and two entries in the same millisecond would leave the project's tip ambiguous and fork the chain (PROJECT.md 4.13.3).",
      },
    ),
    prevHash: classified(text("prev_hash").notNull(), {
      ...auditRecord,
      note: "Hash of the preceding entry for this project. Genesis is 64 zeroes.",
    }),
    entryHash: classified(text("entry_hash").notNull(), {
      ...auditRecord,
      note: "H(prev_hash || canonical(entry)). Verified on a schedule (4.13.3).",
    }),
    outboxSeq: classified(bigint("outbox_seq", { mode: "number" }), {
      ...auditRecord,
      loggable: true,
      note: "The outbox row this entry was relayed from, and what makes a replay a no-op instead of a duplicate. Null on an entry with no outbox event behind it.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("audit_events_project_created_idx").on(t.projectId, t.createdAt),
    index("audit_events_project_seq_idx").on(t.projectId, t.seq),
    index("audit_events_project_actor_idx").on(t.projectId, t.actorId),
    // One entry per outbox event. `created_at` leads because a unique index on a
    // partitioned table must contain the partition key, and it costs nothing here: a
    // replayed event carries the same instant it did the first time, so the pair is
    // stable and the conflict is detected inside the one partition it belongs to.
    uniqueIndex("audit_events_outbox_seq_key").on(t.createdAt, t.outboxSeq),
    // Read is tenant-scoped; write permission is controlled by grants, not by policy.
  ],
  {
    subject: {
      population: SubjectPopulation.EndUser,
      locatedBy: "actor_id",
      note: "Export only. Erasure must not remove these: the trail keeps the pseudonymous id precisely so an erasure stays provable, which is Art. 17(3)(b) against Art. 17(1).",
    },
  },
);

/**
 * Data-subject requests (PROJECT.md 4.13.6).
 *
 * `dueAt` is computed at intake from `deadlineRule`, and an overdue row pages someone. That is the
 * difference between a control and an intention.
 *
 * **The rule is stored beside the date, and per request.** Where the data is kept cannot supply
 * it: GDPR governs a person rather than a server, so a customer anywhere answers a European on
 * Art. 12(3)'s one month the moment they have European users. Which rule applies is the
 * controller's determination, so it arrives with the request — and it is kept, because "was this
 * answered on the right clock" is a question the date on its own cannot answer (`DsrDeadline`).
 */
export const dataSubjectRequests = classifiedTable(
  "data_subject_requests",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    projectId: projectIdColumn(() => projects.id),
    subjectUserId: classified(uuid("subject_user_id"), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Years6,
      erasure: Erasure.RetainPseudonymous,
      loggable: true,
      note: "Kept after erasure, as proof the erasure was performed.",
    }),
    kind: classified(text("kind").notNull(), { ...config, loggable: true }),
    status: classified(text("status").notNull().default("received"), { ...config, loggable: true }),
    requestedAt: classified(
      timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
      { ...config, loggable: true },
    ),
    deadlineRule: classified(text("deadline_rule").notNull().default(DEFAULT_DSR_DEADLINE_RULE), {
      ...config,
      loggable: true,
      note: "DsrDeadlineRule. Which law's clock `due_at` was set on, recorded because an auditor asks exactly that and the date alone cannot answer it. Defaults to the stricter rule, so a row written without one is early rather than late.",
    }),
    dueAt: classified(timestamp("due_at", { withTimezone: true }).notNull(), {
      ...config,
      loggable: true,
      note: "Set at intake from `deadline_rule`. Monitored, because a missed statutory deadline is the finding.",
    }),
    completedAt: classified(timestamp("completed_at", { withTimezone: true }), config),
    artifactUri: classified(text("artifact_uri"), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Days30,
      erasure: Erasure.NullOut,
      note: "Export bundle location. Expires quickly: it contains everything about a person.",
    }),
    requestedBy: classified(text("requested_by"), config),
  },
  (t) => [index("dsr_due_idx").on(t.status, t.dueAt), index("dsr_project_idx").on(t.projectId)],
);

/** Retention rules the purge worker enforces. Retention no job applies is not retention. */
export const retentionPolicies = classifiedTable(
  "retention_policies",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(() => projects.id),
    subject: classified(text("subject").notNull(), { ...config, loggable: true }),
    maxAge: classified(text("max_age").notNull(), {
      ...config,
      note: "ISO 8601 duration. Defaults follow compliance_tier (1 year, or 6 for HIPAA).",
    }),
    action: classified(text("action").notNull(), { ...config, loggable: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("retention_policies_project_idx").on(t.projectId),
    // One age per subject per project. The settings screen writes with an upsert and needs a
    // conflict target, and without this a save could leave two rows for one subject with the
    // sweeper picking whichever its subquery reached first.
    uniqueIndex("retention_policies_project_subject_key").on(t.projectId, t.subject),
  ],
);

/**
 * Time-boxed staff access to production data (PROJECT.md 4.13.7).
 *
 * Global rather than tenant-scoped, because it is a record about our people, not the
 * customer's. Deny by default: absence of a live row means no access. The quarterly
 * access review SOC 2 asks for is a query over this table.
 */
export const staffAccessGrants = classifiedTable("staff_access_grants", {
  id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
  staffId: classified(text("staff_id").notNull(), {
    class: DataClass.Pii,
    purpose: Purpose.AuditAndCompliance,
    retention: Retention.Years6,
    erasure: Erasure.RetainPseudonymous,
    loggable: true,
  }),
  scope: classified(text("scope").notNull(), { ...config, loggable: true }),
  grantedBy: classified(text("granted_by").notNull(), {
    class: DataClass.Pii,
    purpose: Purpose.AuditAndCompliance,
    retention: Retention.Years6,
    erasure: Erasure.RetainPseudonymous,
    note: "Must differ from staff_id. Separation of duties is the point of the row.",
  }),
  reason: classified(text("reason").notNull(), {
    ...config,
    retention: Retention.Years6,
    note: "Free text, required. An access grant without a reason is not reviewable.",
  }),
  expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), {
    ...config,
    retention: Retention.Years6,
    loggable: true,
    note: "Mandatory. Access that does not expire on its own is standing access.",
  }),
  revokedAt: classified(timestamp("revoked_at", { withTimezone: true }), {
    ...config,
    retention: Retention.Years6,
  }),
  createdAt: createdAtColumn(),
});

/**
 * What every column of `project_purges` is.
 *
 * `AuditAndCompliance` rather than `ServiceConfiguration`, because the row is evidence and not
 * settings, and six years on all of it including the primary key — a record whose id expired
 * before its contents would be one nothing could cite.
 */
const disposalRecord = {
  class: DataClass.Operational,
  purpose: Purpose.AuditAndCompliance,
  retention: Retention.Years6,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * That a project's data was disposed of, kept after everything else about it is gone.
 *
 * GDPR Art. 28(3)(g) obliges a processor to delete a controller's personal data at the end of
 * the provision of services — and obliges it *demonstrably*. After `purge_project` has run there
 * is nothing left to demonstrate with: the tenant rows cascaded, the audit trail went with them,
 * and the absence of data is indistinguishable from a project that never existed. This row is
 * the evidence, and it is the reason the purge is not simply a `DELETE`.
 *
 * Global rather than tenant-scoped, for the plainest possible reason: the tenant is gone. It has
 * no `project_id` foreign key for the same reason, and it holds no personal data — ids, a count
 * and a timestamp. It belongs to the control plane and moves there when the planes separate
 * (PROJECT.md 4.13.5).
 */
export const projectPurges = classifiedTable("project_purges", {
  id: classified(uuid("id").primaryKey().defaultRandom(), {
    ...disposalRecord,
    loggable: true,
  }),
  projectId: classified(uuid("project_id").notNull(), {
    ...disposalRecord,
    loggable: true,
    note: "No FK: the project it names has been deleted, which is what this row records.",
  }),
  orgId: classified(uuid("org_id").notNull(), {
    ...disposalRecord,
    loggable: true,
    note: "Kept so the record survives in the organisation's name once the project is gone.",
  }),
  auditRowsDeleted: classified(integer("audit_rows_deleted").notNull(), {
    ...disposalRecord,
    loggable: true,
    note: "How much of the append-only trail the purge removed. The one number worth proving.",
  }),
  purgedBy: classified(text("purged_by").notNull(), {
    ...disposalRecord,
    note: "The actor the management API was acting as. Free text, like an audit actor id.",
  }),
  purgedAt: classified(timestamp("purged_at", { withTimezone: true }).notNull().defaultNow(), {
    ...disposalRecord,
    loggable: true,
  }),
});

/**
 * Where each background consumer of the outbox has read up to.
 *
 * Not tenant-scoped and deliberately so: a relay serves every project at once, which is
 * the same reason `revocation_events_since` is SECURITY DEFINER. It is ours rather than a
 * customer's, so no RLS policy and no `project_id`.
 *
 * One row per consumer, and that is the point. The outbox already has `published_at`, and
 * it belongs to the relay that will drain this table to Pub/Sub; a second consumer sharing
 * that column would advance a watermark the first one is still using. This is that second
 * consumer, arriving exactly as the note in CLAUDE.md said it would.
 */
export const relayOffsets = classifiedTable("relay_offsets", {
  consumer: classified(text("consumer").primaryKey(), { ...config, loggable: true }),
  positionSeq: classified(bigint("position_seq", { mode: "number" }).notNull(), {
    ...config,
    loggable: true,
    note: "Exclusive lower bound on outbox seq. A timestamp could not be one: it ties at millisecond precision, so an event sharing the watermark's instant was skipped for ever.",
  }),
  updatedAt: classified(timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), {
    ...config,
    loggable: true,
    note: "How stale the consumer is, which is the only signal that a relay has stopped.",
  }),
});
