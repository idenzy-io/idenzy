import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./shared.js";

/**
 * Idenzy's own people, and what they did as operators (ADR-0018).
 *
 * Global, not tenant-scoped: these are records about us, not about a customer. Both tables are
 * written only in ways the application cannot misuse — `staff` by the owner connection alone, and
 * `operator_actions` append-only — because they are the two tables an attacker who found a bug in
 * the operator API would most want to write.
 */

/** Preset for the audit record of what our staff did. Kept as long as a financial record. */
const operatorRecord = {
  class: DataClass.Operational,
  purpose: Purpose.AuditAndCompliance,
  retention: Retention.Years6,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * A member of Idenzy staff who may use the operator console.
 *
 * **The application can read this table and nothing else.** The grant migration gives the app
 * role SELECT only, so no route, however broken, can make somebody an operator: rows are written
 * by `pnpm staff` over the owner connection, or by hand. A test asserts the absence.
 *
 * **Only `@idenzy.io` addresses**, by constraint, and only Google Workspace accounts on that
 * domain can sign in to the operator project at all (the provider checks the `hd` claim). The
 * address is the join between the two: the guard matches a verified Google identity to a row here.
 *
 * Deactivated rather than deleted, so an `operator_actions` row always names somebody who existed.
 */
export const staff = classifiedTable(
  "staff",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...operatorRecord, loggable: true }),
    email: classified(text("email").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.AuditAndCompliance,
      retention: Retention.Years6,
      erasure: Erasure.RetainPseudonymous,
      note: "An employee's work address, lower case. Kept with the audit trail it signs.",
    }),
    role: classified(text("role").notNull(), {
      ...operatorRecord,
      loggable: true,
      note: "StaffRole: support < billing < admin.",
    }),
    active: classified(boolean("active").notNull().default(true), {
      ...operatorRecord,
      loggable: true,
    }),
    note: classified(text("note").notNull().default(""), {
      ...operatorRecord,
      note: "Why they have access, in the words of whoever granted it.",
    }),
    createdAt: createdAtColumn(),
    deactivatedAt: classified(timestamp("deactivated_at", { withTimezone: true }), {
      ...operatorRecord,
      loggable: true,
    }),
  },
  (t) => [
    uniqueIndex("staff_email_key").on(t.email),
    check("staff_email_domain_ck", sql`email ~ '^[a-z0-9._%+-]+@idenzy\\.io$'`),
    check("staff_role_ck", sql`role in ('support', 'billing', 'admin')`),
    check("staff_deactivated_ck", sql`active = (deactivated_at is null)`),
  ],
);

/**
 * Everything an operator changed, one row per change (ADR-0018).
 *
 * The organisation-level audit trail that `audit_events` cannot be: those are per project and
 * hash-chained per project, and an operator switching an organisation to invoicing acts on no
 * project at all. Inserted in the same transaction as the change it records, so a change without
 * its row cannot commit. Append-only: the app role holds SELECT and INSERT and nothing else.
 */
export const operatorActions = classifiedTable(
  "operator_actions",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...operatorRecord, loggable: true }),
    staffId: classified(
      uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "restrict" }),
      { ...operatorRecord, loggable: true },
    ),
    action: classified(text("action").notNull(), {
      ...operatorRecord,
      loggable: true,
      note: "OperatorAction: what was done, in a stable machine-readable name.",
    }),
    orgId: classified(uuid("org_id"), {
      ...operatorRecord,
      loggable: true,
      note: "The organisation acted on, where there was one. No FK: this outlives a purge.",
    }),
    detail: classified(jsonb("detail").notNull().default({}), {
      ...operatorRecord,
      note: "What changed, from and to. Settings only; never a secret, never a customer's data.",
    }),
    reason: classified(text("reason").notNull(), {
      ...operatorRecord,
      note: "Required. A change to a customer's account without a reason is not reviewable.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("operator_actions_org_idx").on(t.orgId, t.createdAt),
    index("operator_actions_staff_idx").on(t.staffId, t.createdAt),
    check("operator_actions_reason_ck", sql`length(trim(reason)) > 0`),
  ],
);
