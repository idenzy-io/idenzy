import { Clock } from "@idenzy/core/time/clock";
import { RefreshOutcome } from "@idenzy/domain/entities/refresh-token-family";
import { RefreshTokenRepository } from "@idenzy/persistence/repository/refresh-token-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

let uow: UnitOfWork;

class RealClock extends Clock {
  override now(): Date {
    return new Date();
  }
}
const clock = new RealClock();

interface Repos {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly refresh: RefreshTokenRepository;
}

/** Everything a request would do: one transaction, one tenant bound to the connection. */
function inTenant<T>(projectId: string, work: (repos: Repos) => Promise<T>): Promise<T> {
  const context = new TenantContext(projectId, "req_test", "user");
  return uow.transaction((tx) =>
    work({
      users: new UserRepository(tx, context),
      sessions: new SessionRepository(tx, context),
      refresh: new RefreshTokenRepository(tx, context),
    }),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  const orgId = rows[0]?.id;

  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [projectId, orgId],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

function newUser(email: string) {
  return {
    email,
    emailVerified: false,
    phone: null,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$stub",
    passwordAlgoVersion: 1,
    displayName: null,
    avatarUrl: null,
  };
}

function seedSession(
  projectId: string,
  email: string,
): Promise<{
  userId: string;
  sessionId: string;
}> {
  return inTenant(projectId, async (repos) => {
    const user = await repos.users.create(newUser(email));
    const session = await repos.sessions.create({
      userId: user.id,
      amr: [AuthMethod.Password],
      ip: "203.0.113.7",
      userAgent: "vitest",
      deviceId: null,
      deviceName: null,
      factorVerifiedAt: null,
      idleExpiresAt: clock.inSeconds(3600),
      absoluteExpiresAt: clock.inSeconds(86_400),
    });
    return { userId: user.id, sessionId: session.id };
  });
}

describe("UserRepository", () => {
  it("round-trips a user through the entity", async () => {
    const found = await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.users.create(newUser("round-trip@a.test"));
      return repos.users.findById(created.id);
    });
    expect(found?.email).toBe("round-trip@a.test");
    expect(found?.hasPassword()).toBe(true);
    expect(found?.isAnonymous()).toBe(false);
  });

  // The repository predicate is the only thing separating these two tenants now. It used to
  // agree with a row policy underneath; this asserts what is actually left.
  it("cannot see another tenant's user", async () => {
    await inTenant(PROJECT_A, (repos) => repos.users.create(newUser("isolated@a.test")));
    const leaked = await inTenant(PROJECT_B, (repos) => repos.users.findByEmail("isolated@a.test"));
    expect(leaked).toBeNull();
  });

  it("refuses a duplicate address within a project as a conflict, not a 500", async () => {
    await inTenant(PROJECT_A, (repos) => repos.users.create(newUser("dupe@a.test")));
    await expect(
      inTenant(PROJECT_A, (repos) => repos.users.create(newUser("dupe@a.test"))),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lets the same address exist in two projects", async () => {
    await inTenant(PROJECT_A, (repos) => repos.users.create(newUser("shared@x.test")));
    const other = await inTenant(PROJECT_B, (repos) =>
      repos.users.create(newUser("shared@x.test")),
    );
    expect(other.email).toBe("shared@x.test");
  });

  /**
   * The event is the repository's, not the flow's.
   *
   * Six paths create a user and a seventh will be written by somebody who never reads this: an event
   * each of them has to remember is one a new sign-in method ships without. Here it cannot be missed,
   * and it is in the transaction that made the user, so a rollback takes the announcement with it.
   */
  it("announces a created user in the same transaction", async () => {
    const created = await inTenant(PROJECT_A, (repos) =>
      repos.users.create(newUser("event@a.test")),
    );

    const { rows } = await harness.owner.query<{ topic: string; payload: Record<string, unknown> }>(
      "SELECT topic, payload FROM outbox WHERE project_id = $1 AND topic = 'user.created'",
      [PROJECT_A],
    );
    const written = rows.filter((row) => row.payload["userId"] === created.id);
    expect(written).toHaveLength(1);
    expect(written[0]?.payload["email"]).toBe("event@a.test");
    expect(written[0]?.payload["emailVerified"]).toBe(false);
  });

  it("announces nothing when the transaction that created the user rolls back", async () => {
    const { rows: before } = await harness.owner.query<{ count: string }>(
      "SELECT count(*) FROM outbox WHERE topic = 'user.created'",
    );

    // The second insert conflicts on the unique address, which takes the whole transaction — the user
    // and its event — with it. An enqueue after the commit could not have that property.
    await expect(
      inTenant(PROJECT_A, async (repos) => {
        await repos.users.create(newUser("rolled-back@a.test"));
        await repos.users.create(newUser("rolled-back@a.test"));
      }),
    ).rejects.toMatchObject({ status: 409 });

    const { rows: after } = await harness.owner.query<{ count: string }>(
      "SELECT count(*) FROM outbox WHERE topic = 'user.created'",
    );
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it("upgrades an anonymous account in place, keeping the id", async () => {
    const { id, upgraded } = await inTenant(PROJECT_A, async (repos) => {
      const anon = await repos.users.create({
        email: null,
        emailVerified: false,
        phone: null,
        passwordHash: null,
        passwordAlgoVersion: null,
        displayName: null,
        avatarUrl: null,
      });
      expect(anon.isAnonymous()).toBe(true);
      const result = await repos.users.attachCredentials(anon.id, "upgraded@a.test", "$hash", 1);
      return { id: anon.id, upgraded: result };
    });
    expect(upgraded.id).toBe(id);
    expect(upgraded.isAnonymous()).toBe(false);
    expect(upgraded.emailVerified).toBe(false);
  });
});

describe("SessionRepository", () => {
  it("lists a user's sessions, most recently active first", async () => {
    const { userId } = await seedSession(PROJECT_A, "lister@a.test");
    const list = await inTenant(PROJECT_A, (repos) => repos.sessions.listForUser(userId));
    expect(list).toHaveLength(1);
    expect(list[0]?.amr).toEqual([AuthMethod.Password]);
  });

  it("records why a session ended", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "revoked@a.test");
    const session = await inTenant(PROJECT_A, async (repos) => {
      await repos.sessions.revoke(sessionId, SessionRevokeReason.SignedOut, new Date());
      return repos.sessions.findById(sessionId);
    });
    expect(session?.isRevoked()).toBe(true);
    expect(session?.isUsable(clock)).toBe(false);
  });

  // A password change ends every other session without logging out the device that
  // performed it, which is the only reason exceptId exists.
  it("signs out everywhere except the caller's own session", async () => {
    const { userId, sessionId } = await seedSession(PROJECT_A, "everywhere@a.test");
    const surviving = await inTenant(PROJECT_A, async (repos) => {
      await repos.sessions.create({
        userId,
        amr: [AuthMethod.Password],
        ip: null,
        userAgent: null,
        deviceId: null,
        deviceName: null,
        factorVerifiedAt: null,
        idleExpiresAt: clock.inSeconds(3600),
        absoluteExpiresAt: clock.inSeconds(86_400),
      });
      const revoked = await repos.sessions.revokeAllForUser(
        userId,
        SessionRevokeReason.PasswordChanged,
        new Date(),
        sessionId,
      );
      expect(revoked).toHaveLength(1);
      return repos.sessions.findById(sessionId);
    });
    expect(surviving?.isRevoked()).toBe(false);
  });
});

describe("refresh token rotation", () => {
  function issueToken(projectId: string, sessionId: string, familyId: string, hash: string) {
    return inTenant(projectId, (repos) =>
      repos.refresh.issue({
        sessionId,
        familyId,
        tokenHash: hash,
        parentId: null,
        expiresAt: clock.inSeconds(2_592_000),
      }),
    );
  }

  it("consumes a token exactly once", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "rotate@a.test");
    const familyId = crypto.randomUUID();
    const id = await issueToken(PROJECT_A, sessionId, familyId, "hash-rotate");

    const first = await inTenant(PROJECT_A, (repos) => repos.refresh.consume(id, new Date()));
    const second = await inTenant(PROJECT_A, (repos) => repos.refresh.consume(id, new Date()));
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  /**
   * The attack this design exists for (PROJECT.md 4.2, 7.4). Two requests present the
   * same token at once, so both can pass a read-then-check a moment apart. Only one
   * UPDATE can match `used_at is null`, and the loser must be treated as reuse. Without
   * the predicate this race is a real bypass of reuse detection.
   */
  it("lets only one of two concurrent presentations win", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "race@a.test");
    const familyId = crypto.randomUUID();
    const id = await issueToken(PROJECT_A, sessionId, familyId, "hash-race");

    const outcomes = await Promise.all([
      inTenant(PROJECT_A, (repos) => repos.refresh.consume(id, new Date())),
      inTenant(PROJECT_A, (repos) => repos.refresh.consume(id, new Date())),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("reports a replayed token as reuse rather than as expiry", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "replay@a.test");
    const familyId = crypto.randomUUID();
    const id = await issueToken(PROJECT_A, sessionId, familyId, "hash-replay");

    const outcome = await inTenant(PROJECT_A, async (repos) => {
      await repos.refresh.consume(id, new Date());
      const state = await repos.refresh.findByHash("hash-replay");
      return repos.refresh.family(state!).evaluate(clock);
    });
    expect(outcome).toBe(RefreshOutcome.Reuse);
  });

  it("revokes every sibling when the family is compromised", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "family@a.test");
    const familyId = crypto.randomUUID();
    await issueToken(PROJECT_A, sessionId, familyId, "hash-family-1");
    await issueToken(PROJECT_A, sessionId, familyId, "hash-family-2");

    const revoked = await inTenant(PROJECT_A, (repos) =>
      repos.refresh.revokeFamily(familyId, new Date()),
    );
    expect(revoked).toBe(2);

    const state = await inTenant(PROJECT_A, (repos) => repos.refresh.findByHash("hash-family-2"));
    expect(state?.revokedAt).not.toBeNull();
  });

  it("cannot be found from another tenant, even with the exact hash", async () => {
    const { sessionId } = await seedSession(PROJECT_A, "cross@a.test");
    await issueToken(PROJECT_A, sessionId, crypto.randomUUID(), "hash-cross-tenant");
    const leaked = await inTenant(PROJECT_B, (repos) =>
      repos.refresh.findByHash("hash-cross-tenant"),
    );
    expect(leaked).toBeNull();
  });
});
