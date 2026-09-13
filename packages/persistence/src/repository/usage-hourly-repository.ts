import { and, asc, between, desc, eq, gte } from "drizzle-orm";
import { usageHourly } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** One hour's figures, as a chart reads them. */
export interface HourlyUsage {
  readonly hour: Date;
  /** Month-to-date active users at the end of the hour. A level: never summed, only compared. */
  readonly mauToDate: number;
  readonly emailsSent: number;
  readonly smsSent: number;
  readonly smsVerified: number;
  readonly smsCost: string;
}

export type NewHourlyUsage = HourlyUsage;

/**
 * The finest usage rollup (PROJECT.md 5.1).
 *
 * Written by the roller in `apps/workers` and by nothing else, one row per completed hour.
 */
export class UsageHourlyRepository extends BaseRepository<typeof usageHourly> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, usageHourly);
  }

  /**
   * Records a completed hour, once.
   *
   * Nothing on conflict, and that is a semantic rather than a safeguard: an hour's level is what
   * was *observed* when the hour ended, and its counters are what the day's cumulative figures had
   * not yet been attributed to an earlier hour. Both are true only at the moment they are taken.
   * A second pass over the same hour, minutes later, would compute them from figures that have
   * since moved on and would quietly reattribute the next hour's traffic to this one.
   */
  async record(row: NewHourlyUsage): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(usageHourly)
        .values({ projectId: this.context.projectId, ...row })
        .onConflictDoNothing({ target: [usageHourly.projectId, usageHourly.hour] }),
    );
  }

  /** The window a chart covers, oldest first. `from` inclusive, `to` inclusive. */
  async between(from: Date, to: Date): Promise<readonly HourlyUsage[]> {
    const rows = await this.tx
      .select()
      .from(usageHourly)
      .where(and(this.tenantScope(), between(usageHourly.hour, from, to)))
      .orderBy(asc(usageHourly.hour));
    return rows.map(present);
  }

  /**
   * The hours already written on or after `from`, oldest first.
   *
   * The roller needs them for two things at once: where to carry on from, and what share of the
   * day's cumulative counters has already been attributed to an earlier hour.
   */
  async since(from: Date): Promise<readonly HourlyUsage[]> {
    const rows = await this.tx
      .select()
      .from(usageHourly)
      .where(and(this.tenantScope(), gte(usageHourly.hour, from)))
      .orderBy(asc(usageHourly.hour));
    return rows.map(present);
  }

  /** The latest hour written, or null for a project that has never been rolled up. */
  async latest(): Promise<HourlyUsage | null> {
    const rows = await this.tx
      .select()
      .from(usageHourly)
      .where(this.tenantScope())
      .orderBy(desc(usageHourly.hour))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : present(row);
  }

  /** One hour, for a caller that knows which. */
  async at(hour: Date): Promise<HourlyUsage | null> {
    const rows = await this.tx
      .select()
      .from(usageHourly)
      .where(and(this.tenantScope(), eq(usageHourly.hour, hour)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : present(row);
  }
}

function present(row: typeof usageHourly.$inferSelect): HourlyUsage {
  return {
    hour: row.hour,
    mauToDate: row.mauToDate,
    emailsSent: row.emailsSent,
    smsSent: row.smsSent,
    smsVerified: row.smsVerified,
    smsCost: row.smsCost,
  };
}
