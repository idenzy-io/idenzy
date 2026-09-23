import { AutoTopUpPolicy } from "@idenzy/domain/policies/auto-top-up-policy";
import { type AutoTopUpSuspension, TopUpState, TopUpTrigger } from "@idenzy/protocol/enums/billing";
import { BillingSettingsRepository } from "../repository/billing-settings-repository.js";
import {
  type SettledCard,
  TopUpRepository,
  type TopUpRow,
} from "../repository/top-up-repository.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { type Credited, WalletLedger } from "./wallet-ledger.js";

export interface Settlement {
  /** The provider's handle, or our row id for a charge refused before it had one. */
  readonly providerIntentId: string | { readonly topUpId: string };
  readonly state: TopUpState;
  readonly failureCode: string | null;
  readonly at: Date;
  readonly card?: SettledCard | null;
}

export interface Settled {
  readonly topUp: TopUpRow;
  /** Where the money went, on a charge that succeeded. */
  readonly credited: Credited | null;
  /** Set when this settlement stopped the automatic rule. */
  readonly suspended: AutoTopUpSuspension | null;
}

/**
 * Settles a charge once, and does everything that follows from it in the same transaction.
 *
 * **One place, because two things settle charges now.** The payment webhook always has, and
 * the automatic top-up worker settles the charges it makes from the provider's synchronous
 * answer. Whichever arrives first does the work; the second finds `settled_at` already set and
 * does nothing, which is `TopUpRepository.settle`'s predicate and not a check made here.
 *
 * **What follows a success is a credit through the ledger**: debt first, then spendable. What
 * follows an automatic charge either way is the rule's own bookkeeping — the failure count, and
 * a suspension where `AutoTopUpPolicy` says retrying cannot help — under the settings row lock,
 * so a webhook and the worker settling at the same moment count once.
 *
 * Runs in the caller's transaction and commits nothing itself.
 */
export class TopUpSettlement {
  private readonly topUps: TopUpRepository;
  private readonly settings: BillingSettingsRepository;
  private readonly ledger: WalletLedger;

  constructor(
    tx: Transaction,
    context: OrgContext,
    private readonly policy: AutoTopUpPolicy = new AutoTopUpPolicy(),
  ) {
    this.topUps = new TopUpRepository(tx, context);
    this.settings = new BillingSettingsRepository(tx, context);
    this.ledger = new WalletLedger(tx, context);
  }

  /** Null when there was nothing left to settle: already settled, or not ours. */
  async settle(settlement: Settlement): Promise<Settled | null> {
    // The settings row first, always, and before the charge's own row. The worker that opens
    // an automatic charge takes this lock and then touches `top_ups`; taking them here in the
    // other order is a deadlock waiting for the two to meet. Absent means the organisation
    // never set a rule, which leaves nothing to lock and nothing to count.
    const rule = await this.settings.lockForAutoTopUp();
    const topUp = await this.topUps.settle(
      settlement.providerIntentId,
      settlement.state,
      settlement.failureCode,
      settlement.at,
      settlement.card ?? null,
    );
    if (topUp === null) return null;

    let credited: Credited | null = null;
    if (settlement.state === TopUpState.Succeeded) {
      const kind = topUp.trigger === TopUpTrigger.Automatic ? "Automatic top-up" : "Top-up";
      credited = await this.ledger.credit(topUp.amountCents, {
        currency: topUp.currency,
        topUpId: topUp.id,
        note: kind,
        noteAfterDebt: `${kind}, after settling outstanding usage`,
      });
      await this.topUps.recordDebtSettled(topUp.id, credited.settledDebtCents);
    }

    const suspended =
      topUp.trigger === TopUpTrigger.Automatic && rule !== null
        ? await this.recordRuleOutcome(settlement, topUp)
        : null;
    return { topUp, credited, suspended };
  }

  private async recordRuleOutcome(
    settlement: Settlement,
    topUp: TopUpRow,
  ): Promise<AutoTopUpSuspension | null> {
    if (settlement.state === TopUpState.Succeeded) {
      await this.settings.recordAutoTopUpSuccess();
      return null;
    }
    const failures = await this.settings.recordAutoTopUpFailure();
    const reason = this.policy.afterFailure(
      failures,
      settlement.state,
      settlement.failureCode ?? topUp.failureCode,
    );
    if (reason === null) return null;
    return (await this.settings.suspendAutoTopUp(reason, settlement.at)) ? reason : null;
  }
}
