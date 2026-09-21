import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { IssuerTokenVerifier } from "@idenzy/crypto/tokens/token-verifier";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import type { SessionPrincipal } from "../dist/session/session.guard.js";
import { SessionService } from "../dist/session/session-service.js";
import { claimTemplates, testConfig, testRevocations } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const clock = new SystemClock();
const revocations = testRevocations(clock);
const config = testConfig();

let uow: UnitOfWork;
let sessions: SessionService;
let verifier: IssuerTokenVerifier;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_sessions",
  ip: "203.0.113.20",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  verifier = new IssuerTokenVerifier(issuer, config.get("ISSUER_BASE_URL"));
  sessions = new SessionService(
    uow,
    clock,
    issuer,
    config,
    revocations.publisher,
    claimTemplates(uow, clock),
    new NullAnalyticsRecorder(),
    new ProjectSettingsReader(uow),
  );

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name)
     VALUES ($1, $2, 'p', 'k')`,
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

async function signIn(
  userId: string,
): Promise<{ sessionId: string; accessToken: string; refreshToken: string }> {
  const issued = await sessions.issueSession(context, {
    userId,
    amr: [AuthMethod.Password],
    factorVerifiedAt: null,
  });
  return {
    sessionId: issued.sessionId,
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
  };
}

function principal(userId: string, sessionId: string): SessionPrincipal {
  return { userId, sessionId, amr: [AuthMethod.Password], factorVerifiedAt: null };
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

  it("shows the name the client gave the device it was created on", async () => {
    const userId = await newUser("named@a.test");
    const named = await sessions.issueSession(
      { ...context, deviceName: "Hasan'ın MacBook'u" },
      { userId, amr: [AuthMethod.Password], factorVerifiedAt: null },
    );

    const list = await sessions.listSessions(context, principal(userId, named.sessionId));
    expect(list.sessions[0]?.deviceName).toBe("Hasan'ın MacBook'u");
  });

  it("leaves the name null for a client that sent none, rather than guessing one", async () => {
    const userId = await newUser("unnamed@a.test");
    const only = await signIn(userId);

    const list = await sessions.listSessions(context, principal(userId, only.sessionId));
    expect(list.sessions[0]?.deviceName).toBeNull();
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

    const alive = await uow.transaction((tx) =>
      tx.execute<{ count: string }>(
        sql`select count(*) from refresh_tokens
            where session_id = ${session.sessionId}::uuid and revoked_at is null`,
      ),
    );
    expect(Number(alive.rows[0]?.count)).toBe(0);
  });

  /**
   * The published half. A customer's verifier is offline, so the session row this test's
   * neighbours assert on is invisible to it: the set is the only way the revocation
   * reaches them before the access token expires (ADR-0009).
   */
  it("publishes the ended session where an offline verifier can see it", async () => {
    const userId = await newUser("published@a.test");
    const session = await signIn(userId);

    await sessions.revokeSession(context, principal(userId, session.sessionId), session.sessionId);

    const snapshot = await revocations.set.snapshot(PROJECT);
    expect(snapshot.sessions).toContain(PublicId.encode(IdPrefix.Session, session.sessionId).value);
  });

  /** Public ids, because that is what a token carries and what the SDK compares. */
  it("publishes the id the token carries, never the database uuid", async () => {
    const userId = await newUser("public-id@a.test");
    const session = await signIn(userId);

    await sessions.revokeSession(context, principal(userId, session.sessionId), session.sessionId);

    const snapshot = await revocations.set.snapshot(PROJECT);
    expect(snapshot.sessions).not.toContain(session.sessionId);
    expect(snapshot.sessions.every((id) => id.startsWith("ses_"))).toBe(true);
  });
});

describe("signing out everywhere", () => {
  /**
   * One watermark, not one entry per device. A user with many sessions would otherwise
   * write one entry each, and a published set has to stay bounded by the retention window
   * rather than by how many devices somebody owns (ADR-0009).
   */
  it("publishes a single user watermark rather than every session it ended", async () => {
    const userId = await newUser("everywhere@a.test");
    const first = await signIn(userId);
    await signIn(userId);
    await signIn(userId);
    const before = (await revocations.set.snapshot(PROJECT)).sessions.length;

    await sessions.signOut(context, first.refreshToken, "all");

    const snapshot = await revocations.set.snapshot(PROJECT);
    expect(snapshot.sessions).toHaveLength(before);
    expect(snapshot.users).toContainEqual(
      expect.objectContaining({ userId: PublicId.encode(IdPrefix.User, userId).value }),
    );
  });
});
