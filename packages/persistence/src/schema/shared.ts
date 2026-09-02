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
