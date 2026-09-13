import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import {
  bigint,
  customType,
  date,
  index,
  integer,
  numeric,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { createdAtColumn, projectIdColumn, tenantIsolationPolicy } from "./shared.js";

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
 *
 * What goes into the sketch is MAU as PROJECT.md 5.1 defines it and not everyone who made a
 * request: an account is left out on its own first day and an anonymous one until it is
 * upgraded. Both rules are applied where the write happens, because neither can be recovered
 * from a sketch afterwards — it holds no dates and no identities to filter on. A day's row is
 * therefore what that day added to the bill, and a project's first day of sign-ups reads zero
 * on purpose.
 *
 * **The sketch is working set, not history.** It is the largest thing in the database per row —
 * 16 KiB once a project passes about four thousand actives in a day — and six years of that for
 * a busy project is 35 MB of a primary that is also serving sign-in. So it lives exactly as long
 * as the period it bills: when a month closes, `usage_periods` takes the figure, `mau` and
 * `mauToDate` freeze what the chart needs as two integers, and `mau_hll` is set to null. What
 * the reader explores beyond that belongs to the analytics store (todo.md 3.2), and what the
 * invoice rests on stays here, with the ledger.
 */
export const usageDaily = classifiedTable(
  "usage_daily",
  {
    projectId: projectIdColumn(),
    day: classified(date("day").notNull(), { ...billing, loggable: true }),
    mauHll: classified(hll("mau_hll"), {
      ...billing,
      class: DataClass.Pseudonymous,
      note: "Sketch only. Cannot be reversed to a user list, nor asked whether one person was active.",
    }),
    mau: classified(integer("mau"), {
      ...billing,
      loggable: true,
      note: "The day's own actives, frozen from the sketch at close. Null while the period is open, where it is read from the sketch instead.",
    }),
    mauToDate: classified(integer("mau_to_date"), {
      ...billing,
      loggable: true,
      note: "The period's running actives through this day. The only one a bill reconciles with, because daily figures do not add up.",
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

/**
 * One closed billing period per project: the figure an invoice is raised from.
 *
 * It exists so that the sketches do not have to. A month's MAU is the union of its days, and a
 * union can only be taken from the sketches themselves — so once it has been taken, and the
 * period is shut, the 16 KiB per day has no further question to answer and the answer itself is
 * four bytes. That is the whole of the scaling story for this table: a project's six years here
 * is seventy-two rows of integers rather than two thousand rows of sketches.
 *
 * It stays in Postgres rather than moving to the analytics store with the rest of the metrics
 * (todo.md 3.2), and the reason is what it is for. This is a financial record. It has to be
 * written in the same transaction as the ledger it must agree with, it has to survive an
 * analytics store being rebuilt, and it is one row per project per month rather than an
 * analytical volume. What moves is everything the reader explores; what is billed stays.
 *
 * `closedAt` is the point of no return. A period is written once, when the month is over and
 * every meter has flushed, and nothing amends it afterwards: an invoice that could change after
 * it was raised is not a record of anything.
 */
export const usagePeriods = classifiedTable(
  "usage_periods",
  {
    projectId: projectIdColumn(),
    period: classified(date("period").notNull(), {
      ...billing,
      loggable: true,
      note: "The first day of the calendar month, in UTC. A billing period is a month, not a rolling window.",
    }),
    activeUsers: classified(integer("active_users").notNull(), { ...billing, loggable: true }),
    emailsSent: classified(bigint("emails_sent", { mode: "number" }).notNull(), billing),
    smsSent: classified(bigint("sms_sent", { mode: "number" }).notNull(), billing),
    smsVerified: classified(bigint("sms_verified", { mode: "number" }).notNull(), billing),
    smsCost: classified(numeric("sms_cost", { precision: 12, scale: 6 }).notNull(), billing),
    closedAt: classified(timestamp("closed_at", { withTimezone: true }).notNull(), {
      ...billing,
      loggable: true,
      note: "When the period was shut and the sketches behind it dropped. A period is written once and never amended.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.period] }),
    index("usage_periods_period_idx").on(t.period),
    tenantIsolationPolicy("usage_periods"),
  ],
).enableRLS();
