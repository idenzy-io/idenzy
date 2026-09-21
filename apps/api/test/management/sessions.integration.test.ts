import { isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { SystemClock } from "@idenzy/core/time/clock";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionsService } from "../../dist/management/sessions/sessions-service.js";

/**
 * The project-wide session list, against a real Postgres.
 *
 * The ordering and the default predicate are the two things worth pinning: an operator
 * hunting a device reads by last activity, and the screen is about what is live, so a
 * revoked session has to be absent unless it was asked for.
 */

const harness = new PostgresHarness();
const ORG = "55555555-5555-5555-5555-555555555555";
const PROJECT = "66666666-6666-6666-6666-666666666666";
const OTHER_PROJECT = "77777777-7777-7777-7777-777777777777";
const ALICE = "aaaaaaaa-1111-4000-8000-000000000001";
const BOB = "bbbbbbbb-1111-4000-8000-000000000002";

let service: SessionsService;
let publicProjectId = "";

class PassthroughScope {
  async of(_context: OrgContext, publicId: string): Promise<TenantContext> {
    const raw = publicId.slice("prj_".length);
    const dashed = [
      raw.slice(0, 8),
      raw.slice(8, 12),
      raw.slice(12, 16),
      raw.slice(16, 20),
      raw.slice(20),
    ].join("-");
    return await Promise.resolve(new TenantContext(dashed, "req_test", "customer_staff"));
  }
}

const context = { orgId: ORG } as OrgContext;
const publicOf = (uuid: string): string => `prj_${uuid.replaceAll("-", "")}`;
const sessionPublicId = (uuid: string): string => `ses_${uuid.replaceAll("-", "")}`;
const userPublicId = (uuid: string): string => `usr_${uuid.replaceAll("-", "")}`;

async function seedSession(
  projectId: string,
  userId: string,
  id: string,
  minutesAgo: number,
  deviceName: string,
): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  await harness.owner.query(
    `INSERT INTO sessions
       (id, project_id, user_id, device_name, idle_expires_at, absolute_expires_at,
        last_active_at, amr)
     VALUES ($1, $2, $3, $4, now() + interval '30 days', now() + interval '90 days',
             now() - ($5 || ' minutes')::interval, '{password}')`,
    [id, projectId, userId, deviceName, String(minutesAgo)],
  );
}

beforeAll(async () => {
  await harness.start();
  service = new SessionsService(
    new UnitOfWork(harness.db),
    new PassthroughScope() as never,
    new SystemClock(),
  );

  await harness.owner.query(
    `INSERT INTO orgs (id, name)
     VALUES ($1, 'Acme')`,
    [ORG],
  );
  for (const project of [PROJECT, OTHER_PROJECT]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [project]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [project, ORG],
    );
    for (const user of [ALICE, BOB]) {
      await harness.owner.query(
        `INSERT INTO users (id, project_id, email, email_verified)
         VALUES ($1, $2, $3, true)`,
        [project === PROJECT ? user : user.replace("1111", "2222"), project, `${user}@x.test`],
      );
    }
  }
  publicProjectId = publicOf(PROJECT);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the sessions a project's operator reads", () => {
  const PHONE = "10000000-1111-4000-8000-00000000000a";
  const LAPTOP = "10000000-1111-4000-8000-00000000000b";
  const OLD = "10000000-1111-4000-8000-00000000000c";

  it("lists them newest-active first, with the account attached", async () => {
    await seedSession(PROJECT, ALICE, LAPTOP, 60, "MacBook Pro");
    await seedSession(PROJECT, ALICE, PHONE, 5, "iPhone");
    await seedSession(PROJECT, BOB, OLD, 600, "ThinkPad");

    const page = await service.list(context, publicProjectId, {
      includeRevoked: false,
      limit: 100,
    });

    expect(page.sessions.map((s) => s.deviceName)).toEqual(["iPhone", "MacBook Pro", "ThinkPad"]);
    expect(page.sessions[0]?.userId).toBe(userPublicId(ALICE));
    expect(page.sessions[0]?.amr).toEqual(["password"]);
    // Both are honest absences rather than invented values.
    expect(page.sessions[0]?.deviceBound).toBe(false);
  });

  it("narrows to one account when asked", async () => {
    const page = await service.list(context, publicProjectId, {
      includeRevoked: false,
      limit: 100,
      userId: userPublicId(BOB),
    });
    expect(page.sessions.map((s) => s.deviceName)).toEqual(["ThinkPad"]);
  });

  it("ends the named sessions and counts only what was live", async () => {
    const ended = await service.revoke(context, publicProjectId, [
      sessionPublicId(PHONE),
      sessionPublicId(LAPTOP),
    ]);
    expect(ended).toBe(2);

    // Pressed twice, by two people looking at the same incident: the second must not be
    // told it ended anything.
    expect(await service.revoke(context, publicProjectId, [sessionPublicId(PHONE)])).toBe(0);
  });

  it("hides revoked sessions by default and shows them when asked", async () => {
    const live = await service.list(context, publicProjectId, {
      includeRevoked: false,
      limit: 100,
    });
    expect(live.sessions.map((s) => s.deviceName)).toEqual(["ThinkPad"]);

    const all = await service.list(context, publicProjectId, {
      includeRevoked: true,
      limit: 100,
    });
    expect(all.sessions).toHaveLength(3);
    const phone = all.sessions.find((s) => s.deviceName === "iPhone");
    expect(phone?.revokedAt).not.toBeNull();
    expect(phone?.revokeReason).toBe("admin_revoked");
  });

  it("pages by last activity with a cursor", async () => {
    const first = await service.list(context, publicProjectId, {
      includeRevoked: true,
      limit: 1,
    });
    expect(first.sessions).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list(context, publicProjectId, {
      includeRevoked: true,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.sessions[0]?.id).not.toBe(first.sessions[0]?.id);
  });

  /** The case the rest cannot see: one project must not end another's sessions. */
  it("cannot revoke a session belonging to another project", async () => {
    const theirs = "20000000-2222-4000-8000-00000000000f";
    await seedSession(OTHER_PROJECT, ALICE.replace("1111", "2222"), theirs, 1, "Intruder");

    const ended = await service.revoke(context, publicProjectId, [sessionPublicId(theirs)]);
    expect(ended).toBe(0);

    const ours = await service.list(context, publicProjectId, {
      includeRevoked: true,
      limit: 100,
    });
    expect(ours.sessions.map((s) => s.deviceName)).not.toContain("Intruder");

    // Still live under its own scope, so the refusal above is isolation not a bad seed.
    const theirPage = await service.list(context, publicOf(OTHER_PROJECT), {
      includeRevoked: false,
      limit: 100,
    });
    expect(theirPage.sessions.map((s) => s.deviceName)).toContain("Intruder");
  });

  it("refuses a session id that is not one", async () => {
    await expect(service.revoke(context, publicProjectId, ["not-an-id"])).rejects.toSatisfy(
      isIdenzyError,
    );
  });
});
