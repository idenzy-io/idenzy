import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { jsonb, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { config } from "./presets.js";
import {
  createdAtColumn,
  projectIdColumn,
  tenantIsolationPolicy,
  updatedAtColumn,
} from "./shared.js";

/**
 * A project's mapping from what we hold into what its access tokens carry
 * (PROJECT.md 4.2).
 *
 * One row per project holding the whole set, rather than a row per claim, because the
 * byte budget is on the total: a cap you can only check by reading every other row is one
 * that races with itself the moment two claims are saved at once.
 *
 * The mappings themselves are configuration and hold no personal data. What they *point
 * at* is another matter, which is what the acknowledgement column is for.
 */
export const claimTemplates = classifiedTable(
  "claim_templates",
  {
    projectId: projectIdColumn(),
    claims: classified(jsonb("claims").notNull().default([]), {
      ...config,
      loggable: true,
      note: "The mappings. Names and source paths only: no user data is stored here.",
    }),
    privateMetadataAcknowledgedAt: classified(
      timestamp("private_metadata_acknowledged_at", { withTimezone: true }),
      {
        class: DataClass.Operational,
        purpose: Purpose.AuditAndCompliance,
        retention: Retention.ProjectLifetime,
        erasure: Erasure.NotApplicable,
        loggable: true,
        note: "When the customer accepted that mapping metadata_private publishes it into every token. Kept as evidence rather than as a flag, because the question is when somebody agreed and not whether a box is ticked.",
      },
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [primaryKey({ columns: [t.projectId] }), tenantIsolationPolicy("claim_templates")],
).enableRLS();
