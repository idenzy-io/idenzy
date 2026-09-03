import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { bigint, customType, date, index, numeric, primaryKey } from "drizzle-orm/pg-core";
import { projectIdColumn, tenantIsolationPolicy } from "./shared.js";

/** HyperLogLog sketch, so monthly active users are counted without storing who. */
const hll = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const billing = {
  class: DataClass.Operational,
  purpose: Purpose.BillingAndMetering,
  retention: Retention.Years6,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * Daily usage rollups.
 *
 * MAU is a HyperLogLog sketch rather than a distinct-user list. That is a billing
 * optimisation and a privacy property at once: we can bill accurately without keeping a
 * per-day record of which users were active.
 */
export const usageDaily = classifiedTable(
  "usage_daily",
  {
    projectId: projectIdColumn(),
    day: classified(date("day").notNull(), { ...billing, loggable: true }),
    mauHll: classified(hll("mau_hll"), {
      ...billing,
      class: DataClass.Pseudonymous,
      note: "Sketch only. Cannot be reversed to a user list.",
    }),
    emailsSent: classified(bigint("emails_sent", { mode: "number" }).notNull().default(0), billing),
    smsSent: classified(bigint("sms_sent", { mode: "number" }).notNull().default(0), billing),
    smsVerified: classified(bigint("sms_verified", { mode: "number" }).notNull().default(0), {
      ...billing,
      note: "Codes actually entered. Sends far above this is the pumping signal (4.8).",
    }),
    smsCost: classified(
      numeric("sms_cost", { precision: 12, scale: 6 }).notNull().default("0"),
      billing,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.day] }),
    index("usage_daily_day_idx").on(t.day),
    tenantIsolationPolicy("usage_daily"),
  ],
).enableRLS();
