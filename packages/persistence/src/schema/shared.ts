import { classified } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { type AnyPgColumn, timestamp, uuid } from "drizzle-orm/pg-core";

const projectIdClassification = {
  class: DataClass.Operational,
  purpose: Purpose.ServiceConfiguration,
  retention: Retention.ProjectLifetime,
  erasure: Erasure.NotApplicable,
  loggable: true,
  note: "Tenant discriminator. Enforced by the repository layer.",
} as const;

/**
 * The tenant discriminator every tenant table carries, and the cascade that empties it.
 *
 * Declared once so no table can accidentally type it differently, and so every repository
 * filters on the same column.
 *
 * **`reference` is required, and that is the point.** For a long time this column carried no
 * foreign key while three docstrings claimed deleting a project took its users, sessions, keys
 * and audit rows with it. Nothing did: a delete left every tenant row behind, unreachable and
 * therefore un-erasable, which is an Art. 28(3)(g) failure as much as a referential one. The
 * parameter cannot be defaulted away, so a tenant table added years from now either declares the
 * cascade or does not compile — the same argument `classified()` itself rests on.
 *
 * It is a parameter rather than a reference written here because `shared.ts` cannot import
 * `projects.ts`, which imports this module back. `orgIdColumn` below documents the identical
 * constraint one plane up.
 */
export const projectIdColumn = (reference: () => AnyPgColumn) =>
  classified(
    uuid("project_id").notNull().references(reference, { onDelete: "cascade" }),
    projectIdClassification,
  );

/**
 * The same column without the cascade, for the one table that cannot have it.
 *
 * `audit_events` only. It is partitioned, and `idenzy_app` holds SELECT and INSERT on it and
 * nothing else — that revoke *is* the integrity control of PROJECT.md 4.13.3, so a cascade would
 * have no privilege to fire even if the partitioning allowed one. Its rows are removed by
 * `purge_project`, a SECURITY DEFINER function that can only run for a project being deleted in
 * the same statement.
 *
 * Reaching for this anywhere else is how the hole this fixed was dug. If a new table needs it,
 * the reason belongs in this docstring beside the existing one.
 */
export const unreferencedProjectIdColumn = () =>
  classified(uuid("project_id").notNull(), projectIdClassification);

/**
 * The organisation discriminator every control-plane table carries (ADR-0011).
 *
 * The same idea as `projectIdColumn`, one plane up. A wallet, a card and an invoice
 * belong to an organisation and never to one of its projects, so they are keyed on this
 * and scoped by `OrgRepository` rather than by the tenant base.
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
    note: "Organisation discriminator. Enforced by the repository layer.",
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
