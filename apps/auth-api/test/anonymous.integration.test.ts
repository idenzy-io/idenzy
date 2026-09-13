import { SystemClock } from "@idenzy/core/time/clock";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnonymousFlow } from "../dist/anonymous/anonymous.flow.js";
import { AnonymousUpgradeFlow } from "../dist/anonymous/anonymous-upgrade.flow.js";
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

let uow: UnitOfWork;
let gate: ReturnType<typeof testMfaGate>;
let anonymous: AnonymousFlow;
let upgrade: AnonymousUpgradeFlow;
let signUp: PasswordSignUpFlow;
let signIn: PasswordSignInFlow;

class NoBreaches extends BreachedPasswordChecker {
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_anon",
  ip: "203.0.113.5",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_anon", "user");

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  gate = testMfaGate(uow, clock, config);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(
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

  anonymous = new AnonymousFlow(sessions, hooks, audit, gate, actives, uow);
  upgrade = new AnonymousUpgradeFlow(
    sessions,
    hooks,
    audit,
    gate,
    actives,
    uow,
    hasher,
    new NoBreaches(),
  );
  signUp = new PasswordSignUpFlow(
    sessions,
    hooks,
    audit,
    gate,
    actives,
    uow,
    hasher,
    new NoBreaches(),
  );
  signIn = new PasswordSignInFlow(sessions, hooks, audit, gate, actives, uow, hasher, clock);

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
     VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("an anonymous session", () => {
  it("is a real revocable session with nothing identifying behind it", async () => {
    const issued = sessionOf(await anonymous.authenticate(context, {}));

    expect(issued.user.email).toBeNull();
    expect(issued.user.isAnonymous()).toBe(true);
    expect(issued.accessToken.split(".")).toHaveLength(3);
    expect(issued.refreshToken).toHaveLength(43);
  });

  /** A customer decides what an anonymous user may do, and needs the claim to say so. */
  it("carries anon in the amr so a customer can tell", async () => {
    const issued = sessionOf(await anonymous.authenticate(context, {}));
    const claims = JSON.parse(
      Buffer.from(issued.accessToken.split(".")[1] ?? "", "base64url").toString(),
    ) as { amr: string[] };
    expect(claims.amr).toEqual([AuthMethod.Anonymous]);
  });

  it("gives each caller their own account rather than sharing one", async () => {
    const first = sessionOf(await anonymous.authenticate(context, {}));
    const second = sessionOf(await anonymous.authenticate(context, {}));
    expect(first.userId).not.toBe(second.userId);
  });
});

describe("upgrading one", () => {
  /**
   * PROJECT.md 3.1. The id surviving is the entire feature: everything the customer
   * attached to it is still attached, and an upgrade that minted a new id would be a
   * migration they had to write themselves.
   */
  it("keeps the same user id", async () => {
    const anon = sessionOf(await anonymous.authenticate(context, {}));
    const upgraded = sessionOf(
      await upgrade.authenticate(context, {
        userId: anon.userId,
        email: "upgraded@a.test",
        password: "a-perfectly-fine-password",
      }),
    );

    expect(upgraded.userId).toBe(anon.userId);
    expect(upgraded.user.email).toBe("upgraded@a.test");
    // Unverified, exactly as password sign-up leaves it. Nothing proved the address.
    expect(upgraded.user.emailVerified).toBe(false);
  });

  it("issues a session that no longer claims to be anonymous", async () => {
    const anon = sessionOf(await anonymous.authenticate(context, {}));
    const upgraded = sessionOf(
      await upgrade.authenticate(context, {
        userId: anon.userId,
        email: "claims@a.test",
        password: "another-fine-password",
      }),
    );

    const claims = JSON.parse(
      Buffer.from(upgraded.accessToken.split(".")[1] ?? "", "base64url").toString(),
    ) as { amr: string[] };
    expect(claims.amr).toEqual([AuthMethod.Password]);
    expect(upgraded.sessionId).not.toBe(anon.sessionId);
  });

  it("leaves an account that can sign in with the password it just set", async () => {
    const anon = sessionOf(await anonymous.authenticate(context, {}));
    sessionOf(
      await upgrade.authenticate(context, {
        userId: anon.userId,
        email: "signsin@a.test",
        password: "the-set-password",
      }),
    );

    const issued = sessionOf(
      await signIn.authenticate(context, {
        email: "signsin@a.test",
        password: "the-set-password",
      }),
    );
    expect(issued.userId).toBe(anon.userId);
  });

  /**
   * This route sets a password without asking for the current one, so allowing it on an
   * account that already has credentials would be a password change with no proof.
   */
  it("refuses an account that is not anonymous", async () => {
    const real = sessionOf(
      await signUp.authenticate(context, {
        email: "already-real@a.test",
        password: "already-real-password",
      }),
    );
    await expect(
      upgrade.authenticate(context, {
        userId: real.userId,
        email: "hijacked@a.test",
        password: "hijack-attempt-password",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an address someone else already holds, and changes nothing", async () => {
    const anon = sessionOf(await anonymous.authenticate(context, {}));
    sessionOf(
      await signUp.authenticate(context, { email: "occupied@a.test", password: "occupied-pass" }),
    );

    await expect(
      upgrade.authenticate(context, {
        userId: anon.userId,
        email: "occupied@a.test",
        password: "some-other-password",
      }),
    ).rejects.toMatchObject({ status: 409 });

    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findById(anon.userId),
    );
    expect(user?.isAnonymous()).toBe(true);
  });

  it("applies the breach check the same way sign-up does", async () => {
    class AlwaysBreached extends BreachedPasswordChecker {
      override isBreached(): Promise<boolean> {
        return Promise.resolve(true);
      }
      protected override fetchRange(): Promise<readonly string[]> {
        return Promise.resolve([]);
      }
    }
    const strict = new AnonymousUpgradeFlow(
      new SessionService(
        uow,
        clock,
        await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300),
        config,
        revocations.publisher,
        claimTemplates(uow, clock),
        new NullAnalyticsRecorder(),
      ),
      new NullFlowHooks(),
      new OutboxFlowAudit(uow, clock),
      gate,
      actives,
      uow,
      hasher,
      new AlwaysBreached(),
    );
    const anon = sessionOf(await anonymous.authenticate(context, {}));

    await expect(
      strict.authenticate(context, {
        userId: anon.userId,
        email: "breached-upgrade@a.test",
        password: "password123456",
      }),
    ).rejects.toMatchObject({ code: "password_breached" });
  });
});
