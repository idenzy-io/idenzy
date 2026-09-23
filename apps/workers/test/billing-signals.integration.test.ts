import { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { type DueEntry, DueSet } from "@idenzy/cache/due-set";
import {
  AUTO_TOP_UP_DUE_KEY,
  DRAWDOWN_DUE_KEY,
  ValkeyBillingSignals,
} from "@idenzy/cache/valkey-billing-signals";
import { Clock } from "@idenzy/core/time/clock";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The billing signals against a real Valkey (ADR-0017).
 *
 * What matters is what a sorted set does with the same member marked twice, and what the
 * compare-and-remove script does when a mark lands between a read and a removal — both of
 * which a fake would simply agree with.
 */
const harness = new ValkeyHarness();
let valkey: ValkeyClient;

class MovableClock extends Clock {
  instant = new Date("2026-09-23T12:00:00Z");
  override now(): Date {
    return this.instant;
  }
}

const clock = new MovableClock();
const at = (seconds: number): Date => new Date(clock.instant.getTime() + seconds * 1000);

/** The one entry due now, asserted to be exactly one. */
async function onlyDue(set: DueSet): Promise<DueEntry> {
  const due = await set.due(clock.now(), 10);
  expect(due).toHaveLength(1);
  // Safe: the length was asserted on the line above, which the index type cannot see.
  return due[0] as DueEntry;
}

beforeAll(async () => {
  await harness.start();
  valkey = createValkeyClient({ url: harness.url, onError: () => {} });
  // The client queues nothing while it connects, by design, so the first command has to wait.
  if (valkey.status !== "ready") {
    await new Promise<void>((resolve) => valkey.once("ready", () => resolve()));
  }
}, 120_000);

beforeEach(async () => {
  await valkey.flushall();
});

afterAll(async () => {
  valkey.disconnect();
  await harness.stop();
});

describe("a due set", () => {
  it("coalesces a member marked many times into one entry", async () => {
    const set = new DueSet(valkey, "t");
    for (let n = 0; n < 50; n += 1) await set.mark("org_a", at(n / 10));
    expect(await set.size()).toBe(1);
  });

  it("answers only what is due, earliest first", async () => {
    const set = new DueSet(valkey, "t");
    await set.mark("later", at(60));
    await set.mark("second", at(-5));
    await set.mark("first", at(-10));
    const due = await set.due(clock.now(), 10);
    expect(due.map((entry) => entry.member)).toEqual(["first", "second"]);
  });

  it("removes what was done", async () => {
    const set = new DueSet(valkey, "t");
    await set.mark("org_a", at(0));
    const entry = await onlyDue(set);
    await set.done(entry);
    expect(await set.size()).toBe(0);
  });

  /**
   * The case the script exists for. A mark that lands while the consumer is working is about
   * something the consumer may not have read, so removing it would lose the signal.
   */
  it("keeps a member marked again while it was being worked on", async () => {
    const set = new DueSet(valkey, "t");
    await set.mark("org_a", at(0));
    const entry = await onlyDue(set);
    await set.mark("org_a", at(1));
    await set.done(entry);
    expect(await set.size()).toBe(1);
  });

  it("never brings a deferred member forward with an older mark", async () => {
    const set = new DueSet(valkey, "t");
    await set.mark("org_a", at(0));
    const entry = await onlyDue(set);
    await set.defer(entry, at(60));
    await set.mark("org_a", at(1));
    expect(await set.due(at(30), 10)).toEqual([]);
    expect(await set.due(at(60), 10)).toHaveLength(1);
  });

  it("does not resurrect a member by deferring it after it was done", async () => {
    const set = new DueSet(valkey, "t");
    await set.mark("org_a", at(0));
    const entry = await onlyDue(set);
    await set.done(entry);
    await set.defer(entry, at(60));
    expect(await set.size()).toBe(0);
  });
});

describe("the rule cache", () => {
  it("round-trips, and drops", async () => {
    const cache = new AutoTopUpRuleCache(valkey);
    await cache.put("org_a", { armed: true });
    expect(await cache.get("org_a")).toEqual({ armed: true });
    await cache.drop("org_a");
    expect(await cache.get("org_a")).toBeNull();
  });

  it("expires", async () => {
    const cache = new AutoTopUpRuleCache(valkey, 50);
    await cache.put("org_a", { armed: false });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await cache.get("org_a")).toBeNull();
  });

  it("treats something it cannot read as a miss", async () => {
    await valkey.set("billing:auto-top-up:rule:org_a", "not json");
    expect(await new AutoTopUpRuleCache(valkey).get("org_a")).toBeNull();
  });
});

describe("the signals", () => {
  function signals(onFailure: (signal: string) => void = () => {}): ValkeyBillingSignals {
    return new ValkeyBillingSignals(
      new DueSet(valkey, DRAWDOWN_DUE_KEY),
      new DueSet(valkey, AUTO_TOP_UP_DUE_KEY),
      new AutoTopUpRuleCache(valkey),
      clock,
      onFailure,
    );
  }

  it("marks the right set for each", async () => {
    await signals().usageMoved("prj_1");
    await signals().walletMoved("org_a");
    expect(await new DueSet(valkey, DRAWDOWN_DUE_KEY).size()).toBe(1);
    expect(await new DueSet(valkey, AUTO_TOP_UP_DUE_KEY).size()).toBe(1);
  });

  it("drops the cached rule and marks the organisation when the rule changes", async () => {
    const cache = new AutoTopUpRuleCache(valkey);
    await cache.put("org_a", { armed: false });
    await signals().ruleChanged("org_a");
    expect(await cache.get("org_a")).toBeNull();
    expect(await new DueSet(valkey, AUTO_TOP_UP_DUE_KEY).size()).toBe(1);
  });

  /** A sign-in's flush and a settings save must not fail because this could not be sent. */
  it("never throws when Valkey is unreachable, and says so", async () => {
    const dead = createValkeyClient({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 100,
      onError: () => {},
    });
    const failures: string[] = [];
    const unreachable = new ValkeyBillingSignals(
      new DueSet(dead, DRAWDOWN_DUE_KEY),
      new DueSet(dead, AUTO_TOP_UP_DUE_KEY),
      new AutoTopUpRuleCache(dead),
      clock,
      (signal) => failures.push(signal),
    );
    await expect(unreachable.usageMoved("prj_1")).resolves.toBeUndefined();
    await expect(unreachable.ruleChanged("org_a")).resolves.toBeUndefined();
    expect(failures).toEqual(["usage_moved", "rule_changed"]);
    dead.disconnect();
  });
});
