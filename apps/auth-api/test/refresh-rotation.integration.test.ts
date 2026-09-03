import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RefreshService } from "../dist/session/refresh-service.js";
import { SessionService } from "../dist/session/session-service.js";
import { SilentLogger, testConfig } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const clock = new SystemClock();
const config = testConfig();

let uow: UnitOfWork;
let sessions: SessionService;
let refresh: RefreshService;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_integration",
  ip: "203.0.113.9",
  userAgent: "vitest",
};

const tenant = new TenantContext(PROJECT, "req_integration", "user");

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  sessions = new SessionService(uow, clock, issuer, config);
  refresh = new RefreshService(uow, clock, sessions, config, new SilentLogger());

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
     VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function signIn(
  email: string,
): Promise<{ userId: string; refreshToken: string; sessionId: string }> {
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO users (project_id, email, email_verified) VALUES ($1, $2, true) RETURNING id`,
    [PROJECT, email],
  );
  const userId = rows[0]?.id ?? "";
  const issued = await sessions.issueSession(context, {
    userId,
    amr: [AuthMethod.Password],
    requiresMfa: false,
  });
  return { userId, refreshToken: issued.refreshToken, sessionId: issued.sessionId };
}

function sessionRow(sessionId: string) {
  return uow.run(tenant, (tx) => new SessionRepository(tx, tenant).findById(sessionId));
}

describe("issuing a session", () => {
  it("writes the session, the first refresh token and the event in one transaction", async () => {
    const { userId, sessionId } = await signIn("issue@a.test");

    const counts = await uow.run(tenant, async (tx) => {
      const tokens = await tx.execute<{ count: string }>(
        sql`select count(*) from refresh_tokens where session_id = ${sessionId}::uuid`,
      );
      const events = await tx.execute<{ count: string }>(
        sql`select count(*) from outbox where topic = 'session.created'`,
      );
      const signedIn = await tx.execute<{ last_sign_in_at: Date | null }>(
        sql`select last_sign_in_at from users where id = ${userId}::uuid`,
      );
      return {
        tokens: Number(tokens.rows[0]?.count),
        events: Number(events.rows[0]?.count),
        signedIn: signedIn.rows[0]?.last_sign_in_at,
      };
    });

    expect(counts.tokens).toBe(1);
    expect(counts.events).toBeGreaterThan(0);
    expect(counts.signedIn).not.toBeNull();
  });

  it("mints an access token whose claims are public ids, not row keys", async () => {
    const { userId } = await signIn("claims@a.test");
    const issued = await sessions.issueSession(context, {
      userId,
      amr: [AuthMethod.Password],
      requiresMfa: false,
    });
    const claims = JSON.parse(
      Buffer.from(issued.accessToken.split(".")[1] ?? "", "base64url").toString(),
    ) as { sub: string; sid: string; aud: string; iss: string; amr: string[] };

    expect(claims.sub).toMatch(/^usr_[0-9a-f]{32}$/);
    expect(claims.sid).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(claims.aud).toMatch(/^prj_[0-9a-f]{32}$/);
    expect(claims.iss).toBe("https://auth.example.test");
    expect(claims.amr).toEqual([AuthMethod.Password]);
    expect(issued.accessToken).not.toContain(userId);
  });
});

describe("rotation", () => {
  it("returns a new pair and invalidates the old token", async () => {
    const { refreshToken } = await signIn("rotate@a.test");
    const rotated = await refresh.rotate(context, refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);
    expect(rotated.accessToken.split(".")).toHaveLength(3);
  });

  it("keeps the session alive across rotations", async () => {
    const { refreshToken, sessionId } = await signIn("chain@a.test");
    const first = await refresh.rotate(context, refreshToken);
    const second = await refresh.rotate(context, first.refreshToken);
    expect(second.sessionId).toBe(sessionId);
  });

  it("rejects a token that was never issued", async () => {
    await expect(refresh.rotate(context, "not-a-real-token")).rejects.toMatchObject({
      code: "refresh_token_invalid",
    });
  });
});

/**
 * The attack test PROJECT.md 7.4 requires for this path. It asserts that replaying a
 * rotated token fails and takes the whole family with it, not that the happy path works.
 */
describe("reuse detection", () => {
  it("revokes the family and the session when a rotated token is replayed", async () => {
    const { refreshToken, sessionId } = await signIn("reuse@a.test");
    await refresh.rotate(context, refreshToken);

    await expect(refresh.rotate(context, refreshToken)).rejects.toMatchObject({
      code: "refresh_token_reused",
      status: 401,
    });

    // The revocations must survive the thrown error, which is why they are committed
    // before it is raised rather than inside the transaction that throws.
    const session = await sessionRow(sessionId);
    expect(session?.isRevoked()).toBe(true);

    const revoked = await uow.run(tenant, (tx) =>
      tx.execute<{ count: string }>(
        sql`select count(*) from refresh_tokens
            where session_id = ${sessionId}::uuid and revoked_at is null`,
      ),
    );
    expect(Number(revoked.rows[0]?.count)).toBe(0);
  });

  it("stops the successor token working once the family is revoked", async () => {
    const { refreshToken } = await signIn("successor@a.test");
    const rotated = await refresh.rotate(context, refreshToken);
    await expect(refresh.rotate(context, refreshToken)).rejects.toThrow();

    await expect(refresh.rotate(context, rotated.refreshToken)).rejects.toMatchObject({
      code: "refresh_token_invalid",
    });
  });

  it("records the reuse as a security event, not only as a failed request", async () => {
    const { refreshToken } = await signIn("event@a.test");
    await refresh.rotate(context, refreshToken);
    await expect(refresh.rotate(context, refreshToken)).rejects.toThrow();

    const events = await uow.run(tenant, (tx) =>
      tx.execute<{ count: string }>(
        sql`select count(*) from outbox where topic = 'security.refresh_token_reused'`,
      ),
    );
    expect(Number(events.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("refuses to rotate for a session that was signed out", async () => {
    const { refreshToken, sessionId } = await signIn("signed-out@a.test");
    await sessions.signOut(context, refreshToken, "current");

    const session = await sessionRow(sessionId);
    expect(session?.isRevoked()).toBe(true);
    await expect(refresh.rotate(context, refreshToken)).rejects.toMatchObject({
      code: "refresh_token_invalid",
    });
  });

  it("ends every session when signing out everywhere", async () => {
    const { userId, refreshToken } = await signIn("all@a.test");
    await sessions.issueSession(context, {
      userId,
      amr: [AuthMethod.Password],
      requiresMfa: false,
    });

    await sessions.signOut(context, refreshToken, "all");
    const list = await uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).listForUser(userId),
    );
    expect(list).toHaveLength(2);
    expect(list.every((row) => row.revokedAt !== null)).toBe(true);
    expect(list.every((row) => row.revokeReason === SessionRevokeReason.SignedOutEverywhere)).toBe(
      true,
    );
  });
});
