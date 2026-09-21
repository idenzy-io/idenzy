import {
  PaymentMethodRequiredError,
  PaymentsUnavailableError,
  ResourceNotFoundError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { PaymentProvider } from "@idenzy/domain/ports/payment-provider";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { InvoiceRepository } from "@idenzy/persistence/repository/invoice-repository";
import { OrgBillingCustomerRepository } from "@idenzy/persistence/repository/org-billing-customer-repository";
import { OrgMemberRepository } from "@idenzy/persistence/repository/org-member-repository";
import { PaymentMethodRepository } from "@idenzy/persistence/repository/payment-method-repository";
import { TopUpRepository } from "@idenzy/persistence/repository/top-up-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  CreditKind,
  PaymentProvider as ProviderName,
  TopUpState,
  TopUpTrigger,
} from "@idenzy/protocol/enums/billing";
import type {
  AutoTopUp,
  HostedCheckout,
  InvoiceDetail,
  InvoiceList,
  SpendAlert,
  Wallet,
} from "@idenzy/protocol/schemas/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { CHECKOUT_URLS, type CheckoutUrls } from "./payment-provider.module.js";
import { present } from "./present.js";

/**
 * What the billing screens read and the one thing they can do: add credit (PROJECT.md 5.1).
 *
 * **Everything is organisation-scoped and nothing is project-scoped.** One balance, one set
 * of cards, one invoice covering every project underneath, which is what `ADR-0011`'s
 * second tenant key is for.
 *
 * **No card number ever reaches this service.** Adding credit answers with a URL to leave
 * for, because the provider's hosted page is the only place a card is typed. That keeps
 * every service here out of PCI scope, and it is also why there is no "add card" body to
 * validate: there is nothing to send.
 *
 * **A provider call and a row cannot be made atomic.** The charge happens at the provider
 * whatever our transaction does, so the order is: record the intent, call, reconcile on the
 * webhook. `top_ups.provider_intent_id` carries a unique index and `settle` has
 * `settled_at is null` in its predicate, which is what makes a delivery we get twice grant
 * credit once.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    /**
     * `@Inject` by token and not by type, which is not decoration.
     *
     * A constructor parameter typed `PaymentProvider | null` emits `Object` into
     * `design:paramtypes` — a union has no runtime class — so Nest resolves nothing and the
     * parameter arrives `undefined`. `=== null` is then false and the next line dereferences
     * it. The symptom is a TypeError inside a handler rather than a boot failure, which is
     * the same shape as the `useImportType` trap `repo.md` records, and it was found by a
     * webhook answering 500 to a signature that verified perfectly well.
     */
    @Optional() @Inject(PaymentProvider) private readonly payments: PaymentProvider | null,
    @Optional() @Inject(CHECKOUT_URLS) private readonly urls: CheckoutUrls | null,
  ) {}

  /** Everything one screen needs about the money, in one read. */
  async wallet(context: OrgContext): Promise<Wallet> {
    const now = this.clock.now();
    return await this.uow.runForOrg(context, async (tx) => {
      const settings = await new BillingSettingsRepository(tx, context).current();
      const grants = await new CreditGrantRepository(tx, context).spendable(now);
      const methods = await new PaymentMethodRepository(tx, context).list();
      const topUps = await new TopUpRepository(tx, context).recent(20);
      const outstandingCents = await new InvoiceRepository(tx, context).outstandingCents();
      // One read for the whole page rather than one per card, the same shape the audit
      // trail uses for the names it has to resolve.
      const members = await new OrgMemberRepository(tx, context).list();
      const names = new Map(members.map((member) => [member.id, member.userId]));

      // Debt is part of the balance, and until it was read here it was invisible to every
      // screen: `wallet` answered credit alone, so an organisation $300 down showed whatever
      // credit it had left and never the figure ADR-0014 says a wallet holds.
      const debtCents = await new UsageDrawdownRepository(tx, context).debtCents();

      const purchasedCents = sum(grants, CreditKind.Purchased);
      const promotionalCents = sum(grants, CreditKind.Promotional);
      return {
        currency: settings.currency,
        balanceCents: purchasedCents + promotionalCents - debtCents,
        purchasedCents,
        promotionalCents,
        debtCents,
        grants: grants.map(present.grant),
        methods: methods.map((method) => present.method(method, names)),
        topUps: topUps.map(present.topUp),
        autoTopUp: present.autoTopUp(settings),
        spendAlert: present.spendAlert(settings),
        outstandingCents,
        provider: this.payments == null ? null : ProviderName.Stripe,
      };
    });
  }

  /**
   * Opens a charge and hands back the page to complete it on.
   *
   * The row is written before the provider is called, and that ordering is the point: a
   * crash between the two leaves a pending top-up somebody can reconcile, where the reverse
   * leaves a charge at the provider belonging to nobody.
   *
   * The card is not chosen here. A hosted checkout lets the cardholder pick, including one
   * they have not used before, which is why `payment_method_id` is null until the event
   * that completes it says what paid.
   */
  async startTopUp(
    context: OrgContext,
    amountCents: number,
    memberId: string,
  ): Promise<HostedCheckout> {
    const { provider, urls } = this.configured();
    const customerId = await this.customerOf(context);

    const reference = await this.uow.runForOrg(context, async (tx) => {
      const settings = await new BillingSettingsRepository(tx, context).current();
      const topUp = await new TopUpRepository(tx, context).start({
        amountCents,
        currency: settings.currency,
        trigger: TopUpTrigger.Manual,
        provider: ProviderName.Stripe,
        requestedBy: memberId,
      });
      return topUp.id;
    });

    const checkout = await provider.startCheckout({
      providerCustomerId: customerId,
      orgId: context.orgId,
      amountCents,
      currency: await this.currencyOf(context),
      reference,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    await this.uow.runForOrg(context, (tx) =>
      new TopUpRepository(tx, context).attach(
        reference,
        checkout.providerSessionId,
        TopUpState.Pending,
      ),
    );
    return { url: checkout.url, reference };
  }

  /**
   * A hosted page that saves a card without charging it.
   *
   * Separate from a top-up because the two are different asks: somebody putting a card on
   * file before there is anything to spend is setting up the automatic rule, and charging
   * them a dollar to do it would be a surprise on a screen about not having surprises.
   */
  async startCardSetup(context: OrgContext): Promise<HostedCheckout> {
    const { provider, urls } = this.configured();
    const customerId = await this.customerOf(context);
    const reference = `setup_${customerId}`;
    const checkout = await provider.startCardSetup({
      providerCustomerId: customerId,
      orgId: context.orgId,
      currency: await this.currencyOf(context),
      reference,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    return { url: checkout.url, reference };
  }

  /** Makes one card the default, in the one statement that cannot leave two or none. */
  async setDefaultMethod(context: OrgContext, publicId: string): Promise<void> {
    const id = PublicId.parse(IdPrefix.PaymentMethod, publicId).uuid;
    const changed = await this.uow.runForOrg(context, (tx) =>
      new PaymentMethodRepository(tx, context).setDefault(id),
    );
    if (!changed) throw new ResourceNotFoundError({ detail: { methodId: publicId } });
  }

  /**
   * Takes a card off, at the provider and here.
   *
   * The provider first. A card detached there and still listed here is a control that
   * fails when pressed; a card removed here and still attached there is a card we have
   * stopped showing and could still charge, which is worse.
   *
   * Removing the last card switches the automatic rule off with it, because a rule that
   * cannot fire is worse than one that is plainly off — it reports itself as protection
   * and then does not fire on the night the balance runs out.
   */
  async removeMethod(context: OrgContext, publicId: string): Promise<void> {
    const { provider } = this.configured();
    const id = PublicId.parse(IdPrefix.PaymentMethod, publicId).uuid;

    const method = await this.uow.runForOrg(context, async (tx) => {
      const methods = await new PaymentMethodRepository(tx, context).list();
      return methods.find((candidate) => candidate.id === id) ?? null;
    });
    if (method === null) throw new ResourceNotFoundError({ detail: { methodId: publicId } });

    await provider.removeCard(method.providerMethodId);
    await this.uow.runForOrg(context, async (tx) => {
      const methods = new PaymentMethodRepository(tx, context);
      await methods.remove(id);
      const left = await methods.list();
      const settings = new BillingSettingsRepository(tx, context);
      const current = await settings.current();
      if (left.length === 0 && current.autoTopUp.enabled) {
        await settings.setAutoTopUp({ ...current.autoTopUp, enabled: false }, null);
      } else if (current.autoTopUp.methodId === id) {
        await settings.setAutoTopUp({ ...current.autoTopUp, methodId: null }, null);
      }
    });
  }

  async setAutoTopUp(context: OrgContext, rule: AutoTopUp, memberId: string): Promise<void> {
    await this.uow.runForOrg(context, async (tx) => {
      if (rule.enabled) {
        const methods = await new PaymentMethodRepository(tx, context).list();
        if (methods.length === 0) {
          throw new PaymentMethodRequiredError();
        }
      }
      await new BillingSettingsRepository(tx, context).setAutoTopUp(
        {
          enabled: rule.enabled,
          thresholdCents: rule.thresholdCents,
          amountCents: rule.amountCents,
          methodId:
            rule.methodId === null
              ? null
              : PublicId.parse(IdPrefix.PaymentMethod, rule.methodId).uuid,
        },
        memberId,
      );
    });
  }

  async setSpendAlert(context: OrgContext, alert: SpendAlert, memberId: string): Promise<void> {
    await this.uow.runForOrg(context, (tx) =>
      new BillingSettingsRepository(tx, context).setSpendAlert(alert, memberId),
    );
  }

  async invoices(context: OrgContext): Promise<InvoiceList> {
    const rows = await this.uow.runForOrg(context, (tx) =>
      new InvoiceRepository(tx, context).list(),
    );
    return { invoices: rows.map(present.invoice) };
  }

  async invoice(context: OrgContext, publicId: string): Promise<InvoiceDetail> {
    const id = PublicId.parse(IdPrefix.Invoice, publicId).uuid;
    return await this.uow.runForOrg(context, async (tx) => {
      const repository = new InvoiceRepository(tx, context);
      const found = (await repository.list(200)).find((candidate) => candidate.id === id);
      if (found === undefined) {
        throw new ResourceNotFoundError({ detail: { invoiceId: publicId } });
      }
      const lines = await repository.linesOf(id);
      return { invoice: present.invoice(found), lines: lines.map(present.invoiceLine) };
    });
  }

  /**
   * The provider's customer for this organisation, created on first use.
   *
   * Claimed with `is null` in the predicate, so two requests arriving together cannot
   * leave an organisation with its cards on one customer and its charges on another. The
   * loser re-reads rather than trusting what it just created.
   */
  private async customerOf(context: OrgContext): Promise<string> {
    const { provider } = this.configured();
    const existing = await this.uow.runForOrg(context, (tx) =>
      new OrgBillingCustomerRepository(tx, context).current(),
    );
    if (existing === null) throw new ResourceNotFoundError({ detail: { orgId: context.orgId } });
    if (existing.billingCustomerId !== null) return existing.billingCustomerId;

    const customer = await provider.ensureCustomer(context.orgId, existing.name, null);
    const won = await this.uow.runForOrg(context, (tx) =>
      new OrgBillingCustomerRepository(tx, context).claim(customer.providerCustomerId),
    );
    if (won) return customer.providerCustomerId;

    const reread = await this.uow.runForOrg(context, (tx) =>
      new OrgBillingCustomerRepository(tx, context).current(),
    );
    return reread?.billingCustomerId ?? customer.providerCustomerId;
  }

  private async currencyOf(context: OrgContext): Promise<string> {
    const settings = await this.uow.runForOrg(context, (tx) =>
      new BillingSettingsRepository(tx, context).current(),
    );
    return settings.currency;
  }

  /**
   * Refuses rather than pretending, where nothing can take a card.
   *
   * A deployment with no provider is correct, so this is a 412 and not a 500: the caller
   * asked for something this installation does not do, and the wallet already told the
   * screen as much through `provider: null`.
   */
  private configured(): { provider: PaymentProvider; urls: CheckoutUrls } {
    if (this.payments == null || this.urls == null) {
      throw new PaymentsUnavailableError();
    }
    return { provider: this.payments, urls: this.urls };
  }
}

function sum(
  grants: readonly { kind: CreditKind; remainingCents: number }[],
  kind: CreditKind,
): number {
  return grants
    .filter((grant) => grant.kind === kind)
    .reduce((total, grant) => total + grant.remainingCents, 0);
}
