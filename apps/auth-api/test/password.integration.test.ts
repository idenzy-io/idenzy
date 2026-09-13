import { SystemClock } from "@idenzy/core/time/clock";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { PasswordSignInFlow } from "../dist/password/password-sign-in.flow.js";
import { PasswordSignUpFlow } from "../dist/password/password-sign-up.flow.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const clock = new SystemClock();
const actives = testActives(clock);
const revocations = testRevocations(clock);
const config = testConfig();
const hasher = new Argon2idHasher();

/** Reports whatever it is told to, so the breach path is exercised without the network. */
class StubChecker extends BreachedPasswordChecker {
  constructor(private readonly suffixes: readonly string[] = []) {
    super();
  }
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve(this.suffixes);
  }
}

/** Says every password is breached, by matching whatever suffix it is asked about. */
class AlwaysBreachedChecker extends BreachedPasswordChecker {
  override isBreached(): Promise<boolean> {
    return Promise.resolve(true);
  }
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

let uow: UnitOfWork;
let sessions: SessionService;
let signUp: PasswordSignUpFlow;
let signIn: PasswordSignInFlow;
let signUpRefusing: PasswordSignUpFlow;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_password",
  ip: "203.0.113.11",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_password", "user");

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const gate = testMfaGate(uow, clock, config);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  sessions = new SessionService(
    uow,
    clock,
    issuer,
    config,
    revocations.publisher,
    claimTemplates(uow, clock),
    new NullAnalyticsRecorder(),
  );

  const hooks = new NullFlowHooks();
  const audit = new OutboxFlowAudit(uow, clock);
  signUp = new PasswordSignUpFlow(
    sessions,
    hooks,
    audit,
    gate,
    actives,
    uow,
    hasher,
    new StubChecker(),
  );
  signIn = new PasswordSignInFlow(sessions, hooks, audit, gate, actives, uow, hasher, clock);
  signUpRefusing = new PasswordSignUpFlow(
    sessions,
    hooks,
    audit,
    gate,
    actives,
    uow,
    hasher,
    new AlwaysBreachedChecker(),
  );

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

describe("signing up", () => {
  it("creates the user and returns a usable session", async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "new@a.test",
        password: "a-long-enough-password",
        displayName: "Hasan",
      }),
    );

