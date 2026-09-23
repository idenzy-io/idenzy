import { TopUpReversals } from "@idenzy/persistence/billing/top-up-reversals";
import { TopUpSettlement } from "@idenzy/persistence/billing/top-up-settlement";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { TopUpRepository } from "@idenzy/persistence/repository/top-up-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  AutoTopUpSuspension,
  CreditKind,
  DisputeStatus,
  PaymentProvider,
  RefundState,
  TopUpState,
  TopUpTrigger,
} from "@idenzy/protocol/enums/billing";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Money moving in and out of a wallet after it was paid for, against a real Postgres
 * (ADR-0014, ADR-0017).
 *
 * The properties worth asserting are the database's: a conditional update taking a row or
 * not, a row lock making the second of two deliveries wait and then find nothing, and check
 * constraints refusing a split that does not add up. So every "twice" below is either replayed
 * after the first committed, or genuinely concurrent — the second transaction started while
 * the first holds its locks — because `Promise.all` over one pool serialises and would pass
 * with every guard deleted.
 */

const harness = new PostgresHarness();
const ORG = "aaaa0000-0000-4000-8000-00000000000a";
const context = new OrgContext(ORG, "req_test", "system");
const NOW = new Date("2026-09-23T12:00:00Z");
let uow: UnitOfWork;
let sequence = 0;

/** Opens a top-up and points it at an intent, the way either path leaves one before settling. */
async function openTopUp(
  amountCents: number,
  trigger: TopUpTrigger = TopUpTrigger.Manual,
): Promise<{ id: string; intent: string }> {
  sequence += 1;
  const intent = `pi_test_${String(sequence)}`;
  const id = await uow.transaction(async (tx) => {
    const topUps = new TopUpRepository(tx, context);
    const row = await topUps.start({
      amountCents,
      currency: "USD",
      trigger,
      provider: PaymentProvider.Stripe,
      requestedBy: null,
    });
    await topUps.attach(row.id, intent, TopUpState.Pending);
    return row.id;
  });
  return { id, intent };
}

async function settle(intent: string, state: TopUpState, failureCode: string | null = null) {
  return await uow.transaction((tx) =>
    new TopUpSettlement(tx, context).settle({
      providerIntentId: intent,
      state,
      failureCode,
      at: NOW,
    }),
  );
}

async function paidTopUp(amountCents: number): Promise<{ id: string; intent: string }> {
  const topUp = await openTopUp(amountCents);
  await settle(topUp.intent, TopUpState.Succeeded);
  return topUp;
}

async function wallet(): Promise<{ credit: number; debt: number }> {
  return await uow.transaction(async (tx) => ({
    credit: await new CreditGrantRepository(tx, context).balanceCents(NOW),
    debt: await new UsageDrawdownRepository(tx, context).debtCents(),
  }));
}

async function owe(cents: number): Promise<void> {
  await uow.transaction((tx) => new UsageDrawdownRepository(tx, context).adjustDebt(cents));
}

async function enableRule(): Promise<void> {
  await uow.transaction((tx) =>
    new BillingSettingsRepository(tx, context).setAutoTopUp(
      { enabled: true, thresholdCents: 1000, amountCents: 5000, methodId: null },
      null,
    ),
  );
}

async function rule() {
  return await uow.transaction((tx) => new BillingSettingsRepository(tx, context).current());
}

function refund(intent: string, state: RefundState, id = "re_1", amountCents = 3000) {
  return uow.transaction((tx) =>
    new TopUpReversals(tx, context).refund({
      providerRefundId: id,
      providerIntentId: intent,
      amountCents,
      state,
      at: NOW,
    }),
  );
}

function dispute(
  intent: string,
  status: DisputeStatus,
  movement: "withdrawn" | "reinstated" | null,
  amountCents = 3000,
) {
  return uow.transaction((tx) =>
    new TopUpReversals(tx, context).dispute({
      providerDisputeId: "dp_1",
      providerIntentId: intent,
      amountCents,
      status,
      reason: "fraudulent",
      movement,
      at: NOW,
    }),
  );
}

/**
 * Runs `first` in a transaction that holds its locks for a moment after it has them, and starts
 * `second` only once it has them. The second genuinely waits on the first's row locks.
 */
