import {
  type RateLimitDecision,
  type RateLimitRule,
  RateLimitStrategy,
} from "@idenzy/cache/rate-limit-strategy";
import { SystemClock } from "@idenzy/core/time/clock";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { AttestationVerifier } from "@idenzy/domain/ports/attestation";
import type { SendContext } from "@idenzy/domain/ports/sms-provider";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { MetadataPhoneGeography } from "@idenzy/providers-sms/metadata-phone-geography";
import { RecordingLogger } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSpendCap } from "../dist/delivery/database-spend-cap.js";
import { SmsFraudGuard } from "../dist/delivery/sms-fraud-guard.js";
import { WalletSolvency } from "../dist/delivery/wallet-solvency.js";

const harness = new PostgresHarness();
const clock = new SystemClock();
const geography = new MetadataPhoneGeography();

const PROJECT = "22222222-2222-2222-2222-222222222222";
const BUSY = "33333333-3333-3333-3333-333333333333";
const UNCONFIGURED = "44444444-4444-4444-4444-444444444444";

let uow: UnitOfWork;

/** Counters in memory, so a test can exhaust a window without a Valkey container. */
class InMemoryLimiter extends RateLimitStrategy {
  override readonly name = "memory";
  private readonly counts = new Map<string, number>();
  broken = false;

  constructor() {
    super(clock);
  }

  protected override evaluate(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    if (this.broken) return Promise.reject(new Error("valkey is unreachable"));
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve({
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: count <= rule.limit ? 0 : rule.windowSeconds,
    });
  }
}

class Attesting implements AttestationVerifier {
  constructor(private readonly answer: boolean) {}
  verify(): Promise<boolean> {
    return Promise.resolve(this.answer);
  }
}

function context(overrides: Partial<SendContext> = {}): SendContext {
  return {
    projectId: PROJECT,
    requestId: "req_sms",
    ip: "203.0.113.9",
    attestation: null,
    ...overrides,
  };
}

interface GuardParts {
  guard: SmsFraudGuard;
  limiter: InMemoryLimiter;
  logger: RecordingLogger;
}

function build(attestationAnswer = true): GuardParts {
  const limiter = new InMemoryLimiter();
  const logger = new RecordingLogger();
  return {
    limiter,
    logger,
    guard: new SmsFraudGuard(
      uow,
      clock,
      limiter,
      logger,
      geography,
      new Attesting(attestationAnswer),
    ),
  };
}

const US = E164PhoneNumber.parse("+14155550123");

async function seedProject(id: string, name: string): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [id]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
     VALUES ($1, (SELECT id FROM orgs LIMIT 1), $2, (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [id, name],
  );
}