    expect(issued.user.email).toBe("new@a.test");
    expect(issued.user.emailVerified).toBe(false);
    expect(issued.refreshToken).toHaveLength(43);
    expect(issued.accessToken.split(".")).toHaveLength(3);
  });

  /**
   * The event a customer actually builds on, asserted where the flow runs rather than only where the
   * row is written: a sign-up announces an account once, and signing in again announces nothing.
   */
  it("announces the account once, and not again on the next sign-in", async () => {
    const email = "announced@a.test";
    sessionOf(await signUp.authenticate(context, { email, password: "a-long-enough-password" }));

    const created = async () => {
      const { rows } = await harness.owner.query<{ count: string }>(
        "SELECT count(*) FROM outbox WHERE topic = 'user.created' AND payload->>'email' = $1",
        [email],
      );
      return rows[0]?.count;
    };
    expect(await created()).toBe("1");

    sessionOf(await signIn.authenticate(context, { email, password: "a-long-enough-password" }));
    // A sign-in is `session.created`, which is its own event. An account is created once.
    expect(await created()).toBe("1");
  });

  /**
   * First-day-free, asserted where a sign-in actually happens (PROJECT.md 5.1).
   *
   * The rule lives on the `ActiveUserMeter` base and the meter is inherited by `AuthFlow`, so
   * this is the test that says both halves are connected: somebody who signs up, signs in and
   * leaves costs the customer nothing, and the same account costs them one MAU the day it comes
   * back. Backdating the row is the only way to be that account within one test run.
   */
  it("bills nobody on the day they signed up, and bills them when they return", async () => {
    const email = "metered@a.test";
    const before = actives.marked.length;
    sessionOf(await signUp.authenticate(context, { email, password: "a-long-enough-password" }));
    sessionOf(await signIn.authenticate(context, { email, password: "a-long-enough-password" }));
    expect(actives.marked).toHaveLength(before);

    await harness.owner.query(
      "UPDATE users SET created_at = now() - interval '2 days' WHERE email = $1",
      [email],
    );
    sessionOf(await signIn.authenticate(context, { email, password: "a-long-enough-password" }));
    expect(actives.marked).toHaveLength(before + 1);
  });

  it("stores an Argon2id hash and never the password", async () => {
    sessionOf(
      await signUp.authenticate(context, {
        email: "hashed@a.test",
        password: "another-long-password",
      }),
    );
    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findByEmail("hashed@a.test"),
    );
    expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,/);
    expect(hasher.needsRehash(user?.passwordHash ?? "")).toBe(false);
    expect(user?.passwordHash).not.toContain("another-long-password");
  });

  it("refuses a password that appears in a breach corpus", async () => {
    await expect(
      signUpRefusing.authenticate(context, { email: "breached@a.test", password: "password123" }),
    ).rejects.toMatchObject({ code: "password_breached", status: 400 });

    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findByEmail("breached@a.test"),
    );
    expect(user).toBeNull();
  });

  it("refuses a duplicate address as a conflict", async () => {
    sessionOf(
      await signUp.authenticate(context, { email: "dupe@a.test", password: "first-password-here" }),
    );
    await expect(
      signUp.authenticate(context, { email: "dupe@a.test", password: "second-password-here" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a password below the NIST minimum before doing any work", async () => {
    await expect(
      signUp.authenticate(context, { email: "short@a.test", password: "short" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("signing in", () => {
  const email = "signin@a.test";
  const password = "correct-horse-battery";

  beforeAll(async () => {
    sessionOf(await signUp.authenticate(context, { email, password }));
  });

  it("accepts the right password", async () => {
    const issued = sessionOf(await signIn.authenticate(context, { email, password }));
    expect(issued.user.email).toBe(email);
    expect(issued.user.toPublic().lastSignInAt).not.toBeNull();
  });

  /**
   * PROJECT.md 4.5. The two failures must be indistinguishable in what they say and in
   * how long they take, or sign-in becomes an account enumeration oracle.
   */
  it("answers identically for a wrong password and an unknown address", async () => {
    const wrong = await signIn
      .authenticate(context, { email, password: "not-the-password" })
      .catch((error: unknown) => error);
    const unknown = await signIn
      .authenticate(context, { email: "nobody@a.test", password: "not-the-password" })
      .catch((error: unknown) => error);

    expect(wrong).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(unknown).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect((wrong as Error).message).toBe((unknown as Error).message);
  });

  it("does the same hashing work when the address does not exist", async () => {
    // Warm the decoy, so this measures the verify and not its one-off creation.
    await signIn
      .authenticate(context, { email: "warm@a.test", password: "whatever-goes-here" })
      .catch(() => undefined);

    const started = performance.now();
    await signIn
      .authenticate(context, { email: "ghost@a.test", password: "whatever-goes-here" })
      .catch(() => undefined);
    // An Argon2id verify at 64 MB is tens of milliseconds. A short-circuit would be
    // sub-millisecond, and that difference is what an attacker measures.
    expect(performance.now() - started).toBeGreaterThan(15);
  });

  it("refuses a suspended account and says why", async () => {
    sessionOf(
      await signUp.authenticate(context, {
        email: "banned@a.test",
        password: "banned-user-password",
      }),
    );
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
    await harness.owner.query(
      `UPDATE users SET banned_until = now() + interval '1 day' WHERE email = 'banned@a.test'`,
    );

    await expect(
      signIn.authenticate(context, { email: "banned@a.test", password: "banned-user-password" }),
    ).rejects.toMatchObject({ code: "account_banned", status: 403 });
  });

  /**
   * What makes raising cost factors, or importing a competitor's hashes, invisible to
   * users: nobody is asked to reset a password because our parameters changed.
   */
  it("upgrades a stale hash in place on the next successful sign-in", async () => {
    const stalePassword = "stale-hash-password";
    const legacy = await argon2.hash(stalePassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(hasher.needsRehash(legacy)).toBe(true);

    sessionOf(
      await signUp.authenticate(context, { email: "stale@a.test", password: stalePassword }),
    );
    await harness.owner.query(`UPDATE users SET password_hash = $1 WHERE email = 'stale@a.test'`, [
      legacy,
    ]);

    sessionOf(
      await signIn.authenticate(context, { email: "stale@a.test", password: stalePassword }),
    );

    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findByEmail("stale@a.test"),
    );
    expect(user?.passwordHash).not.toBe(legacy);
    expect(hasher.needsRehash(user?.passwordHash ?? "")).toBe(false);
  });
});
