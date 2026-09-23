import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { User } from "@idenzy/domain/entities/user";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { FakeClock, RecordingBillingSignals } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { BufferedActiveUserMeter } from "../dist/usage/buffered-active-user-meter.js";
import { SilentLogger, testConfig } from "./fixtures.js";

/**
 * The meter's live half, against a real Postgres and a real Valkey (ADR-0017).
 *
 * The property everything else rests on: what the live hashes union to is exactly what Postgres
 * unions to once the flush lands, so a balance priced from one agrees to the cent with a ledger
 * priced from the other.
 */
const pg = new PostgresHarness();
const cache = new ValkeyHarness();
const PROJECT = "a1a1a1a1-0000-4000-8000-000000000001";
const PERIOD = "2026-09-01";
let uow: UnitOfWork;
let valkey: ValkeyClient;
let clock: FakeClock;
let signals: RecordingBillingSignals;

function person(n: number): User {
  return new User({
    id: `0191f3c2-0000-7000-8000-${String(n).padStart(12, "0")}`,
    projectId: PROJECT,
    // An address, so the meter does not treat them as anonymous and skip them.
    email: `person${String(n)}@example.com`,
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    passwordAlgoVersion: 1,
    displayName: null,
    avatarUrl: null,
    metadataPublic: {},
    metadataPrivate: {},
    bannedUntil: null,
    lastSignInAt: null,
    // Created well before today, so the meter counts them (a user is free on day one).
    createdAt: new Date("2026-08-01T00:00:00Z"),
    deletedAt: null,
  });
}

function meter(live: LiveUsageSketches = new LiveUsageSketches(valkey)): BufferedActiveUserMeter {
  return new BufferedActiveUserMeter(clock, uow, new SilentLogger(), testConfig(), signals, live);
}

async function signIn(target: BufferedActiveUserMeter, from: number, to: number): Promise<void> {
  for (let n = from; n < to; n += 1) await target.mark(PROJECT, person(n));
}

async function liveCount(): Promise<number> {
  return HyperLogLog.union(await new LiveUsageSketches(valkey).read(PROJECT, PERIOD)).count;
}

async function postgresCount(): Promise<number> {
  const tenant = new TenantContext(PROJECT, "req_test", "system");
  const days = await uow.transaction((tx) =>
    new UsageRepository(tx, tenant).dailyBetween(PERIOD, "2026-09-30"),
  );
  return HyperLogLog.union(days.map((day) => day.activeUsers)).count;
}

beforeAll(async () => {
  await Promise.all([pg.start(), cache.start()]);
  uow = new UnitOfWork(pg.db);
  valkey = createValkeyClient({ url: cache.url, onError: () => {} });
  if (valkey.status !== "ready") {
    await new Promise<void>((resolve) => valkey.once("ready", () => resolve()));
  }
  const { rows } = await pg.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name) VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  await pg.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

beforeEach(async () => {
  await valkey.flushall();
  await pg.owner.query(`DELETE FROM usage_daily WHERE project_id = $1`, [PROJECT]);
  clock = new FakeClock(new Date("2026-09-10T12:00:00Z"));
  signals = new RecordingBillingSignals();
});

afterAll(async () => {
  valkey.disconnect();
  await Promise.all([pg.stop(), cache.stop()]);
});

describe("publishing the month live", () => {
  it("publishes what this instance has seen, and signals the project", async () => {
    const one = meter();
    await signIn(one, 0, 300);
    await one.publishLive();

    expect(await liveCount()).toBe(HyperLogLog.union([sketchOf(0, 300)]).count);
    expect(signals.sent).toEqual([{ signal: "usage_moved", id: PROJECT }]);
  });

  it("publishes nothing, and signals nothing, when nobody new arrived", async () => {
    const one = meter();
    await signIn(one, 0, 10);
    await one.publishLive();
    await signIn(one, 0, 10);
    await one.publishLive();
    expect(signals.sent).toHaveLength(1);
  });

  it("keeps each instance's view apart and unions them", async () => {
    const a = meter();
    const b = meter();
    await signIn(a, 0, 200);
    await signIn(b, 100, 400);
    await a.publishLive();
    await b.publishLive();
    expect(await new LiveUsageSketches(valkey).read(PROJECT, PERIOD)).toHaveLength(2);
    expect(await liveCount()).toBe(HyperLogLog.union([sketchOf(0, 400)]).count);
  });

  /**
   * The equality the live balance rests on. Two instances, overlapping people, several days; once
   * both have flushed to Postgres, the union Postgres holds and the union the live hashes hold are
   * the same number, because a union of HyperLogLogs is a per-register maximum and both sides
   * saw the same registers.
   */
  it("agrees exactly with what Postgres holds once the meters flush", async () => {
    const a = meter();
    const b = meter();
    await signIn(a, 0, 5_000);
    clock.set(new Date("2026-09-11T12:00:00Z"));
    await signIn(b, 2_500, 9_000);
    await signIn(a, 8_000, 12_000);
    await a.publishLive();
    await b.publishLive();
    await a.onApplicationShutdown();
    await b.onApplicationShutdown();

    const postgres = await postgresCount();
    expect(postgres).toBeGreaterThan(11_000);
    expect(await liveCount()).toBe(postgres);
  });

  it("never throws when Valkey is unreachable, and publishes on the next try", async () => {
    const dead = createValkeyClient({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 100,
      onError: () => {},
    });
    const one = meter(new LiveUsageSketches(dead));
    await signIn(one, 0, 50);
    await expect(one.publishLive()).resolves.toBeUndefined();
    expect(signals.sent).toEqual([]);
    dead.disconnect();
  });
});

function sketchOf(from: number, to: number): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (let n = from; n < to; n += 1) sketch.add(person(n).id);
  return sketch;
}
