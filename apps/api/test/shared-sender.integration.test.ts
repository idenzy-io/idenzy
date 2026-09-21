import {
  type RateLimitDecision,
  type RateLimitRule,
  RateLimitStrategy,
} from "@idenzy/cache/rate-limit-strategy";
import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  EmailSendingHoldRepository,
  HoldReason,
} from "@idenzy/persistence/repository/email-sending-hold-repository";
import { ProjectDomainRepository } from "@idenzy/persistence/repository/project-domain-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { ProjectDomainStatus, ProjectDomainType } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { DatabaseUsageMeter } from "../dist/delivery/database-usage-meter.js";
import { SendingDomains } from "../dist/delivery/sending-domains.js";
import { testConfig } from "./fixtures.js";

/**
 * The shared sender's ceiling, against a real Postgres (PROJECT.md 11.2, risks.md).
 *
 * `mail.idenzy.io` is a place to build an integration against and not to run a product on,
 * and the reason is that every project which configured nothing shares one domain's
 * reputation. What needs the database here is the half that decides which projects those
 * are: a verified `project_domains` row is the difference between "our reputation" and
 * "theirs", and a fake would agree with whatever this code believed about it.
 */

const harness = new PostgresHarness();
const SHARED_PROJECT = "a1a1a1a1-0000-4000-8000-000000000001";
const OWN_DOMAIN_PROJECT = "b2b2b2b2-0000-4000-8000-000000000002";
const PENDING_PROJECT = "c3c3c3c3-0000-4000-8000-000000000003";

let uow: UnitOfWork;
const clock = new SystemClock();
/* Set explicitly: the shared fixture leaves it unset, so without this the carve-out below
   would be exercised against a config that has no dashboard and would pass for the wrong
   reason. The public `prj_` form, because that is how a deployment configures it. */
const DASHBOARD = "prj_00000000000040008000000000000002";
const config = testConfig({ DASHBOARD_PROJECT_ID: DASHBOARD });

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

let limiter: InMemoryLimiter;

function meter(): DatabaseUsageMeter {
  return new DatabaseUsageMeter(uow, clock, new SendingDomains(uow, config), limiter, config);
}

async function seedDomain(projectId: string, status: ProjectDomainStatus): Promise<void> {
  const tenant = new TenantContext(projectId, "req_test", "system");
  await uow.transaction(async (tx) => {
    const domains = new ProjectDomainRepository(tx, tenant);
    const added = await domains.add({
      domain: `mail.${projectId.slice(0, 8)}.test`,
      type: ProjectDomainType.Email,
      records: [],
    });
    if (status === ProjectDomainStatus.Verified) {
      await domains.recordCheck(added.id, status, [], new Date());
    }
  });
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  // The dashboard is seeded like any other project, because it is one: the breaker applies to
  // it for the same reason it applies to a customer, and `email_sending_holds.project_id` now
  // cascades from `projects`, so a hold cannot be opened against a project that never existed.
  const dashboard = PublicId.parse(IdPrefix.Project, DASHBOARD).uuid;
  for (const project of [SHARED_PROJECT, OWN_DOMAIN_PROJECT, PENDING_PROJECT, dashboard]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [project]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [project, rows[0]?.id],
    );
  }
  await seedDomain(OWN_DOMAIN_PROJECT, ProjectDomainStatus.Verified);
  await seedDomain(PENDING_PROJECT, ProjectDomainStatus.Pending);
}, 180_000);

beforeEach(() => {
  limiter = new InMemoryLimiter();
});

afterAll(async () => {
  await harness.stop();
});

