import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { boolean, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "./shared.js";

const operational = {
  class: DataClass.Operational,
  purpose: Purpose.ServiceConfiguration,
  retention: Retention.ProjectLifetime,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * Independent regional stacks (PROJECT.md 4.13.5).
 *
 * Global, not tenant-scoped, and holds no personal data. This is what lets an EU
 * project be honestly described as EU-resident.
 */
export const regionCells = classifiedTable("region_cells", {
  id: classified(uuid("id").primaryKey().defaultRandom(), operational),
  code: classified(text("code").notNull().unique(), { ...operational, loggable: true }),
  jurisdiction: classified(text("jurisdiction").notNull(), operational),
  endpoint: classified(text("endpoint").notNull(), operational),
  kmsKeyRing: classified(text("kms_key_ring").notNull(), operational),
  active: classified(boolean("active").notNull().default(true), operational),
  createdAt: createdAtColumn(),
});

/**
 * A customer organisation.
 *
 * Control plane: billing identifiers and a cell pointer only. Tenant personal data never
 * lives here, which is the property residency claims rest on (PROJECT.md 4.13.5).
 */
export const orgs = classifiedTable("orgs", {
  id: classified(uuid("id").primaryKey().defaultRandom(), { ...operational, loggable: true }),
  name: classified(text("name").notNull(), {
    class: DataClass.Pii,
    purpose: Purpose.BillingAndMetering,
    retention: Retention.ProjectLifetime,
    subjectField: true,
    erasure: Erasure.Tombstone,
    note: "Customer organisation name. Personal only when a sole trader uses their own name.",
  }),
  cellId: classified(
    uuid("cell_id")
      .notNull()
      .references(() => regionCells.id),
    { ...operational, loggable: true, note: "Immutable after creation (PROJECT.md 4.13.5)." },
  ),
  billingCustomerId: classified(text("billing_customer_id"), {
    class: DataClass.Pseudonymous,
    purpose: Purpose.BillingAndMetering,
    retention: Retention.Years6,
    erasure: Erasure.RetainPseudonymous,
    note: "Stripe customer id. Retained for statutory financial record keeping.",
  }),
  createdAt: createdAtColumn(),
});
