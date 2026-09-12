import { classified } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import { pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import { appRole } from "./roles.js";

/**
 * The tenant discriminator every tenant table carries.
 *
 * Declared once so no table can accidentally type it differently, and so the RLS policy
 * below always matches the column it filters on.
 */
export const projectIdColumn = () =>
  classified(uuid("project_id").notNull(), {
    class: DataClass.Operational,
    purpose: Purpose.ServiceConfiguration,
    retention: Retention.ProjectLifetime,
    erasure: Erasure.NotApplicable,
    loggable: true,
    note: "Tenant discriminator. Enforced by RLS as well as by the repository layer.",
  });

/**
 * The isolation policy applied to every tenant table (ADR-0003).
 *
 * Set per transaction by UnitOfWork. Two defensive details: the `true` argument makes an
 * unset variable return NULL rather than raise, and `nullif(..., '')` treats an empty
 * value the same way. Both mean a query outside a tenant transaction matches nothing
 * instead of leaking everything, and neither can produce a confusing uuid cast error.
 */
export const tenantIsolationPolicy = (table: string) =>
  pgPolicy(`${table}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`project_id = nullif(current_setting('app.project_id', true), '')::uuid`,
    withCheck: sql`project_id = nullif(current_setting('app.project_id', true), '')::uuid`,
  });

/**
 * The organisation discriminator every control-plane table carries (ADR-0011).
 *
 * The same idea as `projectIdColumn`, one plane up. A wallet, a card and an invoice
 * belong to an organisation and never to one of its projects, so they are keyed on this
 * and isolated by `orgIsolationPolicy` rather than by the tenant one.
 *
 * No `references(() => orgs.id)` here: that would make this module import
 * `control-plane.js`, which imports this one back. The foreign key is declared on each
 * table instead, beside the column that uses it.
 */
export const orgIdColumn = () =>
  classified(uuid("org_id").notNull(), {
    class: DataClass.Operational,
    purpose: Purpose.BillingAndMetering,
    retention: Retention.Years6,
    erasure: Erasure.NotApplicable,
    loggable: true,
    note: "Control-plane discriminator. Enforced by RLS as well as by the repository layer.",
  });

/**
 * The isolation policy applied to every org-keyed control-plane table (ADR-0011).
 *
 * Set per transaction by `UnitOfWork.runForOrg`, and identical in shape to
 * `tenantIsolationPolicy` down to the two defensive details: `true` makes an unset
 * variable return NULL rather than raise, and `nullif(..., '')` treats an empty value
 * the same way, so a query outside an org transaction matches nothing instead of
 * returning every customer's payment methods.
 */
export const orgIsolationPolicy = (table: string) =>
  pgPolicy(`${table}_org_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
    withCheck: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
  });

export const createdAtColumn = () =>
  classified(timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), {
    class: DataClass.Operational,
    purpose: Purpose.AccountManagement,
    retention: Retention.UntilAccountDeletion,
    erasure: Erasure.NotApplicable,
    loggable: true,
  });

export const updatedAtColumn = () =>
  classified(timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), {
    class: DataClass.Operational,
    purpose: Purpose.AccountManagement,
    retention: Retention.UntilAccountDeletion,
    erasure: Erasure.NotApplicable,
  });