describe("the shared sender's ceiling", () => {
  it("lets a developer send a few in a row", async () => {
    for (let n = 0; n < 3; n += 1) {
      await expect(
        meter().assertWithinQuota(SHARED_PROJECT, Channel.Email),
      ).resolves.toBeUndefined();
    }
  });

  /**
   * The refusal is the whole teaching mechanism for the rule, so it is asserted as a code
   * rather than as a throw: a rate limit would say "try again later", which is true and
   * useless. This one says go and verify a domain, which is the only thing that works.
   */
  it("refuses past the burst, naming what to do about it", async () => {
    for (let n = 0; n < 3; n += 1) {
      await meter().assertWithinQuota(SHARED_PROJECT, Channel.Email);
    }
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Email)).rejects.toMatchObject({
      code: "sending_domain_required",
    });
  });

  /**
   * The distinction the control exists for. A project sending under its own verified domain
   * risks mostly its own reputation, so nothing here limits it.
   */
  it("does not limit a project with its own verified domain", async () => {
    for (let n = 0; n < 20; n += 1) {
      await expect(
        meter().assertWithinQuota(OWN_DOMAIN_PROJECT, Channel.Email),
      ).resolves.toBeUndefined();
    }
  });

  /**
   * Pending is not verified. Sending from an identity whose DNS is unconfirmed is how a
   * message arrives unsigned and fails DMARC on a domain published `p=reject` — which is
   * worse than the ceiling, because it goes silently nowhere.
   */
  it("treats a pending domain as no domain", async () => {
    for (let n = 0; n < 3; n += 1) {
      await meter().assertWithinQuota(PENDING_PROJECT, Channel.Email);
    }
    await expect(meter().assertWithinQuota(PENDING_PROJECT, Channel.Email)).rejects.toMatchObject({
      code: "sending_domain_required",
    });
  });

  /**
   * We run the panel on our own product, so our own dashboard sends real mail through this
   * path. Until it has a verified domain of its own, holding it to a developer's allowance
   * would stop our sign-ups at two hundred a day.
   */
  it("does not hold our own dashboard to a developer's allowance", async () => {
    /* The uuid, because that is what reaches this path — the config holds the public form.
       A test that passed the `prj_` value would agree with the bug it is checking for. */
    const dashboard = PublicId.parse(IdPrefix.Project, DASHBOARD).uuid;
    for (let n = 0; n < 20; n += 1) {
      await expect(meter().assertWithinQuota(dashboard, Channel.Email)).resolves.toBeUndefined();
    }
  });

  /**
   * Strictly, so a cache we cannot reach refuses rather than allows — the opposite of the
   * call sign-in makes and the same one `SmsFraudGuard` makes. An unmetered window on a
   * shared sender is the thing this control exists to prevent, so it must not be one
   * Valkey outage away.
   */
  it("refuses rather than allows when the counter is unreachable", async () => {
    limiter.broken = true;
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Email)).rejects.toThrow();
  });

  it("says nothing about SMS, which has its own controls", async () => {
    limiter.broken = true;
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Sms)).resolves.toBeUndefined();
  });
});

/**
 * The bounce-rate breaker, read on the send path (risks.md 2).
 *
 * A different control from everything above and it has to be tested as one, because the two
 * carve-outs that exempt a project from the sandbox allowance do **not** exempt it from this.
 * Mail leaves through one SES account whatever domain it is from, AWS reviews bounce and
 * complaint rates per account, and a review takes mail down for every customer at once. The
 * hold is opened by `EmailReputationBreaker` in `apps/workers`; what is asserted here is that
 * the send path reads it and refuses.
 */
describe("a project whose mail is damaging the SES account", () => {
  async function hold(projectId: string): Promise<void> {
    const tenant = new TenantContext(projectId, "req_test", "system");
    await uow.transaction((tx) =>
      new EmailSendingHoldRepository(tx, tenant).open({
        reason: HoldReason.BounceRate,
        bounceRatePpm: 90_000,
        complaintRatePpm: 0,
        observedSends: 1_000,
      }),
    );
  }

  async function release(projectId: string): Promise<void> {
    const tenant = new TenantContext(projectId, "req_test", "system");
    await uow.transaction((tx) =>
      new EmailSendingHoldRepository(tx, tenant).release("staff_1", "list cleaned"),
    );
  }

  it("refuses with its own code, which says what actually clears it", async () => {
    await hold(SHARED_PROJECT);
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Email)).rejects.toMatchObject({
      code: "sending_paused",
    });
    await release(SHARED_PROJECT);
  });

  /*
   * The case people will be surprised by, and the reason the check sits above both carve-outs.
   * A verified domain buys a project out of the *sandbox allowance* and out of nothing else:
   * the account-level bounce rate is everybody's problem, including the projects whose own
   * domains are spotless.
   */
  it("does not spare a project sending from its own verified domain", async () => {
    await expect(
      meter().assertWithinQuota(OWN_DOMAIN_PROJECT, Channel.Email),
    ).resolves.toBeUndefined();

    await hold(OWN_DOMAIN_PROJECT);
    await expect(
      meter().assertWithinQuota(OWN_DOMAIN_PROJECT, Channel.Email),
    ).rejects.toMatchObject({ code: "sending_paused" });
    await release(OWN_DOMAIN_PROJECT);
  });

  /* Nor our own dashboard, for the same reason: it sends through the same account. */
  it("does not spare our own dashboard either", async () => {
    const dashboard = PublicId.parse(IdPrefix.Project, DASHBOARD).uuid;
    await expect(meter().assertWithinQuota(dashboard, Channel.Email)).resolves.toBeUndefined();

    await hold(dashboard);
    await expect(meter().assertWithinQuota(dashboard, Channel.Email)).rejects.toMatchObject({
      code: "sending_paused",
    });
    await release(dashboard);
  });

  it("sends again once the hold is released", async () => {
    await hold(SHARED_PROJECT);
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Email)).rejects.toThrow();

    await release(SHARED_PROJECT);
    await expect(meter().assertWithinQuota(SHARED_PROJECT, Channel.Email)).resolves.toBeUndefined();
  });

  /* One project's hold is not another's: the read is tenant-scoped like every other. */
  it("stops only the project it was opened for", async () => {
    await hold(SHARED_PROJECT);
    await expect(
      meter().assertWithinQuota(PENDING_PROJECT, Channel.Email),
    ).resolves.toBeUndefined();
    await release(SHARED_PROJECT);
  });
});
