import { ResourceConflictError } from "@idenzy/core/errors";
import type { DisputeStatus, PaymentProvider } from "@idenzy/protocol/enums/billing";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { paymentDisputes } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface PaymentDisputeRow {
  readonly id: string;
  readonly topUpId: string;
  readonly providerDisputeId: string;
  readonly amountCents: number;
  readonly status: DisputeStatus;
  readonly reason: string;
  readonly withdrawnFromCreditCents: number;
  readonly withdrawnToDebtCents: number;
  readonly withdrawnAt: Date | null;
  readonly reinstatedAt: Date | null;
  readonly closedAt: Date | null;
  /** Whether this report was the first anybody made of the dispute. */
  readonly firstReport: boolean;
}

export interface DisputeReport {
  readonly topUpId: string;
  readonly provider: PaymentProvider;
  readonly providerDisputeId: string;
  readonly amountCents: number;
  readonly status: DisputeStatus;
  readonly reason: string;
}

/**
 * Cardholder disputes of top-ups, as the provider reports them (ADR-0017).
 *
 * The same shape as `PaymentRefundRepository`: a report that records the provider's latest
 * word, and two one-way doors — funds withdrawn, funds reinstated — each claimed by a
 * conditional update so a movement described by two events moves the wallet once.
 */
export class PaymentDisputeRepository extends OrgRepository<typeof paymentDisputes> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, paymentDisputes);
  }

  async report(dispute: DisputeReport): Promise<PaymentDisputeRow> {
    // `xmax = 0` is true only for a row this statement inserted, which is how the caller
    // learns that this is the first it has heard of the dispute without a read beforehand
    // that a concurrent delivery could also pass.
    const rows = await this.guard(() =>
      this.tx
        .insert(paymentDisputes)
        .values({ orgId: this.context.orgId, ...dispute })
        .onConflictDoUpdate({
          target: [paymentDisputes.provider, paymentDisputes.providerDisputeId],
          set: { status: dispute.status, reason: dispute.reason, updatedAt: new Date() },
          setWhere: eq(paymentDisputes.orgId, this.context.orgId),
        })
        .returning({ id: paymentDisputes.id, inserted: sql<boolean>`xmax = 0` }),
    );
    const written = rows[0];
    if (written === undefined) {
      throw new ResourceConflictError({ detail: { dispute: dispute.providerDisputeId } });
    }
    const found = await this.tx
      .select()
      .from(paymentDisputes)
      .where(and(this.orgScope(), eq(paymentDisputes.id, written.id)))
      .limit(1);
    const row = found[0];
    if (row === undefined) {
      throw new ResourceConflictError({ detail: { dispute: dispute.providerDisputeId } });
    }
    return {
      id: row.id,
      topUpId: row.topUpId,
      providerDisputeId: row.providerDisputeId,
      amountCents: row.amountCents,
      // Safe: the column is written only from DisputeStatus.
      status: row.status as DisputeStatus,
      reason: row.reason,
      withdrawnFromCreditCents: row.withdrawnFromCreditCents,
      withdrawnToDebtCents: row.withdrawnToDebtCents,
      withdrawnAt: row.withdrawnAt,
      reinstatedAt: row.reinstatedAt,
      closedAt: row.closedAt,
      firstReport: written.inserted,
    };
  }

  /** Claims the withdrawal. True once per dispute, whoever asks. */
  async claimWithdrawal(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(paymentDisputes)
      .set({ withdrawnAt: at, updatedAt: at })
      .where(and(this.orgScope(), eq(paymentDisputes.id, id), isNull(paymentDisputes.withdrawnAt)))
      .returning({ id: paymentDisputes.id });
    return rows.length === 1;
  }

  async recordWithdrawal(id: string, fromCreditCents: number, toDebtCents: number): Promise<void> {
    await this.tx
      .update(paymentDisputes)
      .set({ withdrawnFromCreditCents: fromCreditCents, withdrawnToDebtCents: toDebtCents })
      .where(and(this.orgScope(), eq(paymentDisputes.id, id)));
  }

  /** Claims the reinstatement. Only once, and only after a withdrawal. */
  async claimReinstatement(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(paymentDisputes)
      .set({ reinstatedAt: at, updatedAt: at })
      .where(
        and(
          this.orgScope(),
          eq(paymentDisputes.id, id),
          isNotNull(paymentDisputes.withdrawnAt),
          isNull(paymentDisputes.reinstatedAt),
        ),
      )
      .returning({ id: paymentDisputes.id });
    return rows.length === 1;
  }

  async close(id: string, at: Date): Promise<void> {
    await this.tx
      .update(paymentDisputes)
      .set({ closedAt: at, updatedAt: at })
      .where(and(this.orgScope(), eq(paymentDisputes.id, id), isNull(paymentDisputes.closedAt)));
  }
}
