import {
  AutoTopUpSuspension,
  DisputeStatus,
  PaymentProvider,
  type RefundState,
  TopUpState,
} from "@idenzy/protocol/enums/billing";
import { BillingSettingsRepository } from "../repository/billing-settings-repository.js";
import { PaymentDisputeRepository } from "../repository/payment-dispute-repository.js";
import {
  FINAL_REFUND_STATES,
  PaymentRefundRepository,
} from "../repository/payment-refund-repository.js";
import { TopUpRepository } from "../repository/top-up-repository.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { WalletLedger } from "./wallet-ledger.js";

export interface RefundSnapshot {
  readonly providerRefundId: string;
  readonly providerIntentId: string;
  readonly amountCents: number;
  readonly state: RefundState;
  readonly at: Date;
}

/** Which way the money moved, where the event says it did. */
export type DisputeMovement = "withdrawn" | "reinstated" | null;

export interface DisputeSnapshot {
  readonly providerDisputeId: string;
  readonly providerIntentId: string;
  readonly amountCents: number;
  readonly status: DisputeStatus;
  readonly reason: string;
  readonly movement: DisputeMovement;
  readonly at: Date;
}

/** What a reversal did, for the log and for whoever sends the email one day. */
export interface Reversal {
  readonly topUpId: string;
  readonly debitedCents: number;
  readonly creditedCents: number;
  readonly suspended: AutoTopUpSuspension | null;
}

/** Statuses that mean the provider has kept the funds for good. */
const LOST: readonly DisputeStatus[] = [DisputeStatus.Lost];
/** Statuses that mean the funds come back to us. */
const WON: readonly DisputeStatus[] = [DisputeStatus.Won];
const CLOSED: readonly DisputeStatus[] = [
  DisputeStatus.Won,
  DisputeStatus.Lost,
  DisputeStatus.WarningClosed,
  DisputeStatus.Prevented,
];

/**
 * Money that left again after a top-up brought it in: refunds and disputes (ADR-0017).
 *
 * **The wallet follows the money, not the paperwork.** A refund takes back the credit its
 * top-up bought as soon as the provider reports it pending, because the money is on its way
 * out and credit extended against it would be credit nobody paid for; a refund that then fails
 * gives it back. A dispute takes it when the provider withdraws the funds and gives it back
 * when they are reinstated. Anything already spent becomes debt, and the tolerance and the
 * spend gate treat it like any other.
 *
 * **Each movement happens once, whatever arrives.** Every event is claimed by a conditional
 * update on the refund or dispute row before the wallet is touched, and the row lock that
 * update takes is what makes two concurrent deliveries of one event move the balance once.
 *
 * **Both suspend the automatic rule.** Charging again the card of somebody disputing a charge
 * is how a merchant account is lost, and the merchant account is every customer's; charging it
 * again straight after a refund takes back what was just handed back.
 */
export class TopUpReversals {
  private readonly topUps: TopUpRepository;
  private readonly refunds: PaymentRefundRepository;
  private readonly disputes: PaymentDisputeRepository;
  private readonly settings: BillingSettingsRepository;
  private readonly ledger: WalletLedger;

  constructor(tx: Transaction, context: OrgContext) {
    this.topUps = new TopUpRepository(tx, context);
    this.refunds = new PaymentRefundRepository(tx, context);
    this.disputes = new PaymentDisputeRepository(tx, context);
    this.settings = new BillingSettingsRepository(tx, context);
    this.ledger = new WalletLedger(tx, context);
  }

