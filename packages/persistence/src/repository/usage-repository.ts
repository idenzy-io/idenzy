import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { and, asc, between, eq, sql } from "drizzle-orm";
import { usageDaily } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** `YYYY-MM-DD` in UTC, which is what the `day` column stores. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** One day's row, as everything that reports usage reads it. */
export interface DailyUsage {
  readonly day: string;
  /**
   * The day's sketch, deliberately not a number.
   *
   * A month is the *union* of these and never their sum: somebody who signs in on the 3rd and
   * the 4th is one MAU and two daily actives. Handing back the sketch is what makes that
   * impossible to get wrong by reading the wrong field.
   */
  readonly activeUsers: HyperLogLog;
  readonly emailsSent: number;
  readonly smsSent: number;
  readonly smsVerified: number;
  readonly smsCost: string;
}

/**
 * Daily usage rollups (PROJECT.md 5.1).
 *
 * Counters are incremented with an upsert rather than read-modify-written, so two
 * concurrent sends on the same day do not lose one another. Billing that silently
 * undercounts is worse than billing that fails loudly.
 */
export class UsageRepository extends BaseRepository<typeof usageDaily> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, usageDaily);
  }

  /**
   * Unions a sketch of active users into the day's row.
   *
   * The one method here that cannot be an upsert, because a union is not an operation Postgres
   * knows: the bytes have to come back, merge in this process and go down again. So the row is
   * locked for the round trip. Two meters flushing the same project-day would otherwise each
   * write the sketch they read, and the second would erase the first — silently, and in the
   * direction that undercharges.
   *
   * Nothing here is exactly-once and nothing needs to be. A union is a per-register maximum, so
   * a flush replayed after a crash lands on the sketch it already wrote.
   */
  async mergeActiveUsers(at: Date, sketch: HyperLogLog): Promise<void> {
    if (sketch.isEmpty) return;
    const day = utcDay(at);
    await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({ projectId: this.context.projectId, day })
        .onConflictDoNothing({ target: [usageDaily.projectId, usageDaily.day] }),
    );
    const rows = await this.tx
      .select({ mauHll: usageDaily.mauHll })
      .from(usageDaily)
      .where(and(this.tenantScope(), eq(usageDaily.day, day)))
      .for("update");
    const stored = rows[0]?.mauHll;
    const merged = stored === undefined || stored === null ? sketch : HyperLogLog.decode(stored);
    if (stored !== undefined && stored !== null && !merged.mergeFrom(sketch)) return;
    await this.guard(() =>
      this.tx
        .update(usageDaily)
        .set({ mauHll: Buffer.from(merged.encode()) })
        .where(and(this.tenantScope(), eq(usageDaily.day, day))),
    );
  }

  /** The window a bill or a chart covers, oldest first. Both ends are inclusive `YYYY-MM-DD`. */
  async dailyBetween(from: string, to: string): Promise<readonly DailyUsage[]> {
    const rows = await this.tx
      .select()
      .from(usageDaily)
      .where(and(this.tenantScope(), between(usageDaily.day, from, to)))
      .orderBy(asc(usageDaily.day));
    return rows.map((row) => ({
      day: row.day,
      activeUsers: row.mauHll === null ? HyperLogLog.empty() : HyperLogLog.decode(row.mauHll),
      emailsSent: row.emailsSent,
      smsSent: row.smsSent,
      smsVerified: row.smsVerified,
      smsCost: row.smsCost,
    }));
  }

  async recordEmailSent(at: Date, count = 1): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({ projectId: this.context.projectId, day: utcDay(at), emailsSent: count })
        .onConflictDoUpdate({
          target: [usageDaily.projectId, usageDaily.day],
          set: { emailsSent: sql`${usageDaily.emailsSent} + ${count}` },
        }),
    );
  }

  /**
   * Charges a send against the day's cap, and answers whether it may go ahead.
   *
   * The check and the increment are one statement, because a read followed by a write
   * lets two sends that each fit under the cap both pass and land above it. `setWhere`
   * is what refuses: the update does not apply, no row comes back, and no money is
   * committed.
   *
   * The first send of a day takes the insert branch, which no `setWhere` covers, so the
   * caller's own cost is compared against the cap here before the statement runs.
   *
   * `smsSent` moves with the reservation rather than with a delivery receipt. A send
   * that was reserved and then failed in transport still counted, which overstates the
   * day: that is the safe direction for a control whose failure mode is a bill.
   */
  async reserveSmsSpend(at: Date, cost: string, cap: string): Promise<boolean> {
    if (Number(cost) > Number(cap)) return false;
    const rows = await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({
          projectId: this.context.projectId,
          day: utcDay(at),
          smsSent: 1,
          smsCost: cost,
        })
        .onConflictDoUpdate({
          target: [usageDaily.projectId, usageDaily.day],
          set: {
            smsSent: sql`${usageDaily.smsSent} + 1`,
            smsCost: sql`${usageDaily.smsCost} + ${cost}::numeric`,
          },
          setWhere: sql`${usageDaily.smsCost} + ${cost}::numeric <= ${cap}::numeric`,
        })
        .returning({ day: usageDaily.day }),
    );
    return rows.length === 1;
  }

  /**
   * Corrects a reservation once the provider reports what it actually charged.
   *
   * No cap check: the message is already sent, and refusing here would leave the ledger
   * disagreeing with the invoice. A provider that came in cheaper than quoted returns
   * the difference, so `delta` is signed.
   */
  async settleSmsSpend(at: Date, delta: string): Promise<void> {
    if (Number(delta) === 0) return;
    await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({ projectId: this.context.projectId, day: utcDay(at), smsCost: delta })
        .onConflictDoUpdate({
          target: [usageDaily.projectId, usageDaily.day],
          set: { smsCost: sql`${usageDaily.smsCost} + ${delta}::numeric` },
        }),
    );
  }

  /** A code that was entered. The denominator of the send-to-verify ratio (4.8). */
  async recordSmsVerified(at: Date): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({ projectId: this.context.projectId, day: utcDay(at), smsVerified: 1 })
        .onConflictDoUpdate({
          target: [usageDaily.projectId, usageDaily.day],
          set: { smsVerified: sql`${usageDaily.smsVerified} + 1` },
        }),
    );
  }

  /** Today's send and verify counts, for the pumping ratio. Zeroes before the first send. */
  async smsCountersFor(at: Date): Promise<{ sent: number; verified: number }> {
    const rows = await this.tx
      .select({ sent: usageDaily.smsSent, verified: usageDaily.smsVerified })
      .from(usageDaily)
      .where(and(this.tenantScope(), eq(usageDaily.day, utcDay(at))))
      .limit(1);
    const row = rows[0];
    return { sent: row?.sent ?? 0, verified: row?.verified ?? 0 };
  }
}