async function contended<T>(
  first: (tx: Parameters<Parameters<UnitOfWork["transaction"]>[0]>[0]) => Promise<T>,
  second: () => Promise<T>,
): Promise<[T, T]> {
  let signal = (): void => {};
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const a = uow.transaction(async (tx) => {
    const result = await first(tx);
    signal();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return result;
  });
  await locked;
  const b = second();
  return [await a, await b];
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    "payment_refunds",
    "payment_disputes",
    "credit_grants",
    "top_ups",
    "org_debts",
    "billing_settings",
  ]) {
    await harness.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
  }
});

afterAll(async () => {
  await harness.stop();
});

describe("the ledger", () => {
  it("takes a debit from credit first and puts the rest on debt", async () => {
    await paidTopUp(2000);
    const debited = await uow.transaction((tx) => new WalletLedger(tx, context).debit(5000, NOW));
    expect(debited).toEqual({ fromCreditCents: 2000, toDebtCents: 3000 });
    expect(await wallet()).toEqual({ credit: 0, debt: 3000 });
  });

  it("settles debt before any of a credit becomes spendable", async () => {
    await owe(400);
    const credited = await uow.transaction((tx) =>
      new WalletLedger(tx, context).credit(500, { currency: "USD", topUpId: null, note: "x" }),
    );
    expect(credited).toEqual({ settledDebtCents: 400, grantedCents: 100 });
    expect(await wallet()).toEqual({ credit: 100, debt: 0 });
  });

  /**
   * Two payments landing at once against one debt. Without the lock both read $300 owed, both
   * clear it, `greatest(0, …)` floors the second, and the customer is granted $300 less than
   * they paid.
   */
  it("gives two concurrent credits one debt to share, not one each", async () => {
    await owe(300);
    const source = { currency: "USD", topUpId: null, note: "x" };
    const [first, second] = await contended(
      (tx) => new WalletLedger(tx, context).credit(1000, source),
      () => uow.transaction((tx) => new WalletLedger(tx, context).credit(1000, source)),
    );
    expect(first.settledDebtCents + second.settledDebtCents).toBe(300);
    expect(await wallet()).toEqual({ credit: 1700, debt: 0 });
  });
});

describe("settling a top-up", () => {
  it("grants the credit once however many times it is settled", async () => {
    const topUp = await openTopUp(5000);
    expect(await settle(topUp.intent, TopUpState.Succeeded)).not.toBeNull();
    expect(await settle(topUp.intent, TopUpState.Succeeded)).toBeNull();
    expect((await wallet()).credit).toBe(5000);
  });

  it("grants once when the webhook and the worker settle at the same moment", async () => {
    const topUp = await openTopUp(5000);
    const [first, second] = await contended(
      (tx) =>
        new TopUpSettlement(tx, context).settle({
          providerIntentId: topUp.intent,
          state: TopUpState.Succeeded,
          failureCode: null,
          at: NOW,
        }),
      () => settle(topUp.intent, TopUpState.Succeeded),
    );
    expect([first, second].filter((settled) => settled !== null)).toHaveLength(1);
    expect((await wallet()).credit).toBe(5000);
  });

  it("does not grant on a later success for a charge already settled as failed", async () => {
    const topUp = await openTopUp(5000);
    await settle(topUp.intent, TopUpState.Failed, "card_declined");
    expect(await settle(topUp.intent, TopUpState.Succeeded)).toBeNull();
    expect((await wallet()).credit).toBe(0);
  });

  it("records how much of a top-up went on debt", async () => {
    await owe(300);
    const topUp = await openTopUp(1000);
    const settled = await settle(topUp.intent, TopUpState.Succeeded);
    expect(settled?.credited).toEqual({ settledDebtCents: 300, grantedCents: 700 });
    const { rows } = await harness.owner.query<{ settled_debt_cents: string }>(
      `SELECT settled_debt_cents FROM top_ups WHERE id = $1`,
      [topUp.id],
    );
    expect(Number(rows[0]?.settled_debt_cents)).toBe(300);
  });
});

