import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { TestAuthenticator } from "@idenzy/testing/webauthn-authenticator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { PasskeyFlow } from "../dist/passkey/passkey.flow.js";
import { PasskeyCeremony } from "../dist/passkey/passkey-ceremony.js";
import { PasskeyService } from "../dist/passkey/passkey-service.js";
import { RelyingPartyResolver } from "../dist/passkey/relying-party-resolver.js";
import { encodeUserHandle } from "../dist/passkey/user-handle.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const clock = new SystemClock();
const actives = testActives(clock);
const revocations = testRevocations(clock);
const config = testConfig();

const PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER_PROJECT = "33333333-3333-3333-3333-333333333333";
const RP_ID = "app.example.test";
const ORIGIN = "https://app.example.test";

let uow: UnitOfWork;
let service: PasskeyService;
let flow: PasskeyFlow;
let resolver: RelyingPartyResolver;
let userId: string;
let otherUserId: string;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_passkey",
  ip: "203.0.113.9",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const otherContext: FlowContext = { ...context, projectId: OTHER_PROJECT };
const tenant = new TenantContext(PROJECT, "req_passkey", "user");

/** Enrols a fresh authenticator on a user and returns it, ready to sign in. */
async function enrol(
  on: FlowContext,
  owner: string,
  authenticator = new TestAuthenticator(),
): Promise<TestAuthenticator> {
  const options = await service.startRegistration(on, owner);
  const attestation = authenticator.register(RP_ID, ORIGIN, options.publicKey.challenge);
  await service.finishRegistration(on, owner, {
    challengeId: options.challengeId,
    response: attestation,
  });
  return authenticator;
}

/** A started sign-in: the challenge id to post back and the nonce to sign. */
async function beginSignIn(on: FlowContext): Promise<{ challengeId: string; challenge: string }> {
  const options = await service.startAuthentication(on);
  return { challengeId: options.challengeId, challenge: options.publicKey.challenge };
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const gate = testMfaGate(uow, clock, config);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(
    uow,
    clock,
    issuer,
    config,
    revocations.publisher,
    claimTemplates(uow, clock),
    new NullAnalyticsRecorder(),
    new ProjectSettingsReader(uow),
  );
  const ceremony = new PasskeyCeremony();
  resolver = new RelyingPartyResolver(uow);
  service = new PasskeyService(
    uow,
    clock,
    config,
    ceremony,
    resolver,
    new ProjectSettingsReader(uow),
  );
  flow = new PasskeyFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    actives,
    uow,
    clock,
    ceremony,
    resolver,
  );

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  for (const id of [PROJECT, OTHER_PROJECT]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [id, rows[0]?.id],
    );
    await harness.owner.query(
      `INSERT INTO webauthn_relying_parties (project_id, rp_id, rp_name, origins)
       VALUES ($1, $2, 'Acme', ARRAY[$3])`,
      [id, RP_ID, ORIGIN],
    );
  }

  userId = (await createUser(tenant, "owner@example.test")).id;
  otherUserId = (
    await createUser(new TenantContext(OTHER_PROJECT, "req_passkey", "user"), "other@example.test")
  ).id;
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

function createUser(on: TenantContext, email: string): Promise<{ id: string }> {
  return uow.run(on, (tx) =>
    new UserRepository(tx, on).create({
      email,
      emailVerified: true,
      phone: null,
      passwordHash: null,
      passwordAlgoVersion: null,
      displayName: null,
      avatarUrl: null,
    }),
  );
}

