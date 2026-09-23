import { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { DueSet } from "@idenzy/cache/due-set";
import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { SpacingGate } from "@idenzy/cache/spacing-gate";
import {
  AUTO_TOP_UP_DUE_KEY,
  DRAWDOWN_DUE_KEY,
  ValkeyBillingSignals,
} from "@idenzy/cache/valkey-billing-signals";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { AUTO_TOP_UP_MIN_SPACING_MS } from "@idenzy/domain/policies/auto-top-up-policy";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { OrgUsageActivityReader } from "@idenzy/persistence/repository/org-usage-activity-reader";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AutoTopUpSuspension, TopUpState } from "@idenzy/protocol/enums/billing";
import { FakePaymentProvider } from "@idenzy/testing/fake-payment-provider";
import { FakeClock, RecordingLogger } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AutoTopUpRunner } from "../src/billing/auto-top-up-runner.js";
import { AutoTopUpSweeper } from "../src/billing/auto-top-up-sweeper.js";
import { BillingSignalConsumer } from "../src/billing/billing-signal-consumer.js";
import { LiveBalance } from "../src/billing/live-balance.js";
import { UsageDrawdown } from "../src/usage-drawdown.js";

/**
 * The automatic top-up against a real Postgres and a real Valkey, with a provider that honours
 * idempotency keys the way Stripe does (ADR-0017).
 *
 * The assertion that matters most in this file is `provider.charges.size` — money that would
 * really have left a card — and not how many times anything was called. The rule is allowed to
 * ask as often as it likes; it is not allowed to charge twice.
 */
const pg = new PostgresHarness();
const cache = new ValkeyHarness();
const ORG = "aaaa0000-0000-4000-8000-0000000000b1";
const PROJECT = "cccc0000-0000-4000-8000-0000000000b2";
const METHOD = "dddd0000-0000-4000-8000-0000000000b3";
const context = new OrgContext(ORG, "req_test", "system");

let uow: UnitOfWork;
let valkey: ValkeyClient;
let clock: FakeClock;
let provider: FakePaymentProvider;
let drawdownDue: DueSet;
let autoTopUpDue: DueSet;
let rules: AutoTopUpRuleCache;
let signals: ValkeyBillingSignals;

function runner(): AutoTopUpRunner {
  return new AutoTopUpRunner(
    uow,
    provider,
    rules,
    signals,
    new BillingWorkReader(pg.db),
    clock,
    new RecordingLogger(),
  );
}

function liveBalance(): LiveBalance {
  return new LiveBalance(uow, new LiveUsageSketches(valkey), new LiveBalanceCache(valkey), clock);
}

function later(ms: number): void {
  clock.set(new Date(clock.now().getTime() + ms));
}

async function enableRule(thresholdCents = 1000, amountCents = 5000): Promise<void> {
  await uow.transaction((tx) =>
    new BillingSettingsRepository(tx, context).setAutoTopUp(
      { enabled: true, thresholdCents, amountCents, methodId: null },
      null,
    ),
  );
}

async function spend(cents: number): Promise<void> {
  await uow.transaction((tx) => new WalletLedger(tx, context).debit(cents, clock.now()));
}

async function balance(): Promise<number> {
  return await uow.transaction((tx) => new WalletLedger(tx, context).balanceCents(clock.now()));
}

async function topUps(): Promise<{ state: string; settled: boolean }[]> {
  const { rows } = await pg.owner.query<{ state: string; settled_at: Date | null }>(
    `SELECT state, settled_at FROM top_ups WHERE org_id = $1 ORDER BY created_at`,
    [ORG],
  );
  return rows.map((row) => ({ state: row.state, settled: row.settled_at !== null }));
}

async function ruleState() {
  return (await uow.transaction((tx) => new BillingSettingsRepository(tx, context).current()))
    .autoTopUpState;
}