describe("the automatic rule's bookkeeping", () => {
  it("counts consecutive failures and resets on a success", async () => {
    await enableRule();
    await settle((await openTopUp(5000, TopUpTrigger.Automatic)).intent, TopUpState.Failed);
    expect((await rule()).autoTopUpState.failures).toBe(1);
    await settle((await openTopUp(5000, TopUpTrigger.Automatic)).intent, TopUpState.Succeeded);
    expect((await rule()).autoTopUpState.failures).toBe(0);
  });

  it("suspends at once when the bank wants the cardholder present", async () => {
    await enableRule();
    const topUp = await openTopUp(5000, TopUpTrigger.Automatic);
    const settled = await settle(topUp.intent, TopUpState.RequiresAction);
    expect(settled?.suspended).toBe(AutoTopUpSuspension.AuthenticationRequired);
    expect((await rule()).autoTopUpState.suspendedReason).toBe(
      AutoTopUpSuspension.AuthenticationRequired,
    );
  });

  it("suspends on the third decline in a row", async () => {
    await enableRule();
    for (let n = 0; n < 2; n += 1) {
      const topUp = await openTopUp(5000, TopUpTrigger.Automatic);
      expect(
        (await settle(topUp.intent, TopUpState.Failed, "card_declined"))?.suspended,
      ).toBeNull();
    }
    const third = await openTopUp(5000, TopUpTrigger.Automatic);
    expect((await settle(third.intent, TopUpState.Failed, "card_declined"))?.suspended).toBe(
      AutoTopUpSuspension.RepeatedFailure,
    );
  });

  it("leaves the rule alone on a manual top-up that failed", async () => {
    await enableRule();
    await settle((await openTopUp(5000)).intent, TopUpState.Failed);
    expect((await rule()).autoTopUpState.failures).toBe(0);
  });

  /** The storage guarantee beneath the worker's lock: never two open automatic charges. */
  it("refuses a second open automatic charge at the index", async () => {
    await openTopUp(5000, TopUpTrigger.Automatic);
    await expect(openTopUp(5000, TopUpTrigger.Automatic)).rejects.toThrow();
  });

  it("clears a suspension when a person saves the rule, and not otherwise", async () => {
    await enableRule();
    await settle((await openTopUp(5000, TopUpTrigger.Automatic)).intent, TopUpState.RequiresAction);
    const current = (await rule()).autoTopUp;
    await uow.transaction((tx) =>
      new BillingSettingsRepository(tx, context).setAutoTopUp(current, null, {
        clearSuspension: false,
      }),
    );
    expect((await rule()).autoTopUpState.suspendedReason).not.toBeNull();
    await enableRule();
    expect((await rule()).autoTopUpState).toMatchObject({ suspendedReason: null, failures: 0 });
  });
});

describe("a refund", () => {
  it("takes back the credit it bought, once, whatever arrives", async () => {
    const topUp = await paidTopUp(5000);
    await refund(topUp.intent, RefundState.Pending);
    await refund(topUp.intent, RefundState.Pending);
    await refund(topUp.intent, RefundState.Succeeded);
    expect(await wallet()).toEqual({ credit: 2000, debt: 0 });
  });

  it("takes it once when two deliveries arrive together", async () => {
    const topUp = await paidTopUp(5000);
    await contended(
      (tx) =>
        new TopUpReversals(tx, context).refund({
          providerRefundId: "re_1",
          providerIntentId: topUp.intent,
          amountCents: 3000,
          state: RefundState.Succeeded,
          at: NOW,
        }),
      () => refund(topUp.intent, RefundState.Succeeded),
    );
    expect(await wallet()).toEqual({ credit: 2000, debt: 0 });
  });

  it("takes from its own purchase before anything bought separately", async () => {
    const other = await paidTopUp(10_000);
    const refunded = await paidTopUp(5000);
    await refund(refunded.intent, RefundState.Succeeded);
    const { rows } = await harness.owner.query<{ top_up_id: string; remaining_cents: string }>(
      `SELECT top_up_id, remaining_cents FROM credit_grants WHERE org_id = $1`,
      [ORG],
    );
    const remaining = new Map(rows.map((row) => [row.top_up_id, Number(row.remaining_cents)]));
    expect(remaining.get(refunded.id)).toBe(2000);
    expect(remaining.get(other.id)).toBe(10_000);
  });

  it("turns what was already spent into debt", async () => {
    const topUp = await paidTopUp(5000);
    await uow.transaction((tx) => new WalletLedger(tx, context).debit(4000, NOW));
    await refund(topUp.intent, RefundState.Succeeded, "re_1", 5000);
    expect(await wallet()).toEqual({ credit: 0, debt: 4000 });
  });

  it("gives the credit back, once, when the refund fails", async () => {
    const topUp = await paidTopUp(5000);
    await refund(topUp.intent, RefundState.Pending);
    await refund(topUp.intent, RefundState.Failed);
    await refund(topUp.intent, RefundState.Failed);
    expect(await wallet()).toEqual({ credit: 5000, debt: 0 });
  });

  it("never takes anything for a refund first heard of as failed, even if a stale pending follows", async () => {
    const topUp = await paidTopUp(5000);
    await refund(topUp.intent, RefundState.Failed);
    await refund(topUp.intent, RefundState.Pending);
    expect(await wallet()).toEqual({ credit: 5000, debt: 0 });
  });

  it("counts two partial refunds separately", async () => {
    const topUp = await paidTopUp(5000);
    await refund(topUp.intent, RefundState.Succeeded, "re_1", 1000);
    await refund(topUp.intent, RefundState.Succeeded, "re_2", 1500);
    expect((await wallet()).credit).toBe(2500);
  });

  it("ignores a refund of a charge that never bought anything", async () => {
    const topUp = await openTopUp(5000);
    await settle(topUp.intent, TopUpState.Failed);
    expect(await refund(topUp.intent, RefundState.Succeeded)).toBeNull();
    expect(await refund("pi_not_ours", RefundState.Succeeded)).toBeNull();
  });
});

