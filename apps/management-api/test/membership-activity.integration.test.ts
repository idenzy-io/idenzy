import { Logger } from "@idenzy/core/logging/logger";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { MembershipGuard, REQUIRES_ROLE } from "../dist/tenancy/membership.guard.js";

/**
 * Recording that a member was here, against a real Postgres and its real policies.
 *
 * The bound itself is a pure function with its own test; what needs a database is
 * everything around it. The stamp is written through `OrgMemberRepository` under
 * `app.org_id`, while the read that decides whether to write comes back from
 * `resolve_org_membership`, which is SECURITY DEFINER precisely because it runs before
 * that key is bound. Migration 0053 had to drop and recreate that function to widen its
 * return type, and privileges do not survive a drop — so if its GRANT were forgotten,
 * `idenzy_app` would lose its only membership lookup and every dashboard request would
 * answer as though the caller were in no organisation at all. A fake reader would agree
 * with whatever the guard believed.
 */

const harness = new PostgresHarness();
const ORG = "55555555-5555-5555-5555-555555555555";
const USER = "66666666-6666-6666-6666-666666666666";
const MEMBER = "77777777-7777-7777-7777-777777777777";

let uow: UnitOfWork;
let guard: MembershipGuard;

const orgPublicId = `org_${ORG.replaceAll("-", "")}`;
const userPublicId = `usr_${USER.replaceAll("-", "")}`;

/** Says whoever the test asks for is signed in. What it proves is tested elsewhere. */
const verifier = {
  verifyRequest: () =>
    Promise.resolve({
      userId: userPublicId,
      sessionId: "ses_1",
      projectId: "prj_1",
      amr: [],
      issuedAt: new Date(),
      expiresAt: new Date(),
      factorVerifiedSecondsAgo: null,
      claims: {},
    }),
};

class SilentLogger extends Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  override child(): Logger {
    return this;
  }
}

/** Answers one required role, which is the only metadata the guard reads. */
class FixedReflector extends Reflector {
  constructor(private readonly required: MemberRole | undefined) {
    super();
  }
  override getAllAndOverride<T>(key: unknown): T {
    return (key === REQUIRES_ROLE ? this.required : undefined) as T;
  }
}

function executionContext(request: Record<string, unknown>): never {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

async function activate(required: MemberRole): Promise<Record<string, unknown>> {
  const request = { id: "req_activity", params: { orgId: orgPublicId }, headers: {} };
  guard = new MembershipGuard(
    verifier as never,
    new OrgMembershipReader(harness.db),
    new FixedReflector(required),
    uow,
    new SilentLogger(),
  );
  await guard.canActivate(executionContext(request));
  return request;
}

async function storedStamp(): Promise<Date | null> {
  await harness.owner.query(`SELECT set_config('app.org_id', $1, false)`, [ORG]);
  const { rows } = await harness.owner.query<{ last_active_at: Date | null }>(
    `SELECT last_active_at FROM org_members WHERE id = $1`,
    [MEMBER],
  );
  return rows[0]?.last_active_at ?? null;
}

async function setStamp(value: string | null): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.org_id', $1, false)`, [ORG]);
  await harness.owner.query(`UPDATE org_members SET last_active_at = $2 WHERE id = $1`, [
    MEMBER,
    value,
  ]);
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
     VALUES ($1, 'Acme', (SELECT id FROM region_cells LIMIT 1))`,
    [ORG],
  );
  await harness.owner.query(`SELECT set_config('app.org_id', $1, false)`, [ORG]);
  await harness.owner.query(
    `INSERT INTO org_members (id, org_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
    [MEMBER, ORG, USER],
  );
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

describe("recording that a member was here", () => {
  it("stamps a seat that has never been used", async () => {
    await setStamp(null);
    expect(await storedStamp()).toBeNull();

    await activate(MemberRole.Viewer);

    const stamped = await storedStamp();
    expect(stamped).not.toBeNull();
    expect(Date.now() - (stamped?.getTime() ?? 0)).toBeLessThan(60_000);
  });

  /**
   * The bound, observed rather than reasoned about: the second request must leave the
   * row exactly as the first did. Asserting the value is unchanged is what catches a
   * write that happened anyway, which a count of rows never would.
   */
  it("leaves the row alone on the next request that day", async () => {
    await setStamp(null);
    await activate(MemberRole.Viewer);
    const first = await storedStamp();

    await activate(MemberRole.Viewer);
    expect((await storedStamp())?.getTime()).toBe(first?.getTime());
  });

  it("stamps again once the day has passed", async () => {
    await setStamp("2026-09-01T00:00:00Z");
    await activate(MemberRole.Viewer);

    const stamped = await storedStamp();
    expect(Date.now() - (stamped?.getTime() ?? 0)).toBeLessThan(60_000);
  });

  /**
   * A request that is about to be refused has not shown the seat to be in use. Stamping
   * before the role check would make a caller who may do nothing here look, on the one
   * screen that reports exactly this, like one who did something.
   */
  it("does not stamp a request it is about to refuse", async () => {
    await setStamp(null);
    await expect(activate(MemberRole.Owner)).resolves.toBeDefined();
    expect(await storedStamp()).not.toBeNull();

    await setStamp(null);
    await harness.owner.query(`UPDATE org_members SET role = 'viewer' WHERE id = $1`, [MEMBER]);
    await expect(activate(MemberRole.Owner)).rejects.toMatchObject({ code: "insufficient_scope" });
    expect(await storedStamp()).toBeNull();
    await harness.owner.query(`UPDATE org_members SET role = 'owner' WHERE id = $1`, [MEMBER]);
  });
});