beforeAll(async () => {
  await Promise.all([pg.start(), cache.start()]);
  uow = new UnitOfWork(pg.db);
  valkey = createValkeyClient({ url: cache.url, onError: () => {} });
  if (valkey.status !== "ready") {
    await new Promise<void>((resolve) => valkey.once("ready", () => resolve()));
  }
  await pg.owner.query(
    `INSERT INTO orgs (id, name, billing_customer_id) VALUES ($1, 'Acme', 'cus_acme')`,
    [ORG],
  );
  await pg.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
    [PROJECT, ORG],
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    "payment_refunds",
    "payment_disputes",
    "credit_grants",
    "top_ups",
    "org_debts",
    "billing_settings",
    "payment_methods",
    "usage_charges",
    "usage_billing_state",
  ]) {
    await pg.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
  }
  await pg.owner.query(`DELETE FROM usage_daily WHERE project_id = $1`, [PROJECT]);
  await pg.owner.query(
    `INSERT INTO payment_methods (id, org_id, provider, provider_method_id, brand, last4,
                                  expiry_month, expiry_year, is_default)
     VALUES ($1, $2, 'stripe', 'pm_card', 'visa', '4242', 12, 2030, true)`,
    [METHOD, ORG],
  );
  await valkey.flushall();
  clock = new FakeClock(new Date("2026-09-15T12:00:00Z"));
  provider = new FakePaymentProvider();
  drawdownDue = new DueSet(valkey, DRAWDOWN_DUE_KEY);
  autoTopUpDue = new DueSet(valkey, AUTO_TOP_UP_DUE_KEY);
  rules = new AutoTopUpRuleCache(valkey);
  signals = new ValkeyBillingSignals(drawdownDue, autoTopUpDue, rules, clock, () => {});
});

afterAll(async () => {
  valkey.disconnect();
  await Promise.all([pg.stop(), cache.stop()]);
});

describe("firing", () => {
  it("charges the saved card once when the balance is under the threshold", async () => {
    await enableRule();
    const result = await runner().evaluate(ORG, true);
    expect(result).toMatchObject({ kind: "charged", state: TopUpState.Succeeded });
    expect(provider.charges.size).toBe(1);
    expect([...provider.charges.values()][0]).toMatchObject({
      providerMethodId: "pm_card",
      providerCustomerId: "cus_acme",
      amountCents: 5000,
    });
    expect(await balance()).toBe(5000);
  });

  it("settles debt first, like any other payment", async () => {
    await enableRule();
    await spend(3000);
    await runner().evaluate(ORG, true);
    expect(await balance()).toBe(2000);
  });

  it("does nothing above the threshold, when off, or with no card", async () => {
    await enableRule(1000, 5000);
    await uow.transaction((tx) =>
      new CreditGrantRepository(tx, context).grant({
        kind: "purchased",
        amountCents: 2000,
        currency: "USD",
        topUpId: null,
        note: "x",
        expiresAt: null,
      }),
    );
    expect((await runner().evaluate(ORG, true)).kind).toBe("skipped");

    await pg.owner.query(`DELETE FROM credit_grants WHERE org_id = $1`, [ORG]);
    await pg.owner.query(
      `UPDATE billing_settings SET auto_top_up_enabled = false WHERE org_id = $1`,
      [ORG],
    );
    expect((await runner().evaluate(ORG, false)).kind).toBe("skipped");
    expect(provider.charges.size).toBe(0);
  });

  it("suspends rather than looping when there is no card to charge", async () => {
    await enableRule();
    await pg.owner.query(`DELETE FROM payment_methods WHERE org_id = $1`, [ORG]);
    expect(await runner().evaluate(ORG, true)).toEqual({
      kind: "suspended",
      reason: AutoTopUpSuspension.NoPaymentMethod,
    });
    expect(provider.requests).toHaveLength(0);
  });
});

