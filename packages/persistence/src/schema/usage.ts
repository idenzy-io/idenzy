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

/**
 * Three tiers, and which one a row is in is decided by how fine it is.
 *
 * An hourly row is twenty-four times a daily one and a daily one is thirty times a monthly one, so
 * keeping all three for the same six years would be keeping the finest for a reason nobody has.
 * What a reader explores at an hour's resolution is recent; what a bill rests on is the monthly
 * record, which is a financial document and keeps the full term. `UsageRetentionSweeper` in
 * `apps/workers` is what makes these three numbers true rather than a description.
 */
const billing = {
  class: DataClass.Operational,
  purpose: Purpose.BillingAndMetering,
  retention: Retention.Years6,
  erasure: Erasure.NotApplicable,
} as const;

/** The finest rollup, and the shortest tier: six months of hours. */
const hourlyBilling = { ...billing, retention: Retention.Months6 } as const;

/** Two years, which is a year-on-year comparison and not a financial record. */
const dailyBilling = { ...billing, retention: Retention.Years2 } as const;

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
    day: classified(date("day").notNull(), { ...dailyBilling, loggable: true }),
    mauHll: classified(hll("mau_hll"), {
      ...dailyBilling,
      class: DataClass.Pseudonymous,
      note: "Sketch only. Cannot be reversed to a user list, nor asked whether one person was active.",
    }),
    mau: classified(integer("mau"), {
      ...dailyBilling,
      loggable: true,
      note: "The day's own actives, frozen from the sketch at close. Null while the period is open, where it is read from the sketch instead.",
    }),
    mauToDate: classified(integer("mau_to_date"), {
      ...dailyBilling,
      loggable: true,
      note: "The period's running actives through this day. The only one a bill reconciles with, because daily figures do not add up.",
    }),
    emailsSent: classified(
      bigint("emails_sent", { mode: "number" }).notNull().default(0),
      dailyBilling,
    ),
    smsSent: classified(bigint("sms_sent", { mode: "number" }).notNull().default(0), dailyBilling),
    smsVerified: classified(bigint("sms_verified", { mode: "number" }).notNull().default(0), {
      ...dailyBilling,
      note: "Codes actually entered. Sends far above this is the pumping signal (4.8).",
    }),
    smsCost: classified(
      numeric("sms_cost", { precision: 12, scale: 6 }).notNull().default("0"),
      dailyBilling,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.day] }),
    index("usage_daily_day_idx").on(t.day),
    tenantIsolationPolicy("usage_daily"),
  ],
).enableRLS();

/**
 * The finest rollup: one row per project per hour, and deliberately no sketch.
 *
 * This is where the obvious design would have gone wrong. An hourly HyperLogLog is 16 KiB every
 * hour — seventy megabytes per project over six months, which is worse than the daily problem
 * `usage_periods` exists to solve, and for a chart rather than for a bill. So an hour stores the
 * *level* as a plain integer: month-to-date active users as they stood when the hour was rolled
 * up. The union that produces it is taken from the day's sketches, which are still there while the
 * month is open, and then thrown away.
 *
 * What that costs is the one thing an hour cannot be asked afterwards: how many people were active
 * *within* it. Two hourly levels can be subtracted to get how many were new in the second, which is
 * what a chart draws, but a distinct count of an hour on its own is not recoverable and never will
 * be from this table. That is the right trade for a row kept by the thousand.
 *
 * The counters beside it are the hour's own — deltas, not levels — because they do add up.
 */
export const usageHourly = classifiedTable(
  "usage_hourly",
  {
    projectId: projectIdColumn(),
    hour: classified(timestamp("hour", { withTimezone: true }).notNull(), {
      ...hourlyBilling,
      loggable: true,
      note: "The start of the UTC hour the figures belong to.",
    }),
    mauToDate: classified(integer("mau_to_date").notNull().default(0), {
      ...hourlyBilling,
      loggable: true,
      note: "Month-to-date active users at the end of this hour. A level, so it is never summed.",
    }),
    emailsSent: classified(
      bigint("emails_sent", { mode: "number" }).notNull().default(0),
      hourlyBilling,
    ),
    smsSent: classified(bigint("sms_sent", { mode: "number" }).notNull().default(0), hourlyBilling),
    smsVerified: classified(
      bigint("sms_verified", { mode: "number" }).notNull().default(0),
      hourlyBilling,
    ),
    smsCost: classified(numeric("sms_cost", { precision: 12, scale: 6 }).notNull().default("0"), {
      ...hourlyBilling,
      note: "This hour's share. Can be negative: a provider that came in under its quote settles the difference against the hour the correction lands in.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.hour] }),
    index("usage_hourly_hour_idx").on(t.hour),
    tenantIsolationPolicy("usage_hourly"),
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