  /** Null when the refund is not of a top-up that bought credit here. */
  async refund(refund: RefundSnapshot): Promise<Reversal | null> {
    // The settings lock first, as every writer of this organisation's money takes it.
    await this.settings.lockForAutoTopUp();
    const topUp = await this.topUps.byIntent(refund.providerIntentId);
    // Only a top-up that succeeded bought anything. Refunding one that never granted credit
    // must not take credit it never gave.
    if (topUp === null || topUp.state !== TopUpState.Succeeded) return null;

    const row = await this.refunds.report({
      topUpId: topUp.id,
      provider: PaymentProvider.Stripe,
      providerRefundId: refund.providerRefundId,
      amountCents: refund.amountCents,
      state: refund.state,
    });

    if (FINAL_REFUND_STATES.includes(row.state)) {
      if (!(await this.refunds.claimRestore(row.id, refund.at))) return this.none(topUp.id);
      const credited = await this.ledger.credit(row.amountCents, {
        currency: topUp.currency,
        topUpId: topUp.id,
        note: "Refund reversed",
        noteAfterDebt: "Refund reversed, after settling outstanding usage",
      });
      return {
        ...this.none(topUp.id),
        creditedCents: credited.grantedCents + credited.settledDebtCents,
      };
    }

    if (!(await this.refunds.claimClawback(row.id, refund.at))) return this.none(topUp.id);
    const debited = await this.ledger.debit(row.amountCents, refund.at, topUp.id);
    await this.refunds.recordReversal(row.id, debited.fromCreditCents, debited.toDebtCents);
    // The clawback usually takes the balance under the threshold, and a rule that charged the
    // same card again at once would undo the refund somebody just asked for.
    const suspended = (await this.settings.suspendAutoTopUp(
      AutoTopUpSuspension.Refunded,
      refund.at,
    ))
      ? AutoTopUpSuspension.Refunded
      : null;
    return { ...this.none(topUp.id), debitedCents: row.amountCents, suspended };
  }

  /** Null when the dispute is not of a top-up that bought credit here. */
  async dispute(dispute: DisputeSnapshot): Promise<Reversal | null> {
    await this.settings.lockForAutoTopUp();
    const topUp = await this.topUps.byIntent(dispute.providerIntentId);
    if (topUp === null || topUp.state !== TopUpState.Succeeded) return null;

    const row = await this.disputes.report({
      topUpId: topUp.id,
      provider: PaymentProvider.Stripe,
      providerDisputeId: dispute.providerDisputeId,
      amountCents: dispute.amountCents,
      status: dispute.status,
      reason: dispute.reason,
    });

    // On the first report, whatever it says. An inquiry that never becomes a chargeback is
    // still a cardholder telling their bank they did not expect a charge from us.
    const suspended =
      row.firstReport &&
      (await this.settings.suspendAutoTopUp(AutoTopUpSuspension.Dispute, dispute.at))
        ? AutoTopUpSuspension.Dispute
        : null;

    let debitedCents = 0;
    let creditedCents = 0;

    // A lost dispute implies the funds went, even if the event that said so never arrived.
    const withdrawn = dispute.movement === "withdrawn" || LOST.includes(dispute.status);
    if (withdrawn && (await this.disputes.claimWithdrawal(row.id, dispute.at))) {
      const debited = await this.ledger.debit(row.amountCents, dispute.at, topUp.id);
      await this.disputes.recordWithdrawal(row.id, debited.fromCreditCents, debited.toDebtCents);
      debitedCents = row.amountCents;
    }

    // A won dispute implies the funds came back, likewise. `claimReinstatement` refuses one
    // that was never withdrawn, so an inquiry closed in our favour gives nothing away.
    const reinstated = dispute.movement === "reinstated" || WON.includes(dispute.status);
    if (reinstated && (await this.disputes.claimReinstatement(row.id, dispute.at))) {
      const credited = await this.ledger.credit(row.amountCents, {
        currency: topUp.currency,
        topUpId: topUp.id,
        note: "Dispute resolved in your favour",
        noteAfterDebt: "Dispute resolved in your favour, after settling outstanding usage",
      });
      creditedCents = credited.grantedCents + credited.settledDebtCents;
    }

    if (CLOSED.includes(dispute.status)) await this.disputes.close(row.id, dispute.at);
    return { topUpId: topUp.id, debitedCents, creditedCents, suspended };
  }

  private none(topUpId: string): Reversal {
    return { topUpId, debitedCents: 0, creditedCents: 0, suspended: null };
  }
}
