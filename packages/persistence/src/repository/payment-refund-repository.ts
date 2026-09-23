import { ResourceConflictError } from "@idenzy/core/errors";
import type { PaymentProvider, RefundState } from "@idenzy/protocol/enums/billing";
import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { paymentRefunds } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface PaymentRefundRow {
  readonly id: string;
  readonly topUpId: string;
  readonly providerRefundId: string;
  readonly amountCents: number;
  readonly state: RefundState;
  readonly reversedFromCreditCents: number;
  readonly reversedToDebtCents: number;
  readonly clawedBackAt: Date | null;
  readonly restoredAt: Date | null;
}

export interface RefundReport {
  readonly topUpId: string;
  readonly provider: PaymentProvider;
  readonly providerRefundId: string;
  readonly amountCents: number;
  readonly state: RefundState;
}

/** The states a refund never leaves: the money came back to us. */
export const FINAL_REFUND_STATES: readonly RefundState[] = ["failed", "canceled"];

function toRow(row: typeof paymentRefunds.$inferSelect): PaymentRefundRow {
  return {
    id: row.id,
    topUpId: row.topUpId,
    providerRefundId: row.providerRefundId,
    amountCents: row.amountCents,
    // Safe: the column is written only from RefundState.
    state: row.state as RefundState,
    reversedFromCreditCents: row.reversedFromCreditCents,
    reversedToDebtCents: row.reversedToDebtCents,
    clawedBackAt: row.clawedBackAt,
    restoredAt: row.restoredAt,
  };
}

/**
 * Refunds of top-ups, as the provider reports them (ADR-0017).
 *
 * `report` is an upsert that will not move a row out of a final state, so the four refund
 * events can arrive in any order without a stale `pending` undoing a `failed`. `claimClawback`
 * and `claimRestore` are the one-way doors, each a conditional update whose row lock is what
 * makes two deliveries of the same event take the credit once: the second waits for the first
 * to commit and then matches nothing.
 */
export class PaymentRefundRepository extends OrgRepository<typeof paymentRefunds> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, paymentRefunds);
  }

  async report(refund: RefundReport): Promise<PaymentRefundRow> {
    await this.guard(() =>
      this.tx
        .insert(paymentRefunds)
        .values({ orgId: this.context.orgId, ...refund })
        .onConflictDoUpdate({
          target: [paymentRefunds.provider, paymentRefunds.providerRefundId],
          set: { state: refund.state, updatedAt: new Date() },
          setWhere: sql`${eq(paymentRefunds.orgId, this.context.orgId)} and ${notInArray(
            paymentRefunds.state,
            [...FINAL_REFUND_STATES],
          )}`,
        }),
    );
    const rows = await this.tx
      .select()
      .from(paymentRefunds)
      .where(
        and(
          this.orgScope(),
          eq(paymentRefunds.provider, refund.provider),
          eq(paymentRefunds.providerRefundId, refund.providerRefundId),
        ),
      )
      .limit(1);
    const row = rows[0];
    // A refund id that exists under another organisation: the conflict matched and the
    // scope did not. Refused rather than answered, because it means the two disagree.
    if (row === undefined) {
      throw new ResourceConflictError({ detail: { refund: refund.providerRefundId } });
    }
    return toRow(row);
  }

  /** Claims the clawback. True once per refund, whoever asks. */
  async claimClawback(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(paymentRefunds)
      .set({ clawedBackAt: at, updatedAt: at })
      .where(and(this.orgScope(), eq(paymentRefunds.id, id), isNull(paymentRefunds.clawedBackAt)))
      .returning({ id: paymentRefunds.id });
    return rows.length === 1;
  }

  /** Writes down how a claimed clawback was paid. */
  async recordReversal(id: string, fromCreditCents: number, toDebtCents: number): Promise<void> {
    await this.tx
      .update(paymentRefunds)
      .set({ reversedFromCreditCents: fromCreditCents, reversedToDebtCents: toDebtCents })
      .where(and(this.orgScope(), eq(paymentRefunds.id, id)));
  }

  /** Claims giving it back, after a refund that failed. Only once, and only if it was taken. */
  async claimRestore(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(paymentRefunds)
      .set({ restoredAt: at, updatedAt: at })
      .where(
        and(
          this.orgScope(),
          eq(paymentRefunds.id, id),
          isNotNull(paymentRefunds.clawedBackAt),
          isNull(paymentRefunds.restoredAt),
        ),
      )
      .returning({ id: paymentRefunds.id });
    return rows.length === 1;
  }
}