describe("never twice", () => {
  /**
   * Ten looks at once, across what would be ten workers. The settings row lock makes them
   * queue; the first opens a charge and the rest see it — open or settled — and stand down.
   */
  it("charges once when many workers look at the same moment", async () => {
    await enableRule();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runner().evaluate(ORG, false)),
    );
    expect(results.filter((result) => result.kind === "charged")).toHaveLength(1);
    expect(provider.charges.size).toBe(1);
    expect(await topUps()).toHaveLength(1);
  });

  it("does not charge again while a charge nobody heard back from is open", async () => {
    await enableRule();
    provider.next({ kind: "throw", chargedAnyway: true });
    expect((await runner().evaluate(ORG, true)).kind).toBe("unresolved");
    later(AUTO_TOP_UP_MIN_SPACING_MS * 4);
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "in_flight" });
    expect(provider.charges.size).toBe(1);
  });

  /**
   * The crash the design is built around: the card was charged, the answer was lost. The
   * reconciler asks again under the same key, Stripe hands back the first charge, and the
   * credit is granted once for the one charge.
   */
  it("recovers a charge whose answer was lost without charging again", async () => {
    await enableRule();
    provider.next({ kind: "throw", chargedAnyway: true });
    await runner().evaluate(ORG, true);
    expect(await balance()).toBe(0);

    later(3 * 60 * 1000);
    expect(await runner().reconcile()).toBe(1);
    expect(provider.requests).toHaveLength(2);
    expect(new Set(provider.requests.map((request) => request.idempotencyKey)).size).toBe(1);
    expect(provider.charges.size).toBe(1);
    expect(await balance()).toBe(5000);
    expect(await topUps()).toEqual([{ state: TopUpState.Succeeded, settled: true }]);
  });

  it("makes the charge on recovery when the lost request never reached the provider", async () => {
    await enableRule();
    provider.next({ kind: "throw", chargedAnyway: false });
    await runner().evaluate(ORG, true);
    later(3 * 60 * 1000);
    await runner().reconcile();
    expect(provider.charges.size).toBe(1);
    expect(await balance()).toBe(5000);
  });

  it("finds a day-old charge by its reference once the key has expired", async () => {
    await enableRule();
    provider.next({ kind: "throw", chargedAnyway: true });
    await runner().evaluate(ORG, true);
    later(25 * 60 * 60 * 1000);
    await runner().reconcile();
    expect(provider.requests).toHaveLength(1);
    expect(await balance()).toBe(5000);
  });

  it("closes a day-old charge the provider never saw, so the rule can fire again", async () => {
    await enableRule();
    provider.next({ kind: "throw", chargedAnyway: false });
    await runner().evaluate(ORG, true);
    later(25 * 60 * 60 * 1000);
    // Past the window a replay would be a new charge, so the reconciler must not make one.
    await runner().reconcile();
    expect(provider.requests).toHaveLength(1);
    expect(await topUps()).toEqual([{ state: TopUpState.Cancelled, settled: true }]);
    expect((await runner().evaluate(ORG, true)).kind).toBe("charged");
  });

  it("leaves a pending charge open and settles it when the provider moves it on", async () => {
    await enableRule();
    provider.next({ kind: "answer", state: TopUpState.Pending });
    const result = await runner().evaluate(ORG, true);
    expect(result).toMatchObject({ kind: "charged", state: TopUpState.Pending });
    expect(await balance()).toBe(0);

    const intent = [...provider.requests][0];
    expect(intent).toBeDefined();
    provider.resolve("pi_fake_1", TopUpState.Succeeded);
    later(3 * 60 * 1000);
    await runner().reconcile();
    expect(await balance()).toBe(5000);
  });
});

describe("the daily limit", () => {
  it("allows three automatic charges in a rolling day and not a fourth", async () => {
    await enableRule();
    for (let n = 0; n < 3; n += 1) {
      expect((await runner().evaluate(ORG, true)).kind).toBe("charged");
      await spend(5000);
      later(AUTO_TOP_UP_MIN_SPACING_MS);
    }
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "daily_limit" });
    expect(provider.charges.size).toBe(3);

    later(24 * 60 * 60 * 1000);
    expect((await runner().evaluate(ORG, true)).kind).toBe("charged");
  });

  it("counts declines against the limit", async () => {
    await enableRule();
    await pg.owner.query(
      `UPDATE billing_settings SET auto_top_up_daily_limit = 1 WHERE org_id = $1`,
      [ORG],
    );
    provider.next({ kind: "answer", state: TopUpState.Failed, failureCode: "card_declined" });
    await runner().evaluate(ORG, true);
    later(2 * 60 * 60 * 1000);
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "daily_limit" });
  });

  it("spaces two successful charges out", async () => {
    await enableRule();
    await runner().evaluate(ORG, true);
    await spend(5000);
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "spacing" });
  });
});

