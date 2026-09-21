import { and, asc, between, desc } from "drizzle-orm";
import { usagePeriods } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** A month's figures, as an invoice reads them. */
export interface UsagePeriodRow {
  /** The first day of the calendar month, `YYYY-MM-DD` in UTC. */
  readonly period: string;
  readonly activeUsers: number;
  readonly emailsSent: number;
  readonly smsSent: number;
  readonly smsVerified: number;
  readonly smsCost: string;
  readonly closedAt: Date;
}

export type UsagePeriodFigures = Omit<UsagePeriodRow, "closedAt">;

/**
 * Closed billing periods: one row per project per month (PROJECT.md 5.1).
 *
 * The table exists so the daily sketches do not have to outlive the month they bill, and this
 * repository is deliberately thin because the row is a record rather than state. There is no
 * update and no delete here, and there could not be: migration 0046 withholds both verbs from
 * the app role, so a method that tried would fail at the database rather than at review.
 */
export class UsagePeriodRepository extends BaseRepository<typeof usagePeriods> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, usagePeriods);
  }

  /**
   * Records a closed period, and answers whether this call is the one that closed it.
   *
   * `onConflictDoNothing` rather than an upsert, which is what makes the closer safe to run
   * twice: a second pass over a month that is already shut writes nothing and says so, so it
   * cannot re-close a period against sketches that have since been dropped and record a zero.
   */
  async close(
    figures: UsagePeriodFigures,
    closedAt: Date,
  ): Promise<{ readonly closed: boolean; readonly row: UsagePeriodRow }> {
    const rows = await this.guard(() =>
      this.tx
        .insert(usagePeriods)
        .values({ projectId: this.context.projectId, ...figures, closedAt })
        .onConflictDoNothing({ target: [usagePeriods.projectId, usagePeriods.period] })
        .returning(),
    );
    const inserted = rows[0];
    if (inserted !== undefined) return { closed: true, row: present(inserted) };
    const existing = await this.between(figures.period, figures.period);
    // The conflicting row is there by definition: the insert found it. Falling back to what was
    // asked for rather than asserting keeps a race from throwing on the path that already worked.
    return { closed: false, row: existing[0] ?? { ...figures, closedAt } };
  }

  /** Closed periods in a window, oldest first. Both ends are inclusive month starts. */
  async between(from: string, to: string): Promise<readonly UsagePeriodRow[]> {
    const rows = await this.tx
      .select()
      .from(usagePeriods)
      .where(and(this.tenantScope(), between(usagePeriods.period, from, to)))
      .orderBy(asc(usagePeriods.period));
    return rows.map(present);
  }

  /** The most recently closed period, or null for a project that has never had one shut. */
  async latest(): Promise<UsagePeriodRow | null> {
    const rows = await this.tx
      .select()
      .from(usagePeriods)
      .where(this.tenantScope())
      .orderBy(desc(usagePeriods.period))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : present(row);
  }
}

function present(row: typeof usagePeriods.$inferSelect): UsagePeriodRow {
  return {
    period: row.period,
    activeUsers: row.activeUsers,
    emailsSent: row.emailsSent,
    smsSent: row.smsSent,
    smsVerified: row.smsVerified,
    smsCost: row.smsCost,
    closedAt: row.closedAt,
  };
}
