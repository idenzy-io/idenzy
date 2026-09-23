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
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { OrgUsageActivityReader } from "@idenzy/persistence/repository/org-usage-activity-reader";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents } from "@idenzy/protocol/billing/price-list";
import { CreditKind } from "@idenzy/protocol/enums/billing";
import { FakeClock, RecordingLogger } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BillingSignalConsumer } from "../src/billing/billing-signal-consumer.js";
import { LiveBalance } from "../src/billing/live-balance.js";
import { UsageDrawdown } from "../src/usage-drawdown.js";

/**
 * The live balance against a real Postgres and a real Valkey (ADR-0017).
 *
 * What it promises: the figure shown every five seconds is exactly what the ledger will say once
 * the meters flush and the five-minute pass books it, it can be rebuilt from nothing, and a tick
 * does not read Postgres to produce it.
 */
const pg = new PostgresHarness();
const cache = new ValkeyHarness();
const ORG = "aaaa0000-0000-4000-8000-0000000000c1";
const PROJECT = "cccc0000-0000-4000-8000-0000000000c2";
const PERIOD = "2026-09-01";
const context = new OrgContext(ORG, "req_test", "system");
const INSTANCE = "api-instance-1";

let uow: UnitOfWork;
let valkey: ValkeyClient;
let clock: FakeClock;

function sketchOf(from: number, to: number): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (let n = from; n < to; n += 1) sketch.add(`usr_${String(n).padStart(32, "0")}`);
  return sketch;
}

/** What the meter's flush does: the day's sketch into Postgres. */
async function flush(sketch: HyperLogLog, day = "2026-09-10"): Promise<void> {
  const tenant = new TenantContext(PROJECT, "req_test", "system");
  await uow.transaction((tx) =>
    new UsageRepository(tx, tenant).mergeActiveUsers(new Date(`${day}T06:00:00Z`), sketch),
  );
}

/** What the meter's five-second publish does. */
async function publish(sketch: HyperLogLog): Promise<void> {
  await new LiveUsageSketches(valkey).publish(PROJECT, PERIOD, INSTANCE, sketch);
}

function live(): LiveBalance {
  return new LiveBalance(uow, new LiveUsageSketches(valkey), new LiveBalanceCache(valkey), clock);
}

function drawdown(): UsageDrawdown {
  return new UsageDrawdown(uow, new OrgUsageActivityReader(pg.db), clock, new RecordingLogger());
}

async function grant(cents: number): Promise<void> {
  await uow.transaction((tx) =>
    new CreditGrantRepository(tx, context).grant({
      kind: CreditKind.Purchased,
      amountCents: cents,
      currency: "USD",
      topUpId: null,
      note: "Test credit",
      expiresAt: null,
    }),
  );
}

async function ledgerBalance(): Promise<number> {
  return await uow.transaction((tx) => new WalletLedger(tx, context).balanceCents(clock.now()));
}

beforeAll(async () => {
  await Promise.all([pg.start(), cache.start()]);
  uow = new UnitOfWork(pg.db);
  valkey = createValkeyClient({ url: cache.url, onError: () => {} });
  if (valkey.status !== "ready") {
    await new Promise<void>((resolve) => valkey.once("ready", () => resolve()));
  }
  await pg.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
  await pg.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
    [PROJECT, ORG],
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    "usage_charges",
    "usage_billing_state",
    "org_debts",
    "credit_grants",
    "billing_settings",
  ]) {
    await pg.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
  }
  await pg.owner.query(`DELETE FROM usage_daily WHERE project_id = $1`, [PROJECT]);
  await valkey.flushall();
  clock = new FakeClock(new Date("2026-09-15T12:00:00Z"));
});

afterAll(async () => {
  valkey.disconnect();
  await Promise.all([pg.stop(), cache.stop()]);
});