describe("when a charge fails", () => {
  it("backs off after a decline and stops after the third", async () => {
    await enableRule();
    provider.next(
      { kind: "answer", state: TopUpState.Failed, failureCode: "card_declined" },
      { kind: "answer", state: TopUpState.Failed, failureCode: "card_declined" },
      { kind: "answer", state: TopUpState.Failed, failureCode: "card_declined" },
    );
    await runner().evaluate(ORG, true);
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "backing_off" });

    later(60 * 60 * 1000);
    await runner().evaluate(ORG, true);
    later(2 * 60 * 60 * 1000);
    await runner().evaluate(ORG, true);

    expect((await ruleState()).suspendedReason).toBe(AutoTopUpSuspension.RepeatedFailure);
    later(24 * 60 * 60 * 1000);
    expect(await runner().evaluate(ORG, false)).toEqual({ kind: "skipped", reason: "suspended" });
    expect(provider.requests).toHaveLength(3);
  });

  it("stops at once when the bank wants the cardholder, and drops the cached rule", async () => {
    await enableRule();
    await rules.put(ORG, { armed: true, thresholdCents: 1000 });
    provider.next({
      kind: "answer",
      state: TopUpState.RequiresAction,
      failureCode: "authentication_required",
    });
    await runner().evaluate(ORG, true);
    expect((await ruleState()).suspendedReason).toBe(AutoTopUpSuspension.AuthenticationRequired);
    expect(await rules.get(ORG)).toBeNull();
    expect(await balance()).toBe(0);
  });

  it("starts counting again once a person saves the rule", async () => {
    await enableRule();
    provider.next({ kind: "answer", state: TopUpState.RequiresAction });
    await runner().evaluate(ORG, true);
    await enableRule();
    later(2 * 60 * 60 * 1000);
    expect((await runner().evaluate(ORG, true)).kind).toBe("charged");
  });
});

describe("the cache", () => {
  it("skips an organisation whose rule is cached as off without reading Postgres", async () => {
    await enableRule();
    await rules.put(ORG, { armed: false, thresholdCents: 1000 });
    expect(await runner().evaluate(ORG, true)).toEqual({ kind: "skipped", reason: "cached_off" });
  });

  /** The bound on a stale cache: the sweep never asks it. */
  it("is ignored by the sweep, which catches a stale entry", async () => {
    await enableRule();
    await rules.put(ORG, { armed: false, thresholdCents: 1000 });
    await new AutoTopUpSweeper(
      runner(),
      new BillingWorkReader(pg.db),
      new LiveBalanceCache(valkey),
      new RecordingLogger(),
    ).runOnce();
    expect(provider.charges.size).toBe(1);
  });

  it("is refreshed by what Postgres said", async () => {
    await enableRule();
    await pg.owner.query(
      `UPDATE billing_settings SET auto_top_up_enabled = false WHERE org_id = $1`,
      [ORG],
    );
    await runner().evaluate(ORG, false);
    expect(await rules.get(ORG)).toEqual({ armed: false, thresholdCents: 1000 });
  });

  it("still works when Valkey is unreachable", async () => {
    await enableRule();
    const dead = createValkeyClient({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 100,
      onError: () => {},
    });
    const offline = new AutoTopUpRunner(
      uow,
      provider,
      new AutoTopUpRuleCache(dead),
      signals,
      new BillingWorkReader(pg.db),
      clock,
      new RecordingLogger(),
    );
    expect((await offline.evaluate(ORG, true)).kind).toBe("charged");
    dead.disconnect();
  });
});

describe("the five-second tick", () => {
  function sketchOf(count: number): HyperLogLog {
    const sketch = HyperLogLog.empty();
    for (let n = 0; n < count; n += 1) sketch.add(`usr_${String(n).padStart(32, "0")}`);
    return sketch;
  }

  /**
   * The whole chain: usage is written, the flush signals, the tick reprices and charges, the
   * charge signals the wallet, and the same tick tops it up. No five-minute pass involved.
   */
  it("goes from a usage signal to a charge to a top-up within one tick", async () => {
    await enableRule(1000, 50_000);
    const tenant = new TenantContext(PROJECT, "req_test", "system");
    await uow.transaction((tx) =>
      new UsageRepository(tx, tenant).mergeActiveUsers(
        new Date("2026-09-02T06:00:00Z"),
        sketchOf(60_000),
      ),
    );
    const drawdown = new UsageDrawdown(
      uow,
      new OrgUsageActivityReader(pg.db),
      clock,
      new RecordingLogger(),
      signals,
    );
    const consumer = new BillingSignalConsumer(
      drawdownDue,
      autoTopUpDue,
      new SpacingGate(valkey, "billing:drawdown:spacing:"),
      new BillingWorkReader(pg.db),
      drawdown,
      liveBalance(),
      rules,
      runner(),
      clock,
      new RecordingLogger(),
    );

    await signals.usageMoved(PROJECT);
    await consumer.tick();

    const debt = await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, context).debtCents(),
    );
    expect(debt).toBe(0);
    expect(provider.charges.size).toBe(1);
    expect(await balance()).toBeGreaterThan(0);
    expect(await drawdownDue.size()).toBe(0);
    expect(await autoTopUpDue.size()).toBe(0);
  });

  it("books a busy organisation's ledger at most once per spacing", async () => {
    let repriced = 0;
    const drawdown = new UsageDrawdown(
      uow,
      new OrgUsageActivityReader(pg.db),
      clock,
      new RecordingLogger(),
    );
    drawdown.runFor = () => {
      repriced += 1;
      return Promise.resolve(0);
    };
    const consumer = new BillingSignalConsumer(
      drawdownDue,
      autoTopUpDue,
      new SpacingGate(valkey, "billing:drawdown:spacing:"),
      new BillingWorkReader(pg.db),
      drawdown,
      liveBalance(),
      rules,
      null,
      clock,
      new RecordingLogger(),
    );
    for (let n = 0; n < 5; n += 1) {
      await signals.usageMoved(PROJECT);
      await consumer.tick();
    }
    expect(repriced).toBe(1);
    // Finished rather than deferred: the live figure already reflects them, and the ledger pass
    // reprices the whole month whenever it next runs.
    expect(await drawdownDue.size()).toBe(0);
  });
});

