import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import { index, jsonb, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditRecord, config } from "./presets.js";
import { appRole } from "./roles.js";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

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
    projectId: projectIdColumn(),
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
    prevHash: classified(text("prev_hash").notNull(), {
      ...auditRecord,
      note: "Hash of the preceding entry for this project. Genesis is 64 zeroes.",
    }),
    entryHash: classified(text("entry_hash").notNull(), {
      ...auditRecord,
      note: "H(prev_hash || canonical(entry)). Verified on a schedule (4.13.3).",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("audit_events_project_created_idx").on(t.projectId, t.createdAt),
    index("audit_events_project_actor_idx").on(t.projectId, t.actorId),
    // Read is tenant-scoped; write permission is controlled by grants, not by policy.
    pgPolicy("audit_events_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: appRole,
      using: sql`project_id = current_setting('app.project_id', true)::uuid`,
      withCheck: sql`project_id = current_setting('app.project_id', true)::uuid`,
    }),
  ],
).enableRLS();

/**
 * Data-subject requests (PROJECT.md 4.13.6).
 *
 * `dueAt` is computed at intake, 30 days for GDPR, and an overdue row pages someone.
 * That is the difference between a control and an intention.
 */
export const dataSubjectRequests = classifiedTable(
  "data_subject_requests",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    projectId: projectIdColumn(),
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
    dueAt: classified(timestamp("due_at", { withTimezone: true }).notNull(), {
      ...config,
      loggable: true,
      note: "Set at intake. Monitored, because a missed statutory deadline is the finding.",
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
  (t) => [
    index("dsr_due_idx").on(t.status, t.dueAt),
    index("dsr_project_idx").on(t.projectId),
    tenantIsolationPolicy("data_subject_requests"),
  ],
).enableRLS();

/** Retention rules the purge worker enforces. Retention no job applies is not retention. */
export const retentionPolicies = classifiedTable(
  "retention_policies",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), config),
    projectId: projectIdColumn(),
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
    tenantIsolationPolicy("retention_policies"),
  ],
).enableRLS();

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