describe("a dispute", () => {
  it("suspends the automatic rule the first time it is heard of", async () => {
    await enableRule();
    const topUp = await paidTopUp(5000);
    const first = await dispute(topUp.intent, DisputeStatus.NeedsResponse, null);
    expect(first?.suspended).toBe(AutoTopUpSuspension.Dispute);
    expect((await rule()).autoTopUpState.suspendedReason).toBe(AutoTopUpSuspension.Dispute);
    expect((await wallet()).credit).toBe(5000);
  });

  it("takes the credit when the funds are withdrawn, once", async () => {
    const topUp = await paidTopUp(5000);
    await dispute(topUp.intent, DisputeStatus.NeedsResponse, "withdrawn");
    await dispute(topUp.intent, DisputeStatus.NeedsResponse, "withdrawn");
    await dispute(topUp.intent, DisputeStatus.UnderReview, null);
    expect(await wallet()).toEqual({ credit: 2000, debt: 0 });
  });

  it("gives it back when the funds are reinstated, once, however the win is reported", async () => {
    const topUp = await paidTopUp(5000);
    await dispute(topUp.intent, DisputeStatus.NeedsResponse, "withdrawn");
    await dispute(topUp.intent, DisputeStatus.Won, "reinstated");
    await dispute(topUp.intent, DisputeStatus.Won, null);
    expect(await wallet()).toEqual({ credit: 5000, debt: 0 });
  });

  it("keeps the funds gone when it is lost, even if the withdrawal was never reported", async () => {
    const topUp = await paidTopUp(5000);
    await dispute(topUp.intent, DisputeStatus.Lost, null, 5000);
    await dispute(topUp.intent, DisputeStatus.Lost, null, 5000);
    expect(await wallet()).toEqual({ credit: 0, debt: 0 });
  });

  it("gives nothing away for an inquiry that closed without taking any money", async () => {
    const topUp = await paidTopUp(5000);
    await dispute(topUp.intent, DisputeStatus.WarningNeedsResponse, null);
    await dispute(topUp.intent, DisputeStatus.Won, null);
    expect(await wallet()).toEqual({ credit: 5000, debt: 0 });
  });

  it("settles the debt a lost dispute left when the customer next pays", async () => {
    const topUp = await paidTopUp(5000);
    await uow.transaction((tx) => new WalletLedger(tx, context).debit(5000, NOW));
    await dispute(topUp.intent, DisputeStatus.NeedsResponse, "withdrawn", 5000);
    expect(await wallet()).toEqual({ credit: 0, debt: 5000 });
    await paidTopUp(6000);
    expect(await wallet()).toEqual({ credit: 1000, debt: 0 });
  });
});

describe("the wallet's own check constraints", () => {
  it("refuses a refund whose split does not add up", async () => {
    const topUp = await paidTopUp(5000);
    await refund(topUp.intent, RefundState.Succeeded);
    await expect(
      harness.owner.query(
        `UPDATE payment_refunds SET reversed_from_credit_cents = 1 WHERE org_id = $1`,
        [ORG],
      ),
    ).rejects.toThrow(/payment_refunds_reversal_ck/);
  });

  it("keeps purchased credit purchased", async () => {
    await paidTopUp(5000);
    const { rows } = await harness.owner.query<{ kind: string }>(
      `SELECT kind FROM credit_grants WHERE org_id = $1`,
      [ORG],
    );
    expect(rows.map((row) => row.kind)).toEqual([CreditKind.Purchased]);
  });
});