describe("passkey ceremonies", () => {
  it("registers a credential and signs in with it", async () => {
    const authenticator = await enrol(context, userId);
    const { challengeId, challenge } = await beginSignIn(context);

    const issued = sessionOf(
      await flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(userId)),
      }),
    );

    expect(issued.userId).toBe(userId);
    expect(issued.accessToken.length).toBeGreaterThan(0);
    const listed = await service.list(context, userId);
    expect(listed.some((passkey) => passkey.lastUsedAt !== null)).toBe(true);
  });

  it("asks for a discoverable credential and never names one", async () => {
    const options = await service.startAuthentication(context);
    expect(options.publicKey.allowCredentials).toBeUndefined();
    expect(options.publicKey.rpId).toBe(RP_ID);
    // Required rather than preferred, so one assertion is a whole authentication.
    expect(options.publicKey.userVerification).toBe("required");
  });

  it("demands a resident key at registration, which is what makes that possible", async () => {
    const options = await service.startRegistration(context, userId);
    expect(options.publicKey.authenticatorSelection?.residentKey).toBe("required");
    expect(options.publicKey.authenticatorSelection?.userVerification).toBe("required");
  });

  it("records what the authenticator signed about backup, not what it claimed", async () => {
    const user = (await createUser(tenant, "backup@example.test")).id;
    await enrol(
      context,
      user,
      new TestAuthenticator({ backupEligible: false, backupState: false }),
    );

    const [passkey] = await service.list(context, user);
    expect(passkey?.backupEligible).toBe(false);
    expect(passkey?.backedUp).toBe(false);
  });

  it("advances the stored sign counter on every assertion", async () => {
    const user = (await createUser(tenant, "counter@example.test")).id;
    const authenticator = await enrol(context, user);

    for (let round = 0; round < 2; round += 1) {
      const { challengeId, challenge } = await beginSignIn(context);
      sessionOf(
        await flow.authenticate(context, {
          challengeId,
          response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(user)),
        }),
      );
    }

    const { rows } = await harness.owner.query<{ sign_count: number }>(
      `SELECT sign_count FROM webauthn_credentials WHERE credential_id = $1`,
      [authenticator.credentialIdB64],
    );
    expect(rows[0]?.sign_count).toBe(2);
  });
});

