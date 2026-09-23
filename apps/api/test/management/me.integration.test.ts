import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { InMemoryKeyValue } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { OrgBalanceReader } from "../../dist/management/billing/org-balance-reader.js";
import { MeService } from "../../dist/management/me/me-service.js";
import { SilentLogger } from "./fixtures.js";

/**
 * What a visit loads: `GET /v1/me`, and the balance on it (ADR-0017).
 *
 * The balance is the wallet's headline, so it goes to the people the wallet answers — owners and
 * admins — and to nobody else, whatever else the same person can see.
 */
const harness = new PostgresHarness();
const USER = "12121212-0000-4000-8000-000000000001";
const ADMIN_ORG = "34343434-0000-4000-8000-000000000002";
const VIEWER_ORG = "56565656-0000-4000-8000-000000000003";
let me: MeService;
const store = new InMemoryKeyValue();

beforeAll(async () => {
  await harness.start();
  const uow = new UnitOfWork(harness.db);
  for (const [org, role] of [
    [ADMIN_ORG, "admin"],
    [VIEWER_ORG, "viewer"],
  ] as const) {
    await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Org')`, [org]);
    await harness.owner.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)`,
      [org, USER, role],
    );
  }
  const cache = new LiveBalanceCache(store);
  me = new MeService(
    uow,
    new OrgMembershipReader(harness.db),
    new OrgBalanceReader(uow, cache, new SystemClock(), new SilentLogger()),
  );
  await cache.putLive(ADMIN_ORG, {
    mode: "prepaid",
    balanceCents: 1234,
    pendingCents: 66,
    asOf: Date.now(),
  });
  await cache.putLive(VIEWER_ORG, {
    mode: "prepaid",
    balanceCents: 999,
    pendingCents: 1,
    asOf: Date.now(),
  });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the balance on /v1/me", () => {
  it("carries the live balance of an organisation the caller administers", async () => {
    const loaded = await me.load(USER, "req_me");
    expect(loaded.balances).toEqual([
      expect.objectContaining({
        orgId: PublicId.encode(IdPrefix.Org, ADMIN_ORG).value,
        mode: "prepaid",
        balanceCents: 1234,
        pendingCents: 66,
        live: true,
      }),
    ]);
  });

  it("carries none for an organisation where the caller may not see billing", async () => {
    const loaded = await me.load(USER, "req_me");
    const viewer = PublicId.encode(IdPrefix.Org, VIEWER_ORG).value;
    expect(loaded.organisations.map((org) => org.id)).toContain(viewer);
    expect(loaded.balances.map((balance) => balance.orgId)).not.toContain(viewer);
  });
});
