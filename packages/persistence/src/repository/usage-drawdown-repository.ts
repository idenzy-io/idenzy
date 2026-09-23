import type { BillingLineItem } from "@idenzy/protocol/enums/billing";
import { and, desc, eq, gte, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { orgDebts, usageBillingState, usageCharges } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface BillingStateRow {
  readonly billedMau: number;
  readonly billedCents: number;
}

export interface NewCharge {
  readonly period: string;
  readonly item: BillingLineItem;
  readonly quantity: number;
  readonly chargedCents: number;
  readonly fromCreditCents: number;
  readonly toDebtCents: number;
}

/**
 * The drawdown's own state: what has been billed, what is owed, and the record of both
 * (ADR-0014).
 *
 * Every method here is one statement, and for the reason the SMS spend cap gives: a read
 * followed by a write lets two passes that each looked correct both commit. The one that
 * matters is `advance`, which carries the compare-and-swap that makes the whole design
 * safe to run twice and safe to run in parallel.
 */
export class UsageDrawdownRepository extends OrgRepository<typeof usageBillingState> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, usageBillingState);
  }

  /** What has been billed for a month. Absent and zero are the same answer. */
  async stateFor(period: string): Promise<BillingStateRow> {
    const rows = await this.tx
      .select({
        billedMau: usageBillingState.billedMau,
        billedCents: usageBillingState.billedCents,
      })
      .from(usageBillingState)
      .where(and(this.orgScope(), eq(usageBillingState.period, period)))
      .limit(1);
    return rows[0] ?? { billedMau: 0, billedCents: 0 };
  }

  /**
   * Moves the watermark, and only from where the caller last saw it.
   *
   * The `billed_mau = expected` predicate is the whole guarantee. Two passes that read the
   * same month at the same moment both compute the same charge; the first to commit moves
   * the watermark and the second matches no row, answers false, and is told to look again.
   * A pass that simply ran twice finds the watermark already ahead and computes nothing to
   * charge before it ever gets here.
   *
   * The insert branch covers the month's first charge, where there is no row to compare
   * against — `setWhere` does not apply to it, so the conflict target carries the same
   * predicate for the update path.
   *
   * Must be called inside the transaction that took the credit. Split across two, a crash
   * between them either charges without recording it or records without charging.
   */
  async advance(
    period: string,
    expectedMau: number,
    mau: number,
    billedCents: number,
  ): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .insert(usageBillingState)
        .values({
          orgId: this.context.orgId,
          period,
          billedMau: mau,
          billedCents,
        })
        .onConflictDoUpdate({
          target: [usageBillingState.orgId, usageBillingState.period],
          set: { billedMau: mau, billedCents, updatedAt: new Date() },
          setWhere: eq(usageBillingState.billedMau, expectedMau),
        })
        .returning({ period: usageBillingState.period }),
    );
    return rows.length === 1;
  }

  /** What the organisation owes beyond its credit. Absent and zero are the same answer. */
  async debtCents(): Promise<number> {
    const rows = await this.tx
      .select({ debtCents: orgDebts.debtCents })
      .from(orgDebts)
      .where(eq(orgDebts.orgId, this.context.orgId))
      .limit(1);
    return rows[0]?.debtCents ?? 0;
  }

  /**
   * What is owed, with the row locked until the transaction ends.
   *
   * For a settlement, which reads the debt to decide how much of a payment clears it. Two
   * payments reading the same figure at once would each clear all of it, `greatest(0, …)`
   * would floor the second at zero, and the customer would be granted less credit than they
   * paid for. The lock makes the second read what the first left.
   */
  async lockedDebtCents(): Promise<number> {
    const rows = await this.tx
      .select({ debtCents: orgDebts.debtCents })
      .from(orgDebts)
      .where(eq(orgDebts.orgId, this.context.orgId))
      .limit(1)
      .for("update");
    return rows[0]?.debtCents ?? 0;
  }

  /**
   * Adds to the debt, or takes from it, in one statement.
   *
   * `greatest(0, …)` rather than a check the caller makes first: a settlement racing a
   * charge would otherwise read a figure that moved underneath it, and a debt that went
   * negative would be credit hiding in the wrong column. Overpayment is the caller's to
   * turn into a grant, which is what a top-up does.
   */
  async adjustDebt(deltaCents: number): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(orgDebts)
        .values({ orgId: this.context.orgId, debtCents: Math.max(0, deltaCents) })
        .onConflictDoUpdate({
          target: orgDebts.orgId,
          set: {
            debtCents: sql`greatest(0, ${orgDebts.debtCents} + ${deltaCents})`,
            updatedAt: new Date(),
          },
        }),
    );
  }

  /** Writes the charge down. Append-only: the table grants no UPDATE and no DELETE. */
  async record(charge: NewCharge): Promise<void> {
    await this.guard(() =>
      this.tx.insert(usageCharges).values({ orgId: this.context.orgId, ...charge }),
    );
  }

  /**
   * What has been charged since an instant, for the tolerance (ADR-0014).
   *
   * Charges and not top-ups. Tolerance keyed on payments moves when a customer happens to
   * pay — one that prepays in January has rope until the 31st and none on the 1st, having
   * done nothing differently — where this tracks how much they actually use.
   */
  async chargedSince(since: Date): Promise<number> {
    const rows = await this.tx
      .select({ total: sql<string>`coalesce(sum(${usageCharges.chargedCents}), 0)` })
      .from(usageCharges)
      .where(and(this.scopeOf(usageCharges.orgId), gte(usageCharges.createdAt, since)));
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * `orgScope()` names this repository's own table, and two of the three here are not it.
   *
   * The base's predicate is built from `usage_billing_state`, so reaching for it while
   * selecting from `usage_charges` emits `"usage_billing_state"."org_id"` against a table
   * that is not in the query — which Postgres refuses outright. A row policy used to scope the
   * read whatever this said, which is how the mistake stayed invisible; with no policy left it is
   * the only scope there is. The same mistake the project users read model made once with
   * `tenantScope()`.
   */
  private scopeOf(column: PgColumn): SQL {
    return eq(column, this.context.orgId);
  }

  /** The most recent charges, for the wallet's own "what did this month cost" strip. */
  async recentCharges(limit = 50): Promise<readonly (NewCharge & { createdAt: Date })[]> {
    const rows = await this.tx
      .select()
      .from(usageCharges)
      .where(this.scopeOf(usageCharges.orgId))
      .orderBy(desc(usageCharges.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      period: row.period,
      // Safe: the column is written only from BillingLineItem.
      item: row.item as BillingLineItem,
      quantity: row.quantity,
      chargedCents: row.chargedCents,
      fromCreditCents: row.fromCreditCents,
      toDebtCents: row.toDebtCents,
      createdAt: row.createdAt,
    }));
  }
}
