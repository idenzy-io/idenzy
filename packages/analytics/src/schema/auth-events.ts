import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { classifiedAnalyticsTable, column } from "./classified-table.js";

/**
 * A year, which is what the Postgres twin already keeps IP for.
 *
 * `sessions.ip` is classified `Years1` and noted as "retained one year for abuse investigation",
 * and this table holds the same field about the same events. A different number here would not be
 * a different policy, it would be the same policy written down twice and disagreeing.
 */
const analytics = {
  class: DataClass.Operational,
  purpose: Purpose.SecurityAndAbusePrevention,
  retention: Retention.Years1,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * Every authentication event, one row each, for the questions a rollup cannot answer.
 *
 * This is the half of metering that moves (todo.md 3.2). `usage_daily` says how many people were
 * active and what it cost; it cannot say which method they used, which country they came from, or
 * how a Tuesday's sign-ins broke down by outcome — because a rollup is an answer to one question
 * decided in advance, and an analytics store is for the questions nobody decided in advance.
 *
 * **It is not a second source of truth for the bill.** A count here and the figure on an invoice
 * will not agree and are not meant to: MAU is a distinct count with first-day-free and anonymous
 * exclusions applied at the write, and this is every event that happened. The panel reads the
 * billing figure from Postgres and reads this for everything it explores, and the screens say
 * which is which.
 *
 * Partitioned by month and aged by TTL, so retention drops whole parts rather than rewriting the
 * table. `ttl_only_drop_parts` is what makes that true rather than aspirational.
 */
export const authEvents = classifiedAnalyticsTable(
  "auth_events",
  {
    project_id: column("UUID", { ...analytics, loggable: true }),
    at: column("DateTime64(3, 'UTC')", { ...analytics, loggable: true }),
    /** The public event name, the same vocabulary a webhook carries. */
    event: column("LowCardinality(String)", { ...analytics, loggable: true }),
    /** `password`, `oauth`, `passkey`, `otp`… Empty where the event has no method. */
    method: column("LowCardinality(String)", { ...analytics, loggable: true }),
    outcome: column("LowCardinality(String)", { ...analytics, loggable: true }),
    user_id: column("UUID", {
      ...analytics,
      class: DataClass.Pseudonymous,
      erasure: Erasure.RowDeleted,
      note: "An erasure removes the rows rather than nulling the column, because a row keyed on a user with the user removed is not anonymous — the timing alone re-identifies.",
    }),
    session_id: column("UUID", { ...analytics, class: DataClass.Pseudonymous }),
    ip: column("String", {
      ...analytics,
      class: DataClass.Pii,
      erasure: Erasure.RowDeleted,
      note: "Personal data under GDPR. Kept one year for abuse investigation, matching sessions.ip.",
    }),
    user_agent: column("String", {
      ...analytics,
      class: DataClass.Pii,
      erasure: Erasure.RowDeleted,
    }),
    /** ISO 3166-1 alpha-2, or empty where the address could not be placed. */
    country: column("LowCardinality(String)", analytics),
  },
  {
    retention: Retention.Years1,
    // `project_id` first on every analytics table, because every read is scoped by it and a sort
    // key that does not lead with the tenant makes the policy's predicate a full scan.
    orderBy: ["project_id", "at", "event"],
    partitionBy: "toYYYYMM(at)",
    ttlColumn: "at",
  },
);
