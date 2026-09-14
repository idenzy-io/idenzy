import { SystemClock } from "@idenzy/core/time/clock";
import type {
  BillingCustomer,
  ChargeOutcome,
  CheckoutRequest,
  HostedCheckout,
  OffSessionCharge,
  ProviderCard,
  ProviderEvent,
} from "@idenzy/domain/ports/payment-provider";
import { PaymentProvider } from "@idenzy/domain/ports/payment-provider";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { PaymentProviderEventRepository } from "@idenzy/persistence/repository/payment-provider-event-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { CardBrand, TopUpState } from "@idenzy/protocol/enums/billing";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { BillingService } from "../dist/billing/billing-service.js";
import { PaymentWebhookService } from "../dist/billing/payment-webhook-service.js";
import { SilentLogger } from "./fixtures.js";

/**
 * Taking money, against a real Postgres.
 *
 * The provider is a fake and the database is not, which is the right way round: what is
 * worth testing here is not that Stripe answers — a smoke test against the real API does
 * that — but that being told the same thing twice grants credit once. Every guard that
 * makes it true is in the database: a unique index on the provider's event id, a unique
 * index on the intent id, and `settled_at is null` inside the update that settles. A fake
 * database would agree with whatever this code believed.
 */

const harness = new PostgresHarness();
const ORG = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ORG = "cccccccc-0000-4000-8000-000000000002";
const MEMBER = "dddddddd-0000-4000-8000-000000000003";
const USER = "eeeeeeee-0000-4000-8000-000000000004";

let uow: UnitOfWork;
let billing: BillingService;
let webhooks: PaymentWebhookService;
let events: PaymentProviderEventRepository;

const context = new OrgContext(ORG, "req_billing", "customer_staff", MEMBER);
/* The guard resolves a membership to its uuid and hands services that, not the public
   form: `actorMemberId` reads `org_members.id` straight off the principal. A public id
   here would be written into a uuid column. */
const actingMember = MEMBER;

/** Answers like a provider and records what it was asked, so an ordering can be asserted. */
class FakeProvider extends PaymentProvider {
  override readonly id = "stripe";
  readonly detached: string[] = [];
  cards: ProviderCard[] = [];

  override ensureCustomer(orgId: string): Promise<BillingCustomer> {
    return Promise.resolve({ providerCustomerId: `cus_${orgId.slice(0, 8)}` });
  }
  override startCheckout(request: CheckoutRequest): Promise<HostedCheckout> {
    return Promise.resolve({
      providerSessionId: `cs_${request.reference.slice(0, 8)}`,
      url: "https://checkout.test/pay",
    });
  }
  override startCardSetup(request: CheckoutRequest): Promise<HostedCheckout> {
    return Promise.resolve({
      providerSessionId: `cs_setup_${request.orgId.slice(0, 8)}`,
      url: "https://checkout.test/save",
    });
  }
  override listCards(): Promise<readonly ProviderCard[]> {
    return Promise.resolve(this.cards);
  }
  override removeCard(providerMethodId: string): Promise<void> {
    this.detached.push(providerMethodId);
    this.cards = this.cards.filter((card) => card.providerMethodId !== providerMethodId);
    return Promise.resolve();
  }
  override chargeOffSession(_charge: OffSessionCharge): Promise<ChargeOutcome> {
    return Promise.resolve({
      providerIntentId: "pi_auto",
      state: TopUpState.Succeeded,
      failureCode: null,
      card: null,
    });
  }
  override readEvent(rawBody: string): ProviderEvent {
    // The fake does no signature check; what it must not do is invent the stamps, since
    // the whole point of them is that they came back from the provider unchanged.
    return JSON.parse(rawBody) as ProviderEvent;
  }
}

const provider = new FakeProvider();