async function seedPolicy(id: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const values = {
    allowed_countries: ["US", "GB"],
    daily_spend_cap: "1.000000",
    attestation_required: false,
    per_number_daily_limit: 3,
    per_ip_hourly_limit: 5,
    max_sends_per_verify: 6,
    ...overrides,
  };
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [id]);
  await harness.owner.query(
    `INSERT INTO sms_policies
       (project_id, allowed_countries, daily_spend_cap, attestation_required,
        per_number_daily_limit, per_ip_hourly_limit, max_sends_per_verify)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id) DO UPDATE SET
       allowed_countries = excluded.allowed_countries,
       daily_spend_cap = excluded.daily_spend_cap,
       attestation_required = excluded.attestation_required,
       per_number_daily_limit = excluded.per_number_daily_limit,
       per_ip_hourly_limit = excluded.per_ip_hourly_limit,
       max_sends_per_verify = excluded.max_sends_per_verify`,
    [
      id,
      values.allowed_countries,
      values.daily_spend_cap,
      values.attestation_required,
      values.per_number_daily_limit,
      values.per_ip_hourly_limit,
      values.max_sends_per_verify,
    ],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
  );
  await harness.owner.query(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1))`,
  );

  await seedProject(PROJECT, "Acme");
  await seedProject(BUSY, "Busy");
  await seedProject(UNCONFIGURED, "Unconfigured");
  await seedPolicy(PROJECT);
  await seedPolicy(BUSY, { max_sends_per_verify: 6 });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("where a project may send", () => {
  /**
   * The default a project holds before anybody configures it, and the answer that has to
   * be no. Every other control here can be reasoned about; this one is about what
   * happens when nobody has reasoned about anything.
   */
  it("refuses a project with no policy at all", async () => {
    const { guard } = build();
    await expect(
      guard.assertAllowed(context({ projectId: UNCONFIGURED }), US),
    ).rejects.toMatchObject({ code: "country_not_allowed" });
  });

  it("allows a destination on the allowlist", async () => {
    const { guard } = build();
    await expect(guard.assertAllowed(context(), US)).resolves.toBeUndefined();
  });

  it("refuses a destination the project did not opt into", async () => {
    const { guard } = build();
    await expect(
      guard.assertAllowed(context(), E164PhoneNumber.parse("+905321234567")),
    ).rejects.toMatchObject({ code: "country_not_allowed" });
  });

  /**
   * The reason the geography reads full metadata rather than a calling-code table. A
   * project that allowed the United States has not thereby allowed Jamaica, which shares
   * the +1 prefix and does not share the price.
   */
  it("does not treat a shared calling code as the same country", async () => {
    const { guard } = build();
    await expect(
      guard.assertAllowed(context(), E164PhoneNumber.parse("+18762345678")),
    ).rejects.toMatchObject({ code: "country_not_allowed" });
  });

  it("refuses a premium-rate number even where the country is allowed", async () => {
    await seedPolicy(PROJECT, { allowed_countries: ["US", "GB"] });
    const { guard, logger } = build();
    await expect(
      guard.assertAllowed(context(), E164PhoneNumber.parse("+448700000000")),
    ).rejects.toMatchObject({ code: "country_not_allowed" });
    expect(logger.records.some((r) => r.fields["outcome"] === "premium_rate")).toBe(true);
  });

  it("refuses a number it cannot place", async () => {
    const { guard } = build();
    await expect(
      guard.assertAllowed(context(), E164PhoneNumber.parse("+9999999999")),
    ).rejects.toMatchObject({ code: "country_not_allowed" });
  });
});

describe("proving a human is there", () => {
  it("refuses when the policy requires attestation and none was sent", async () => {
    await seedPolicy(PROJECT, { attestation_required: true });
    const { guard } = build();
    await expect(guard.assertAllowed(context(), US)).rejects.toMatchObject({
      code: "attestation_required",
    });
    await seedPolicy(PROJECT);
  });

  it("refuses a token the verifier does not recognise", async () => {
    await seedPolicy(PROJECT, { attestation_required: true });
    const { guard } = build(false);
    await expect(guard.assertAllowed(context({ attestation: "forged" }), US)).rejects.toMatchObject(
      { code: "attestation_required" },
    );
    await seedPolicy(PROJECT);
  });

  /**
   * The reason attestation is checked before any counter. Without that ordering, anybody
   * could burn a stranger's daily allowance by naming their number, and the victim would
   * find their own sign-in refused without ever having been sent a code.
   */
  it("does not spend a number's allowance on a request that failed attestation", async () => {
    await seedPolicy(PROJECT, { attestation_required: true, per_number_daily_limit: 1 });
    const { guard, limiter } = build(false);
    const victim = E164PhoneNumber.parse("+14155550188");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        guard.assertAllowed(context({ attestation: "forged" }), victim),
      ).rejects.toMatchObject({ code: "attestation_required" });
    }

    await seedPolicy(PROJECT, { per_number_daily_limit: 1 });
    const owner = new SmsFraudGuard(
      uow,
      clock,
      limiter,
      new RecordingLogger(),
      geography,
      new Attesting(true),
    );
    await expect(owner.assertAllowed(context(), victim)).resolves.toBeUndefined();
    await seedPolicy(PROJECT);
  });
});

describe("velocity and sweeps", () => {
  it("refuses past the per-number daily ceiling", async () => {
    await seedPolicy(PROJECT, { per_number_daily_limit: 2 });
    const { guard } = build();
    const number = E164PhoneNumber.parse("+14155550200");

    await guard.assertAllowed(context(), number);
    await guard.assertAllowed(context(), number);
    await expect(guard.assertAllowed(context(), number)).rejects.toMatchObject({
      code: "rate_limited",
    });
    await seedPolicy(PROJECT);
  });

  it("refuses past the per-address hourly ceiling, across different numbers", async () => {
    await seedPolicy(PROJECT, { per_ip_hourly_limit: 2, per_number_daily_limit: 50 });
    const { guard } = build();
    const ip = "198.51.100.4";

    await guard.assertAllowed(context({ ip }), E164PhoneNumber.parse("+14155551301"));
    await guard.assertAllowed(context({ ip }), E164PhoneNumber.parse("+14155552302"));
    await expect(
      guard.assertAllowed(context({ ip }), E164PhoneNumber.parse("+14155553303")),
    ).rejects.toMatchObject({ code: "rate_limited" });
    await seedPolicy(PROJECT);
  });

  /**
   * The shape a pumping run has and a real user base does not: consecutive numbers. Each
   * of these passes the per-number ceiling, because each is a different number, and the
   * per-address ceiling can be dodged with a proxy. The block counter is what sees it.
   */
  it("refuses a sweep through one thousand-block", async () => {
    await seedPolicy(PROJECT, { per_number_daily_limit: 50, per_ip_hourly_limit: 500 });
    const { guard, logger } = build();

    for (let last = 0; last < 10; last += 1) {
      const number = E164PhoneNumber.parse(`+1415555${(4000 + last).toString()}`);
      await guard.assertAllowed(context({ ip: `198.51.100.${last}` }), number);
    }

    await expect(
      guard.assertAllowed(context({ ip: "198.51.100.99" }), E164PhoneNumber.parse("+14155554010")),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(logger.records.some((r) => r.fields["outcome"] === "sms:block")).toBe(true);
    await seedPolicy(PROJECT);
  });

  /**
   * The signal a scheme cannot fake, because it needs somebody to type the code in. It
   * throttles the project rather than the caller, which is blunt on purpose.
   */
  it("refuses once sends run far ahead of verifications", async () => {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [BUSY]);
    await harness.owner.query(
      `INSERT INTO usage_daily (project_id, day, sms_sent, sms_verified)
       VALUES ($1, (now() at time zone 'utc')::date, 200, 1)
       ON CONFLICT (project_id, day) DO UPDATE SET sms_sent = 200, sms_verified = 1`,
      [BUSY],
    );
    const { guard, logger } = build();
    await expect(guard.assertAllowed(context({ projectId: BUSY }), US)).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(logger.records.some((r) => r.fields["outcome"] === "verify_ratio")).toBe(true);
  });

  it("ignores the ratio below the daily floor", async () => {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [BUSY]);
    await harness.owner.query(
      `UPDATE usage_daily SET sms_sent = 5, sms_verified = 0
       WHERE project_id = $1 AND day = (now() at time zone 'utc')::date`,
      [BUSY],
    );
    const { guard } = build();
    await expect(guard.assertAllowed(context({ projectId: BUSY }), US)).resolves.toBeUndefined();
  });

  /**
   * The fail-closed half. A counter we cannot read is a send we do not make: the
   * fail-open that is right for a sign-in attempt would make a cache outage into the
   * unmetered window a pumping scheme is waiting for.
   */
  it("refuses when the counters cannot be read at all", async () => {
    const { guard, limiter, logger } = build();
    limiter.broken = true;
    await expect(guard.assertAllowed(context(), US)).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(logger.records.some((r) => r.fields["outcome"] === "counter_unavailable")).toBe(true);
  });

  /** The refusal says "later", never "our cache is down". */
  it("never names the reason it could not count", async () => {
    const { guard, limiter } = build();
    limiter.broken = true;
    await expect(guard.assertAllowed(context(), US)).rejects.toThrow(/too many requests/i);
  });
});

describe("the daily spend cap", () => {
  /* The solvency gate is real rather than stubbed: these projects have no debt, so it
     answers yes, and the cap is what the block below is actually about. Its own refusal is
     tested where it belongs, in `wallet-solvency.integration.test.ts`. */
  const cap = () => new DatabaseSpendCap(uow, clock, new WalletSolvency(uow, clock));

  it("allows a send that fits inside the cap", async () => {
    await seedPolicy(PROJECT, { daily_spend_cap: "1.000000" });
    await resetSpend(PROJECT);
    await expect(
      cap().reserve(PROJECT, { amountMicros: 7_000, currency: "USD" }),
    ).resolves.toBeUndefined();
    expect(await spendOf(PROJECT)).toBe("0.007000");
  });

  it("refuses the send that would cross the cap, and books nothing for it", async () => {
    await seedPolicy(PROJECT, { daily_spend_cap: "0.020000" });
    await resetSpend(PROJECT);

    await cap().reserve(PROJECT, { amountMicros: 8_000, currency: "USD" });
    await cap().reserve(PROJECT, { amountMicros: 8_000, currency: "USD" });
    await expect(
      cap().reserve(PROJECT, { amountMicros: 8_000, currency: "USD" }),
    ).rejects.toMatchObject({ code: "spend_cap_reached" });

    expect(await spendOf(PROJECT)).toBe("0.016000");
  });

  /**
   * The first send of a day takes the insert branch, which no conditional update covers.
   * Without the caller's own check a single message priced above the whole cap would go
   * out, which is the one send a cap most needs to stop.
   */
  it("refuses a single send priced above the whole cap", async () => {
    await seedPolicy(PROJECT, { daily_spend_cap: "0.001000" });
    await resetSpend(PROJECT);
    await expect(
      cap().reserve(PROJECT, { amountMicros: 900_000, currency: "USD" }),
    ).rejects.toMatchObject({ code: "spend_cap_reached" });
    expect(await spendOf(PROJECT)).toBe("0.000000");
  });

  it("books the difference when a provider charged less than it quoted", async () => {
    await seedPolicy(PROJECT, { daily_spend_cap: "1.000000" });
    await resetSpend(PROJECT);

    await cap().reserve(PROJECT, { amountMicros: 10_000, currency: "USD" });
    await cap().settle(
      PROJECT,
      { amountMicros: 10_000, currency: "USD" },
      { amountMicros: 6_000, currency: "USD" },
    );
    expect(await spendOf(PROJECT)).toBe("0.006000");
  });

  /**
   * Converting would put an exchange rate on the request path and make the cap mean a
   * different amount every day. A provider quoting in the wrong currency is a
   * misconfiguration, and it fails loudly rather than spending an unknown amount.
   */
  it("refuses a quote in a currency the cap is not set in", async () => {
    await seedPolicy(PROJECT, { daily_spend_cap: "1.000000" });
    await expect(
      cap().reserve(PROJECT, { amountMicros: 1_000, currency: "EUR" }),
    ).rejects.toMatchObject({ code: "internal_error" });
  });
});

async function resetSpend(projectId: string): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  await harness.owner.query(
    `DELETE FROM usage_daily WHERE project_id = $1 AND day = (now() at time zone 'utc')::date`,
    [projectId],
  );
}

async function spendOf(projectId: string): Promise<string> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  const { rows } = await harness.owner.query<{ sms_cost: string }>(
    `SELECT sms_cost FROM usage_daily
     WHERE project_id = $1 AND day = (now() at time zone 'utc')::date`,
    [projectId],
  );
  return rows[0]?.sms_cost ?? "0.000000";
}
