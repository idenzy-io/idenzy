import { and, gte, sql } from "drizzle-orm";
import { emailDeliveryStats } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** The one counter an event moves. Named so a caller cannot pass a column that is not one. */
export type DeliveryCounter =
  | "sent"
  | "delivered"
  | "bouncedHard"
  | "bouncedSoft"
  | "complained"
  | "rejected";

const COLUMN: Readonly<Record<DeliveryCounter, string>> = {
  sent: "sent",
  delivered: "delivered",
  bouncedHard: "bounced_hard",
  bouncedSoft: "bounced_soft",
  complained: "complained",
  rejected: "rejected",
};

/** What a window of days came to, which is all the breaker reads. */
export interface DeliveryWindow {
  readonly sent: number;
  readonly bounced: number;
  readonly complained: number;
}

/**
 * Deliverability as SES reports it, per project per day (risks.md 2).
 *
 * One row per day and one increment per event. The increment is a conditional upsert rather
 * than a read and a write, for the reason the SMS spend cap gives: two events landing at once
 * would otherwise both read the same figure and the second would write back what the first
 * had added.
 */
export class EmailDeliveryStatsRepository extends BaseRepository<typeof emailDeliveryStats> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, emailDeliveryStats);
  }

  /**
   * Adds one to a counter for a day, creating the day if this is its first event.
   *
   * The column name is interpolated from `COLUMN` and never from a caller's string, because
   * `DeliveryCounter` is a closed union and the map is total over it.
   */
  async increment(day: string, counter: DeliveryCounter, by = 1): Promise<void> {
    const column = sql.raw(COLUMN[counter]);
    await this.guard(() =>
      this.tx.execute(
        sql`insert into email_delivery_stats (project_id, day, ${column})
            values (${this.context.projectId}, ${day}::date, ${by})
            on conflict (project_id, day)
            do update set ${column} = email_delivery_stats.${column} + ${by},
                          updated_at = now()`,
      ),
    );
  }

  /**
   * The window the breaker judges on, summed across days.
   *
   * Hard and soft bounces are added together on purpose. Only a permanent bounce suppresses
   * an address, but AWS counts every bounce towards the account's rate, so a breaker that
   * ignored the transient ones would be measuring something other than the thing that gets
   * the account reviewed.
   */
  async since(day: string): Promise<DeliveryWindow> {
    const rows = await this.tx
      .select({
        sent: sql<string>`coalesce(sum(${emailDeliveryStats.sent}), 0)`,
        bounced: sql<string>`coalesce(sum(${emailDeliveryStats.bouncedHard} + ${emailDeliveryStats.bouncedSoft}), 0)`,
        complained: sql<string>`coalesce(sum(${emailDeliveryStats.complained}), 0)`,
      })
      .from(emailDeliveryStats)
      .where(and(this.tenantScope(), gte(emailDeliveryStats.day, day)));

    const row = rows[0];
    return {
      sent: Number(row?.sent ?? 0),
      bounced: Number(row?.bounced ?? 0),
      complained: Number(row?.complained ?? 0),
    };
  }
}