describe("the live balance", () => {
  it("counts usage the ledger has not booked yet as pending", async () => {
    await grant(500_000);
    await publish(sketchOf(0, 80_000));

    const figure = await live().refresh(ORG);
    const priced = mauCents(sketchOf(0, 80_000).count);
    expect(figure.pendingCents).toBe(priced);
    expect(figure.balanceCents).toBe(500_000 - priced);
  });

  /**
   * The promise the design rests on, across a price band: 40,000 already flushed and booked, then
   * 260,000 more published live — past the free tier and past the 250,000 band edge. Once those
   * are flushed and the ledger pass books them, the ledger's balance is the live balance, to the
   * cent.
   */
  it("equals the ledger to the cent once the ledger books it, across a band", async () => {
    await grant(5_000_000);
    await flush(sketchOf(0, 40_000));
    await drawdown().runOnce();

    const everyone = sketchOf(0, 300_000);
    await publish(everyone);
    const shown = await live().refresh(ORG);
    expect(shown.pendingCents).toBeGreaterThan(0);

    await flush(everyone, "2026-09-14");
    await drawdown().runOnce();
    expect(await ledgerBalance()).toBe(shown.balanceCents);

    await live().ledgerMoved(ORG);
    expect((await live().refresh(ORG)).pendingCents).toBe(0);
  });

  it("is rebuilt from nothing when Valkey is emptied", async () => {
    await grant(500_000);
    await flush(sketchOf(0, 70_000));
    const before = await live().refresh(ORG);

    await valkey.flushall();
    const after = await live().refresh(ORG);
    expect(after.balanceCents).toBe(before.balanceCents);
    expect(after.pendingCents).toBe(before.pendingCents);
  });

  /**
   * A tick reads the ledger from its snapshot, not from Postgres. Credit added behind its back is
   * not seen until the ledger signals it moved — which every ledger write does — and then is.
   */
  it("does not read the ledger from Postgres on every tick", async () => {
    await grant(100_000);
    const shared = live();
    expect((await shared.refresh(ORG)).balanceCents).toBe(100_000);

    await grant(50_000);
    expect((await shared.refresh(ORG)).balanceCents).toBe(100_000);

    await shared.ledgerMoved(ORG);
    expect((await shared.refresh(ORG)).balanceCents).toBe(150_000);
  });

  it("stores what it computed, for whoever reads the balance next", async () => {
    await grant(10_000);
    const figure = await live().refresh(ORG);
    expect(await new LiveBalanceCache(valkey).live(ORG)).toEqual(figure);
  });
});

describe("for an invoiced organisation", () => {
  it("is its usage not yet invoiced, marked as invoiced", async () => {
    await pg.owner.query(
      `INSERT INTO billing_settings (org_id, billing_mode, invoice_email) VALUES ($1, 'invoiced', 'ap@acme.test')`,
      [ORG],
    );
    await publish(sketchOf(0, 80_000));
    const figure = await live().refresh(ORG);
    expect(figure.mode).toBe("invoiced");
    expect(figure.pendingCents).toBe(mauCents(sketchOf(0, 80_000).count));
    await pg.owner.query(`DELETE FROM billing_settings WHERE org_id = $1`, [ORG]);
  });
});

describe("under a storm of usage signals", () => {
  /**
   * Twenty ticks five seconds apart, each with new usage: the live figure moves every time, and the
   * ledger is written once, because it is booked at most every five minutes.
   */
  it("moves the live balance every tick and writes the ledger once", async () => {
    await grant(5_000_000);
    const drawdownDue = new DueSet(valkey, DRAWDOWN_DUE_KEY);
    const autoTopUpDue = new DueSet(valkey, AUTO_TOP_UP_DUE_KEY);
    const signals = new ValkeyBillingSignals(
      drawdownDue,
      autoTopUpDue,
      new AutoTopUpRuleCache(valkey),
      clock,
      () => {},
    );
    const consumer = new BillingSignalConsumer(
      drawdownDue,
      autoTopUpDue,
      new SpacingGate(valkey, "billing:drawdown:spacing:"),
      new BillingWorkReader(pg.db),
      new UsageDrawdown(
        uow,
        new OrgUsageActivityReader(pg.db),
        clock,
        new RecordingLogger(),
        signals,
      ),
      live(),
      new AutoTopUpRuleCache(valkey),
      null,
      clock,
      new RecordingLogger(),
    );

    const balances: number[] = [];
    for (let tick = 0; tick < 20; tick += 1) {
      const seen = sketchOf(0, 60_000 + tick * 1_000);
      await flush(seen);
      await publish(seen);
      await signals.usageMoved(PROJECT);
      await consumer.tick();
      const figure = await new LiveBalanceCache(valkey).live(ORG);
      if (figure !== null) balances.push(figure.balanceCents);
      clock.advanceSeconds(5);
    }

    const { rows } = await pg.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM usage_charges WHERE org_id = $1`,
      [ORG],
    );
    expect(Number(rows[0]?.n)).toBe(1);
    expect(new Set(balances).size).toBeGreaterThan(10);
  });
});