function event(
  type: string,
  payload: Record<string, unknown>,
  overrides: Partial<ProviderEvent> = {},
): string {
  return JSON.stringify({
    id: `evt_${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    orgId: ORG,
    reference: null,
    ...overrides,
  });
}

async function balance(): Promise<number> {
  return await uow.runForOrg(context, (tx) =>
    new CreditGrantRepository(tx, context).balanceCents(new Date()),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  events = new PaymentProviderEventRepository(harness.db);
  const clock = new SystemClock();
  const urls = { successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no" };
  billing = new BillingService(uow, clock, provider, urls);
  webhooks = new PaymentWebhookService(uow, events, clock, new SilentLogger(), provider);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  for (const org of [ORG, OTHER_ORG]) {
    await harness.owner.query(
      `INSERT INTO orgs (id, name, cell_id)
       VALUES ($1, 'Acme', (SELECT id FROM region_cells LIMIT 1))`,
      [org],
    );
  }
  await harness.owner.query(`SELECT set_config('app.org_id', $1, false)`, [ORG]);
  await harness.owner.query(
    `INSERT INTO org_members (id, org_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
    [MEMBER, ORG, USER],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the wallet a screen reads", () => {
  it("starts empty, in the organisation's currency, and names its provider", async () => {
    const wallet = await billing.wallet(context);
    expect(wallet.balanceCents).toBe(0);
    expect(wallet.currency).toBe("USD");
    expect(wallet.provider).toBe("stripe");
    expect(wallet.methods).toHaveLength(0);
  });

  /** A deployment with no keys is correct, and the screen is built to say so. */
  it("answers a null provider where nothing can take a card", async () => {
    const unpaid = new BillingService(uow, new SystemClock(), null, null);
    expect((await unpaid.wallet(context)).provider).toBeNull();
    await expect(unpaid.startTopUp(context, 2500, actingMember)).rejects.toMatchObject({
      code: "payments_unavailable",
    });
  });
});

describe("adding credit", () => {
  it("records the charge before calling the provider, and hands back a page", async () => {
    const checkout = await billing.startTopUp(context, 2500, actingMember);
    expect(checkout.url).toBe("https://checkout.test/pay");

    const wallet = await billing.wallet(context);
    const opened = wallet.topUps.find((topUp) => topUp.amountCents === 2500);
    // Pending, with no card on it: the cardholder has not picked one yet, and inventing
    // one here is what the nullable columns exist to avoid.
    expect(opened?.state).toBe("pending");
    expect(opened?.cardLast4).toBeNull();
    expect(wallet.balanceCents).toBe(0);
  });

  /**
   * The guarantee the whole webhook path exists for. A provider delivers at least once by
   * design, so being told twice has to be free — and "free" means the balance, not just
   * the row.
   */
  it("grants the credit once, however many times it is told", async () => {
    const checkout = await billing.startTopUp(context, 5000, actingMember);
    const before = await balance();

    const completed = event(
      "checkout.session.completed",
      {
        mode: "payment",
        payment_intent: "pi_five_thousand",
        client_reference_id: checkout.reference,
      },
      { reference: checkout.reference },
    );
    await webhooks.receive(completed, "sig", "req_1");
    expect(await balance()).toBe(before + 5000);

    // The same delivery again, byte for byte. The event id is the same, so it never
    // reaches a handler.
    await webhooks.receive(completed, "sig", "req_2");
    expect(await balance()).toBe(before + 5000);

    // And a different event about the same intent, which is what a provider actually
    // sends: the settle is what refuses this one, not the event table.
    await webhooks.receive(
      event("payment_intent.succeeded", { id: "pi_five_thousand" }),
      "sig",
      "req_3",
    );
    expect(await balance()).toBe(before + 5000);
  });

  it("settles a refusal without granting anything", async () => {
    const checkout = await billing.startTopUp(context, 7500, actingMember);
    const before = await balance();
    await webhooks.receive(
      event(
        "checkout.session.completed",
        { mode: "payment", payment_intent: "pi_refused", client_reference_id: checkout.reference },
        { reference: checkout.reference },
      ),
      "sig",
      "req_4",
    );
    // The completion granted it; a later failure on the same intent must not take it back
    // by accident, and must not double it either.
    const granted = await balance();
    expect(granted).toBe(before + 7500);

    await webhooks.receive(
      event("payment_intent.payment_failed", {
        id: "pi_refused",
        last_payment_error: { code: "card_declined" },
      }),
      "sig",
      "req_5",
    );
    expect(await balance()).toBe(granted);
  });

  /**
   * An event we did not stamp is not ours to act on. It is still recorded, because the
   * record is what makes a redelivery cheap, but nothing is charged to a guess.
   */
  it("ignores an event carrying no organisation", async () => {
    const before = await balance();
    await webhooks.receive(
      event("payment_intent.succeeded", { id: "pi_orphan" }, { orgId: null }),
      "sig",
      "req_6",
    );
    expect(await balance()).toBe(before);
  });

  /** Anything outside the catalogue is stored, acknowledged and left alone. */
  it("acknowledges an event it does not handle", async () => {
    await expect(
      webhooks.receive(event("customer.updated", { id: "cus_x" }), "sig", "req_7"),
    ).resolves.toBeUndefined();
  });
});

describe("cards on file", () => {
  it("takes the provider's list as the record, and drops what is gone from it", async () => {
    provider.cards = [
      {
        providerMethodId: "pm_visa",
        brand: CardBrand.Visa,
        last4: "4242",
        expiryMonth: 12,
        expiryYear: 2030,
      },
    ];
    await webhooks.receive(event("checkout.session.completed", { mode: "setup" }), "sig", "req_8");
    const saved = await billing.wallet(context);
    expect(saved.methods).toHaveLength(1);
    expect(saved.methods[0]?.last4).toBe("4242");
    // Nobody here typed it: it was added on the provider's page, so no member is named.
    expect(saved.methods[0]?.addedBy).toBeNull();

    provider.cards = [];
    await webhooks.receive(event("checkout.session.completed", { mode: "setup" }), "sig", "req_9");
    expect((await billing.wallet(context)).methods).toHaveLength(0);
  });

  /**
   * A rule that cannot fire is worse than one that is plainly off: it reports itself as
   * protection and then does nothing on the night the balance runs out.
   */
  it("refuses an automatic rule with no card, and switches one off with the last card", async () => {
    await expect(
      billing.setAutoTopUp(
        context,
        { enabled: true, thresholdCents: 1000, amountCents: 5000, methodId: null },
        actingMember,
      ),
    ).rejects.toMatchObject({ code: "payment_method_required" });

    provider.cards = [
      {
        providerMethodId: "pm_later",
        brand: CardBrand.Visa,
        last4: "1881",
        expiryMonth: 1,
        expiryYear: 2031,
      },
    ];
    await webhooks.receive(event("checkout.session.completed", { mode: "setup" }), "sig", "req_10");
    await billing.setAutoTopUp(
      context,
      { enabled: true, thresholdCents: 1000, amountCents: 5000, methodId: null },
      actingMember,
    );
    expect((await billing.wallet(context)).autoTopUp.enabled).toBe(true);

    const card = (await billing.wallet(context)).methods[0];
    expect(card).toBeDefined();
    await billing.removeMethod(context, card?.id ?? "");

    const after = await billing.wallet(context);
    expect(after.methods).toHaveLength(0);
    expect(after.autoTopUp.enabled).toBe(false);
    // The provider first: a card detached here and still attached there is one we have
    // stopped showing and could still charge.
    expect(provider.detached).toContain("pm_later");
  });
});
