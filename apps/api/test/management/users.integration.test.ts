import { isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { SystemClock } from "@idenzy/core/time/clock";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { UsersService } from "../../dist/management/users/users-service.js";

/**
 * What the Users screen reads and writes, against a real Postgres.
 *
 * Three of the things this service returns are not columns — the ways in, whether an
 * authenticator is enrolled, and how many sessions are live — so they can only be checked
 * against a database that actually holds the rows they are derived from. A fake would agree
 * with whatever the derivation happened to be.
 *
 * The case that matters most is the last one. Everything above it could pass while the
 * service still read across tenants, because a single-project fixture cannot tell the
 * difference.
 */

const harness = new PostgresHarness();
const ORG = "44444444-4444-4444-4444-444444444444";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER_PROJECT = "33333333-3333-3333-3333-333333333333";

let uow: UnitOfWork;
let service: UsersService;
let publicProjectId = "";
let publicOtherProjectId = "";

/** Resolves whichever project it is asked for, so a cross-tenant read is even possible. */
class PassthroughScope {
  async of(_context: OrgContext, publicId: string): Promise<TenantContext> {
    const uuid = publicId.slice("prj_".length);
    const dashed = [
      uuid.slice(0, 8),
      uuid.slice(8, 12),
      uuid.slice(12, 16),
      uuid.slice(16, 20),
      uuid.slice(20),
    ].join("-");
    return await Promise.resolve(new TenantContext(dashed, "req_test", "customer_staff"));
  }
}

const context = { orgId: ORG } as OrgContext;

const publicOf = (uuid: string): string => `prj_${uuid.replaceAll("-", "")}`;
const userPublicId = (uuid: string): string => `usr_${uuid.replaceAll("-", "")}`;

async function seedUser(
  projectId: string,
  id: string,
  fields: { email?: string | null; phone?: string | null; password?: boolean } = {},
): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  await harness.owner.query(
    `INSERT INTO users (id, project_id, email, phone, password_hash, email_verified)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [
      id,
      projectId,
      fields.email ?? null,
      fields.phone ?? null,
      fields.password === true ? "$argon2id$fake" : null,
    ],
  );
}

async function seedSession(projectId: string, userId: string, id: string): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  await harness.owner.query(
    `INSERT INTO sessions
       (id, project_id, user_id, idle_expires_at, absolute_expires_at, last_active_at, amr)
     VALUES ($1, $2, $3, now() + interval '30 days', now() + interval '90 days', now(), '{}')`,
    [id, projectId, userId],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  service = new UsersService(uow, new PassthroughScope() as never, new SystemClock());

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
  }
  publicProjectId = publicOf(PROJECT);
  publicOtherProjectId = publicOf(OTHER_PROJECT);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the users a screen reads", () => {
  const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
  const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
  const INTRUDER = "cccccccc-0000-4000-8000-000000000003";

  it("lists them with the fields that are not columns", async () => {
    await seedUser(PROJECT, ALICE, { email: "alice@example.test", password: true });
    await seedSession(PROJECT, ALICE, "11111111-0000-4000-8000-00000000000a");
    await seedSession(PROJECT, ALICE, "11111111-0000-4000-8000-00000000000b");

    const page = await service.list(context, publicProjectId, { limit: 50 });
    const alice = page.users.find((user) => user.email === "alice@example.test");

    expect(alice).toBeDefined();
    expect(alice?.id).toBe(userPublicId(ALICE));
    expect(alice?.projectId).toBe(publicProjectId);
    // A password hash and an address, so three ways in and no passkey or provider.
    expect(alice?.methods).toEqual(["email_otp", "magic_link", "password"]);
    expect(alice?.mfaEnabled).toBe(false);
    expect(alice?.activeSessions).toBe(2);
  });

  it("calls an account with nothing on it anonymous", async () => {
    await seedUser(PROJECT, BOB, {});
    const found = await service.find(context, publicProjectId, userPublicId(BOB));
    expect(found.methods).toEqual(["anonymous"]);
    expect(found.activeSessions).toBe(0);
  });

  it("suspends and restores, and answers with the row the database now holds", async () => {
    const until = new Date(Date.now() + 86_400_000);
    const suspended = await service.suspend(context, publicProjectId, userPublicId(BOB), until);
    expect(suspended.bannedUntil).not.toBeNull();

    const restored = await service.restore(context, publicProjectId, userPublicId(BOB));
    expect(restored.bannedUntil).toBeNull();
  });

  /**
   * Suspension deliberately leaves the sessions alone — it is read on rotation, so an
   * access token already issued keeps working for up to its own lifetime. A test says so,
   * because the alternative reading ("suspend also signs them out") is the one a screen
   * would quietly promise.
   */
  it("leaves live sessions alone when an account is suspended", async () => {
    const until = new Date(Date.now() + 86_400_000);
    await service.suspend(context, publicProjectId, userPublicId(ALICE), until);
    const after = await service.find(context, publicProjectId, userPublicId(ALICE));
    expect(after.activeSessions).toBe(2);
    await service.restore(context, publicProjectId, userPublicId(ALICE));
  });

  it("revokes every session and reports how many it ended", async () => {
    const revoked = await service.revokeSessions(context, publicProjectId, userPublicId(ALICE));
    expect(revoked).toBe(2);

    const after = await service.find(context, publicProjectId, userPublicId(ALICE));
    expect(after.activeSessions).toBe(0);

    // The rows survive with a reason, because a session that vanished would take its own
    // audit trail with it.
    const sessions = await service.sessions(context, publicProjectId, userPublicId(ALICE));
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(sessions.every((session) => session.revokeReason === "admin_revoked")).toBe(true);
  });

  it("reports zero rather than failing when there was nothing to revoke", async () => {
    expect(await service.revokeSessions(context, publicProjectId, userPublicId(ALICE))).toBe(0);
  });

  it("answers not-found for a user id that is not one of ours", async () => {
    const missing = userPublicId("dddddddd-0000-4000-8000-00000000000d");
    await expect(service.find(context, publicProjectId, missing)).rejects.toSatisfy(isIdenzyError);
  });

  /**
   * The case the rest cannot see. Everything above passes just as well against a service
   * that ignores the tenant entirely, because there is only ever one project in play.
   */
  it("cannot see another project's users, even when asked for one by id", async () => {
    await seedUser(OTHER_PROJECT, INTRUDER, { email: "intruder@example.test", password: true });

    const ours = await service.list(context, publicProjectId, { limit: 100 });
    expect(ours.users.map((user) => user.email)).not.toContain("intruder@example.test");

    // Naming the id directly, under our own project's scope, is the attack the row policy
    // is there for: it must be not-found rather than found-and-refused.
    await expect(service.find(context, publicProjectId, userPublicId(INTRUDER))).rejects.toSatisfy(
      isIdenzyError,
    );

    // And it is genuinely there, under its own scope — so the refusal above is isolation
    // and not a seeding mistake.
    const theirs = await service.find(context, publicOtherProjectId, userPublicId(INTRUDER));
    expect(theirs.email).toBe("intruder@example.test");
  });

  it("pages with a cursor rather than an offset", async () => {
    const first = await service.list(context, publicProjectId, { limit: 1 });
    expect(first.users).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list(context, publicProjectId, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.users[0]?.id).not.toBe(first.users[0]?.id);
  });

  it("finds an account by any of the three things a customer might quote", async () => {
    for (const term of ["alice@example.test", "ALICE", "example.test"]) {
      const page = await service.list(context, publicProjectId, { limit: 50, search: term });
      expect(page.users.map((user) => user.email)).toContain("alice@example.test");
    }
  });

  /** `_` is a LIKE wildcard, so an unescaped search would match far more than it named. */
  it("treats wildcard characters in a search as literals", async () => {
    const page = await service.list(context, publicProjectId, { limit: 50, search: "alice_" });
    expect(page.users).toHaveLength(0);
  });
});