describe("passkey attacks", () => {
  it("refuses an assertion whose counter did not advance, which is a cloned device", async () => {
    const user = (await createUser(tenant, "clone@example.test")).id;
    const authenticator = await enrol(context, user);

    const first = await beginSignIn(context);
    sessionOf(
      await flow.authenticate(context, {
        challengeId: first.challengeId,
        response: authenticator.authenticate(
          RP_ID,
          ORIGIN,
          first.challenge,
          encodeUserHandle(user),
        ),
      }),
    );

    // A second authenticator holding a copy of the key would report a counter it has
    // already used. The signature is perfectly valid; the counter is what gives it away.
    const replay = await beginSignIn(context);
    await expect(
      flow.authenticate(context, {
        challengeId: replay.challengeId,
        response: authenticator.authenticate(
          RP_ID,
          ORIGIN,
          replay.challenge,
          encodeUserHandle(user),
          { signCount: 1 },
        ),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      // Named so a change that starts refusing this for some other reason fails here.
      detail: { stage: "authentication", reason: expect.stringContaining("counter") },
    });
  });

  it("burns a challenge even when the assertion that used it failed", async () => {
    const user = (await createUser(tenant, "burn@example.test")).id;
    const authenticator = await enrol(context, user);
    const { challengeId, challenge } = await beginSignIn(context);

    // Fails: the origin is not one this project registered.
    await expect(
      flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(
          RP_ID,
          "https://evil.example.test",
          challenge,
          encodeUserHandle(user),
        ),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "authentication", reason: expect.stringContaining("origin") },
    });

    // The same challenge is now spent, so the attacker cannot go back and do it right.
    await expect(
      flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(user)),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "challenge" },
    });
  });

  it("refuses an assertion replayed onto a second challenge", async () => {
    const user = (await createUser(tenant, "replay@example.test")).id;
    const authenticator = await enrol(context, user);

    const captured = await beginSignIn(context);
    const assertion = authenticator.authenticate(
      RP_ID,
      ORIGIN,
      captured.challenge,
      encodeUserHandle(user),
    );
    sessionOf(
      await flow.authenticate(context, { challengeId: captured.challengeId, response: assertion }),
    );

    const fresh = await beginSignIn(context);
    await expect(
      flow.authenticate(context, { challengeId: fresh.challengeId, response: assertion }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "authentication", reason: expect.stringContaining("challenge") },
    });
  });

  it("refuses a registration challenge presented at the sign-in endpoint", async () => {
    const user = (await createUser(tenant, "mixed@example.test")).id;
    const authenticator = await enrol(context, user);
    const registration = await service.startRegistration(context, user);

    await expect(
      flow.authenticate(context, {
        challengeId: registration.challengeId,
        response: authenticator.authenticate(
          RP_ID,
          ORIGIN,
          registration.publicKey.challenge,
          encodeUserHandle(user),
        ),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "challenge" },
    });
  });

  it("refuses a credential enrolled in another project", async () => {
    const foreign = await enrol(otherContext, otherUserId);
    const { challengeId, challenge } = await beginSignIn(context);

    await expect(
      flow.authenticate(context, {
        challengeId,
        response: foreign.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(otherUserId)),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "credential" },
    });
  });

  it("refuses an assertion carrying somebody else's user handle", async () => {
    const user = (await createUser(tenant, "handle@example.test")).id;
    const authenticator = await enrol(context, user);
    const { challengeId, challenge } = await beginSignIn(context);

    await expect(
      flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(user), {
          userHandle: encodeUserHandle(userId),
        }),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "user_handle" },
    });
  });

  it("refuses a registration challenge minted for a different account", async () => {
    const victim = (await createUser(tenant, "victim@example.test")).id;
    const attacker = (await createUser(tenant, "attacker@example.test")).id;
    const options = await service.startRegistration(context, attacker);

    await expect(
      service.finishRegistration(context, victim, {
        challengeId: options.challengeId,
        response: new TestAuthenticator().register(RP_ID, ORIGIN, options.publicKey.challenge),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "challenge" },
    });
  });

  it("refuses to enrol the same authenticator twice", async () => {
    const user = (await createUser(tenant, "twice@example.test")).id;
    const authenticator = await enrol(context, user);
    const options = await service.startRegistration(context, user);

    await expect(
      service.finishRegistration(context, user, {
        challengeId: options.challengeId,
        response: authenticator.register(RP_ID, ORIGIN, options.publicKey.challenge),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("stops answering for a passkey its owner removed", async () => {
    const user = (await createUser(tenant, "removed@example.test")).id;
    const authenticator = await enrol(context, user);
    const [passkey] = await service.list(context, user);
    await service.remove(context, user, passkey?.id ?? "");

    const { challengeId, challenge } = await beginSignIn(context);
    await expect(
      flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(user)),
      }),
    ).rejects.toMatchObject({
      code: "webauthn_assertion_invalid",
      detail: { stage: "credential" },
    });
  });

  it("will not let one user remove another's passkey", async () => {
    const owner = (await createUser(tenant, "mine@example.test")).id;
    const stranger = (await createUser(tenant, "yours@example.test")).id;
    await enrol(context, owner);
    const [passkey] = await service.list(context, owner);

    await expect(service.remove(context, stranger, passkey?.id ?? "")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("relying party configuration", () => {
  it("refuses a ceremony for a project that has not configured one", async () => {
    const unconfigured: FlowContext = { ...context, projectId: PROJECT };
    await harness.owner.query(`DELETE FROM webauthn_relying_parties WHERE project_id = $1`, [
      PROJECT,
    ]);

    await expect(resolver.resolve(unconfigured)).rejects.toMatchObject({ status: 404 });

    await harness.owner.query(
      `INSERT INTO webauthn_relying_parties (project_id, rp_id, rp_name, origins)
       VALUES ($1, $2, 'Acme', ARRAY[$3])`,
      [PROJECT, RP_ID, ORIGIN],
    );
  });
});

describe("passkey sign-in method", () => {
  it("records the method it actually proved", async () => {
    const user = (await createUser(tenant, "amr@example.test")).id;
    const authenticator = await enrol(context, user);
    const { challengeId, challenge } = await beginSignIn(context);

    const issued = sessionOf(
      await flow.authenticate(context, {
        challengeId,
        response: authenticator.authenticate(RP_ID, ORIGIN, challenge, encodeUserHandle(user)),
      }),
    );

    const { rows } = await harness.owner.query<{ amr: string[] }>(
      `SELECT amr FROM sessions WHERE id = $1`,
      [issued.sessionId],
    );
    expect(rows[0]?.amr).toEqual([AuthMethod.Passkey]);
  });
});