describe("deciding on the live balance", () => {
  /**
   * The ledger still says there is plenty: nothing has been booked yet. The live figure says the
   * usage behind it has already spent past the threshold, and the rule fires on that.
   */
  it("fires on usage the ledger has not booked yet", async () => {
    await enableRule(1000, 5000);
    await uow.transaction((tx) =>
      new CreditGrantRepository(tx, context).grant({
        kind: "purchased",
        amountCents: 3000,
        currency: "USD",
        topUpId: null,
        note: "x",
        expiresAt: null,
      }),
    );
    expect((await runner().evaluate(ORG, true, 0)).kind).toBe("skipped");
    expect(await runner().evaluate(ORG, true, 2500)).toMatchObject({ kind: "charged" });
    expect(provider.charges.size).toBe(1);
  });

  it("still never charges twice when many lanes see the same low live balance", async () => {
    await enableRule(1000, 5000);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runner().evaluate(ORG, true, 900)),
    );
    expect(results.filter((result) => result.kind === "charged")).toHaveLength(1);
    expect(provider.charges.size).toBe(1);
  });

  it("tells the live balance that the ledger moved once a charge settles", async () => {
    await enableRule();
    const sent: string[] = [];
    const recording = new ValkeyBillingSignals(drawdownDue, autoTopUpDue, rules, clock, () => {});
    const original = recording.walletMoved.bind(recording);
    recording.walletMoved = async (orgId: string) => {
      sent.push(orgId);
      await original(orgId);
    };
    await new AutoTopUpRunner(
      uow,
      provider,
      rules,
      recording,
      new BillingWorkReader(pg.db),
      clock,
      new RecordingLogger(),
    ).evaluate(ORG, true);
    expect(sent).toEqual([ORG]);
  });
});

describe("an invoiced organisation", () => {
  it("is never topped up: it pays by invoice, not from a wallet", async () => {
    await enableRule();
    await pg.owner.query(
      `UPDATE billing_settings SET billing_mode = 'invoiced', invoice_email = 'ap@acme.test' WHERE org_id = $1`,
      [ORG],
    );
    expect(await runner().evaluate(ORG, false, 99_999)).toEqual({
      kind: "skipped",
      reason: "invoiced",
    });
    expect(provider.requests).toHaveLength(0);
    expect(await rules.get(ORG)).toMatchObject({ armed: false });
  });
});

describe("the sweep's reach", () => {
  /** A page of one: the second armed organisation by id is only reachable by the cursor. */
  it("pages through every armed rule", async () => {
    await enableRule();
    const second = "ffff0000-0000-4000-8000-0000000000b9";
    await pg.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Second')`, [second]);
    await pg.owner.query(
      `INSERT INTO billing_settings (org_id, auto_top_up_enabled, auto_top_up_threshold_cents, auto_top_up_amount_cents)
       VALUES ($1, true, 1000, 5000)`,
      [second],
    );
    const reader = new BillingWorkReader(pg.db);
    const first = await reader.armedRules(1);
    expect(first).toHaveLength(1);
    const next = await reader.armedRules(1, first[0] ?? null);
    expect([...first, ...next].sort()).toEqual([ORG, second].sort());
    expect(await reader.armedRules(1, next[0] ?? null)).toEqual([]);

    await pg.owner.query(`DELETE FROM billing_settings WHERE org_id = $1`, [second]);
    await pg.owner.query(`DELETE FROM orgs WHERE id = $1`, [second]);
  });
});
