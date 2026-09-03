import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { IssuerTokenVerifier } from "@idenzy/crypto/tokens/token-verifier";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionPrincipal } from "../dist/session/session.guard.js";
import { SessionService } from "../dist/session/session-service.js";
import { testConfig } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const clock = new SystemClock();
const config = testConfig();

let uow: UnitOfWork;
let sessions: SessionService;
let verifier: IssuerTokenVerifier;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_sessions",
  ip: "203.0.113.20",
  userAgent: "vitest",
  locale: "en",
};
const tenant = new TenantContext(PROJECT, "req_sessions", "user");

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  verifier = new IssuerTokenVerifier(issuer, config.get("ISSUER_BASE_URL"));
  sessions = new SessionService(uow, clock, issuer, config);

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

async function newUser(email: string): Promise<string> {
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO users (project_id, email, email_verified) VALUES ($1, $2, true) RETURNING id`,
    [PROJECT, email],
  );
  return rows[0]?.id ?? "";
}

async function signIn(userId: string): Promise<{ sessionId: string; accessToken: string }> {
  const issued = await sessions.issueSession(context, {
    userId,
    amr: [AuthMethod.Password],
    requiresMfa: false,
  });
  return { sessionId: issued.sessionId, accessToken: issued.accessToken };
}

function principal(userId: string, sessionId: string): SessionPrincipal {
  return { userId, sessionId, amr: [AuthMethod.Password] };
}

describe("the access token a session issues", () => {
  it("verifies against the issuer's published keys", async () => {
    const userId = await newUser("verify@a.test");
    const { accessToken, sessionId } = await signIn(userId);

    const verified = await verifier.verify(accessToken);
    expect(verified.sessionId).toMatch(/^ses_/);
    expect(verified.audience).toMatch(/^prj_/);
    expect(verified.sessionId.slice(4)).toBe(sessionId.replaceAll("-", ""));
  });
});

describe("listing sessions", () => {
  it("shows the caller's own sessions and marks the current one", async () => {
    const userId = await newUser("list@a.test");
    const first = await signIn(userId);
    const second = await signIn(userId);

    const list = await sessions.listSessions(context, principal(userId, second.sessionId));
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((row) => row.current)).toHaveLength(1);
    expect(list.sessions.find((row) => row.current)?.id.slice(4)).toBe(
      second.sessionId.replaceAll("-", ""),
    );
    expect(list.sessions.map((row) => row.id)).toContain(
      `ses_${first.sessionId.replaceAll("-", "")}`,
    );
  });

  it("keeps revoked sessions in the list, because the history is the point", async () => {
    const userId = await newUser("history@a.test");
    const only = await signIn(userId);
    await sessions.revokeSession(context, principal(userId, only.sessionId), only.sessionId);

    const list = await sessions.listSessions(context, principal(userId, only.sessionId));
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0]?.revokedAt).not.toBeNull();
    expect(list.sessions[0]?.revokeReason).toBe("signed_out");
  });

  it("never shows another user's sessions", async () => {
    const alice = await newUser("alice@a.test");
    const bob = await newUser("bob@a.test");
    const aliceSession = await signIn(alice);
    await signIn(bob);

    const list = await sessions.listSessions(context, principal(alice, aliceSession.sessionId));
    expect(list.sessions).toHaveLength(1);
  });
});

/**
 * The attack this scoping exists for: a valid session used to revoke someone else's.
 * The answer is 404 rather than 403, because 403 would confirm the session exists.
 */
describe("revoking a session", () => {
  it("refuses to revoke a session belonging to another user", async () => {
    const alice = await newUser("revoke-alice@a.test");
    const mallory = await newUser("revoke-mallory@a.test");
    const aliceSession = await signIn(alice);
    const mallorySession = await signIn(mallory);

    await expect(
      sessions.revokeSession(
        context,
        principal(mallory, mallorySession.sessionId),
        aliceSession.sessionId,
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const list = await sessions.listSessions(context, principal(alice, aliceSession.sessionId));
    expect(list.sessions[0]?.revokedAt).toBeNull();
  });

  it("answers 404 for a session id that does not exist at all", async () => {
    const userId = await newUser("ghost-session@a.test");
    const session = await signIn(userId);
    await expect(
      sessions.revokeSession(
        context,
        principal(userId, session.sessionId),
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("revokes the refresh tokens behind the session it ends", async () => {
    const userId = await newUser("cascade@a.test");
    const session = await signIn(userId);
    await sessions.revokeSession(context, principal(userId, session.sessionId), session.sessionId);

    const alive = await uow.run(tenant, (tx) =>
      tx.execute<{ count: string }>(
        sql`select count(*) from refresh_tokens
            where session_id = ${session.sessionId}::uuid and revoked_at is null`,
      ),
    );
    expect(Number(alive.rows[0]?.count)).toBe(0);
  });
});
