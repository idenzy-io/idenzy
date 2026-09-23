import type { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import {
  AUTO_TOP_UP_WINDOW_MS,
  AutoTopUpPolicy,
  type AutoTopUpSkip,
} from "@idenzy/domain/policies/auto-top-up-policy";
import type { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import type { ChargeOutcome, PaymentProvider } from "@idenzy/domain/ports/payment-provider";
import { TopUpSettlement } from "@idenzy/persistence/billing/top-up-settlement";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import type {
  BillingWorkReader,
  OpenAutomaticCharge,
} from "@idenzy/persistence/repository/billing-work-reader";
import { OrgBillingCustomerRepository } from "@idenzy/persistence/repository/org-billing-customer-repository";
import { PaymentMethodRepository } from "@idenzy/persistence/repository/payment-method-repository";
import { TopUpRepository } from "@idenzy/persistence/repository/top-up-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  type AutoTopUpSuspension,
  BillingMode,
  PaymentProvider as ProviderName,
  TopUpState,
  TopUpTrigger,
} from "@idenzy/protocol/enums/billing";

/** What one look at an organisation came to, for the log and for tests. */
export type AutoTopUpResult =
  | { readonly kind: "skipped"; readonly reason: AutoTopUpSkip | "cached_off" }
  | { readonly kind: "suspended"; readonly reason: AutoTopUpSuspension }
  | { readonly kind: "charged"; readonly topUpId: string; readonly state: TopUpState }
  /** Opened and asked, and nobody knows the answer yet. The reconciler finishes it. */
  | { readonly kind: "unresolved"; readonly topUpId: string };

/** A charge opened and committed, and everything needed to ask the provider for it. */
interface Opened {
  readonly topUpId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly providerCustomerId: string;
  readonly providerMethodId: string;
}

export interface AutoTopUpRunnerOptions {
  /** How long an open charge may sit before the reconciler asks about it. */
  readonly staleAfterMs?: number;
}

/** A day, less an hour's margin: Stripe honours an idempotency key for twenty-four hours. */
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const DEFAULT_STALE_MS = 2 * 60 * 1000;
const TERMINAL: readonly TopUpState[] = [
  TopUpState.Succeeded,
  TopUpState.Failed,
  TopUpState.Cancelled,
  TopUpState.RequiresAction,
];

/**
 * Charges an organisation's saved card when its balance falls below the threshold it set
 * (ADR-0017).
 *
 * **Never twice, and the guarantee is in three places, not one.** The settings row is locked
 * for the whole decision, so two workers deciding about one organisation run one after the
 * other and the second sees the charge the first opened. A partial unique index allows one open
 * automatic charge per organisation whatever the code believes. And the provider is asked with
 * an idempotency key derived from our row, so asking twice about one row charges once.
 *
 * **The row comes first and the charge second**, as every payment path here does it: the
 * charge is opened and committed before the provider is called, so a crash between the two
 * leaves a row somebody can reconcile rather than a charge nobody can attribute. The reverse
 * order is how a card gets charged for credit that never appears.
 *
 * **An answer nobody heard is not a failure.** A timeout may have charged the card. The row
 * stays open, blocks the next charge through the index, and `reconcile` finishes it: by asking
 * again under the same key while the provider still honours it, and by searching for our
 * reference once it does not.
 */
export class AutoTopUpRunner {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly payments: PaymentProvider,
    private readonly rules: AutoTopUpRuleCache,
    private readonly signals: BillingSignals,
    private readonly work: BillingWorkReader,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly policy: AutoTopUpPolicy = new AutoTopUpPolicy(),
    private readonly options: AutoTopUpRunnerOptions = {},
  ) {}

  /**
   * One look at one organisation.
   *
   * `useCache` lets a signal skip an organisation whose rule is off without reading Postgres.
   * The periodic pass passes false, which is what bounds a stale cache entry to one pass.
   *
   * `pendingCents` is usage priced live and not yet on the ledger (`LiveBalance`), so the rule
   * fires on the balance a person would see rather than one up to five minutes behind it. It can
   * only bring a top-up forward: every limit and guard below is unchanged.
   */
  async evaluate(orgId: string, useCache: boolean, pendingCents = 0): Promise<AutoTopUpResult> {
    if (useCache && (await this.cachedOff(orgId))) return { kind: "skipped", reason: "cached_off" };

    const context = new OrgContext(orgId, "auto-top-up", "system");
    const now = this.clock.now();
    const decided = await this.uow.transaction(async (tx) => {
      const settings = new BillingSettingsRepository(tx, context);
      const topUps = new TopUpRepository(tx, context);

      // Held until this transaction commits, by which time the charge below is visible to the
      // next worker to take it.
      const current = await settings.lockForAutoTopUp();
      if (current === null) {
        return { result: skipped("disabled"), armed: false, thresholdCents: 0 } as const;
      }
      const thresholdCents = current.autoTopUp.thresholdCents;
      const armed =
        current.autoTopUp.enabled &&
        current.autoTopUpState.suspendedReason === null &&
        current.mode === BillingMode.Prepaid;

      const methods = await new PaymentMethodRepository(tx, context).list();
      const method =
        methods.find((card) => card.id === current.autoTopUp.methodId) ??
        methods.find((card) => card.isDefault) ??
        null;
      const customer = await new OrgBillingCustomerRepository(tx, context).current();
      const chargeable = method !== null && customer?.billingCustomerId != null;

      const decision = this.policy.decide(
        {
          ...current.autoTopUp,
          invoiced: current.mode === BillingMode.Invoiced,
          dailyLimit: current.autoTopUpState.dailyLimit,
          failures: current.autoTopUpState.failures,
          lastAttemptAt: current.autoTopUpState.lastAttemptAt,
          suspendedReason: current.autoTopUpState.suspendedReason,
        },
        {
          balanceCents:
            (await new WalletLedger(tx, context).balanceCents(now)) - Math.max(0, pendingCents),
          attemptsInWindow: await topUps.automaticAttemptsSince(
            new Date(now.getTime() - AUTO_TOP_UP_WINDOW_MS),
          ),
          openCharge: (await topUps.openAutomatic()) !== null,
          hasPaymentMethod: chargeable,
          now,
        },
      );

      if (decision.kind === "skip") {
        return { result: skipped(decision.reason), armed, thresholdCents } as const;
      }
      if (decision.kind === "suspend") {
        await settings.suspendAutoTopUp(decision.reason, now);
        return {
          result: { kind: "suspended", reason: decision.reason },
          armed: false,
          thresholdCents,
        } as const;
      }
      if (method === null || customer?.billingCustomerId == null) {
        return { result: skipped("disabled"), armed, thresholdCents } as const;
      }

      const topUp = await topUps.start({
        amountCents: decision.amountCents,
        currency: current.currency,
        trigger: TopUpTrigger.Automatic,
        provider: ProviderName.Stripe,
        paymentMethodId: method.id,
        cardBrand: method.brand,
        cardLast4: method.last4,
        requestedBy: null,
        createdAt: now,
      });
      await settings.recordAutoTopUpAttempt(now);
      const opened: Opened = {
        topUpId: topUp.id,
        amountCents: topUp.amountCents,
        currency: topUp.currency,
        providerCustomerId: customer.billingCustomerId,
        providerMethodId: method.providerMethodId,
      };
      return { result: null, armed, thresholdCents, opened } as const;
    });

    await this.remember(orgId, decided.armed, decided.thresholdCents);
    if (decided.result !== null) {
      if (decided.result.kind === "suspended") await this.signals.ruleChanged(orgId);
      return decided.result;
    }
    return await this.charge(context, decided.opened);
  }

  /**
   * Finishes automatic charges whose answer was never written down.
   *
   * Three cases, in order of how sure we can be. A charge with an intent is asked about
   * directly. One without, still inside the idempotency window, is asked for again under the
   * same key — Stripe hands back the first attempt if there was one and makes it now if there
   * was not, and either way the card is charged at most once. One without, past the window, is
   * searched for by our reference; and only a search that finds nothing a whole day later
   * cancels the row, because a charge that happened would be indexed long before then.
   */
  async reconcile(limit = 50): Promise<number> {
    const now = this.clock.now();
    const stale = await this.work.openAutomaticCharges(
      new Date(now.getTime() - (this.options.staleAfterMs ?? DEFAULT_STALE_MS)),
      limit,
    );
    let finished = 0;
    for (const charge of stale) {
      try {
        if (await this.reconcileOne(charge, now)) finished += 1;
      } catch (cause: unknown) {
        this.logger.error("automatic top-up not reconciled", {
          orgId: charge.orgId,
          component: "billing",
          outcome: "deferred",
          errorName: cause instanceof Error ? cause.name : "unknown",
        });
      }
    }
    return finished;
  }

  private async reconcileOne(charge: OpenAutomaticCharge, now: Date): Promise<boolean> {
    const context = new OrgContext(charge.orgId, "auto-top-up", "system");

    if (charge.providerIntentId !== null) {
      return await this.settle(
        context,
        charge.topUpId,
        await this.payments.chargeStatus(charge.providerIntentId),
      );
    }

    const age = now.getTime() - charge.createdAt.getTime();
    if (age < IDEMPOTENCY_WINDOW_MS) {
      const replay = await this.replayable(context, charge.topUpId);
      if (replay !== null) {
        return await this.settle(context, charge.topUpId, await this.ask(context, replay));
      }
    }

    const found = await this.payments.findCharge(charge.topUpId);
    if (found !== null) return await this.settle(context, charge.topUpId, found);
    if (age < IDEMPOTENCY_WINDOW_MS) return false;

    // A day on, the provider has no charge under our reference and will no longer honour the
    // key: nothing was taken, and the row is closed so the rule can fire again.
    return await this.settle(context, charge.topUpId, {
      providerIntentId: "",
      state: TopUpState.Cancelled,
      failureCode: "abandoned",
      card: null,
    });
  }

  /** The exact request the first attempt made, which a replay under its key has to repeat. */
  private async replayable(context: OrgContext, topUpId: string): Promise<Opened | null> {
    return await this.uow.transaction(async (tx) => {
      const topUp = await new TopUpRepository(tx, context).byId(topUpId);
      if (topUp === null || topUp.paymentMethodId === null) return null;
      const method = (await new PaymentMethodRepository(tx, context).list()).find(
        (card) => card.id === topUp.paymentMethodId,
      );
      const customer = await new OrgBillingCustomerRepository(tx, context).current();
      if (method === undefined || customer?.billingCustomerId == null) return null;
      return {
        topUpId,
        amountCents: topUp.amountCents,
        currency: topUp.currency,
        providerCustomerId: customer.billingCustomerId,
        providerMethodId: method.providerMethodId,
      };
    });
  }

  private async charge(context: OrgContext, opened: Opened): Promise<AutoTopUpResult> {
    let outcome: ChargeOutcome;
    try {
      outcome = await this.ask(context, opened);
    } catch (cause: unknown) {
      // Not a failure: the card may have been charged. The row stays open, which is what stops
      // the next charge, and the reconciler asks again under the same key.
      this.logger.warn("automatic top-up unanswered", {
        orgId: context.orgId,
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
      return { kind: "unresolved", topUpId: opened.topUpId };
    }
    await this.settle(context, opened.topUpId, outcome);
    return { kind: "charged", topUpId: opened.topUpId, state: outcome.state };
  }

  private async ask(context: OrgContext, opened: Opened): Promise<ChargeOutcome> {
    return await this.payments.chargeOffSession({
      providerCustomerId: opened.providerCustomerId,
      orgId: context.orgId,
      providerMethodId: opened.providerMethodId,
      amountCents: opened.amountCents,
      currency: opened.currency,
      reference: opened.topUpId,
      idempotencyKey: `idenzy-auto-top-up-${opened.topUpId}`,
    });
  }

  /**
   * Writes the provider's answer down, and settles the charge if the answer is final.
   *
   * The handle is attached before anything else, so a webhook for this intent arriving from
   * now on finds the row. `TopUpSettlement` settles once for whichever of this and the webhook
   * gets there first.
   */
  private async settle(
    context: OrgContext,
    topUpId: string,
    outcome: ChargeOutcome,
  ): Promise<boolean> {
    const at = this.clock.now();
    const settled = await this.uow.transaction(async (tx) => {
      const hasHandle = outcome.providerIntentId.length > 0;
      if (hasHandle) {
        await new TopUpRepository(tx, context).attachIfUnset(topUpId, outcome.providerIntentId);
      }
      if (!TERMINAL.includes(outcome.state)) return null;
      return await new TopUpSettlement(tx, context, this.policy).settle({
        providerIntentId: hasHandle ? outcome.providerIntentId : { topUpId },
        state: outcome.state,
        failureCode: outcome.failureCode,
        at,
      });
    });
    if (settled?.suspended != null) await this.signals.ruleChanged(context.orgId);
    // The ledger moved, whichever way the charge went: a success added credit and a failure
    // changed what the rule remembers. Either is what the live balance's snapshot has to hear.
    if (settled != null) await this.signals.walletMoved(context.orgId);
    if (settled != null) {
      this.logger.info("automatic top-up settled", {
        orgId: context.orgId,
        component: "billing",
        outcome: settled.topUp.state,
      });
    }
    return settled != null;
  }

  private async cachedOff(orgId: string): Promise<boolean> {
    try {
      const cached = await this.rules.get(orgId);
      return cached !== null && !cached.armed;
    } catch {
      // The cache is an accelerator. Unreachable means ask Postgres, never "assume off".
      return false;
    }
  }

  private async remember(orgId: string, armed: boolean, thresholdCents: number): Promise<void> {
    try {
      await this.rules.put(orgId, { armed, thresholdCents });
    } catch {
      // Nothing depends on this having worked.
    }
  }
}

function skipped(reason: AutoTopUpSkip): AutoTopUpResult {
  return { kind: "skipped", reason };
}
