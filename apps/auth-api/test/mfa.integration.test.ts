import { InternalError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { base32Decode } from "@idenzy/crypto/mfa/base32";
import { Totp } from "@idenzy/crypto/mfa/totp";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { MfaRecoveryCodeRepository } from "@idenzy/persistence/repository/mfa-recovery-code-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import { challengeOf, sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { MfaFactorRegistry } from "../dist/mfa/factor-registry.js";
import { MfaChallengeVerifier } from "../dist/mfa/mfa-challenge-verifier.js";
import { MfaEnrolmentService } from "../dist/mfa/mfa-enrolment-service.js";
import { MfaVerificationFlow } from "../dist/mfa/mfa-verification.flow.js";
import { RecoveryCodeFactor } from "../dist/mfa/recovery-code.factor.js";
import { StepUpService } from "../dist/mfa/step-up-service.js";
import { TotpFactor } from "../dist/mfa/totp.factor.js";
import { PasswordSignInFlow } from "../dist/password/password-sign-in.flow.js";
import { PasswordSignUpFlow } from "../dist/password/password-sign-up.flow.js";
import type { SessionPrincipal } from "../dist/session/session.guard.js";
import { SessionService } from "../dist/session/session-service.js";
import { testConfig, testMfaGate, testRevocations } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const config = testConfig();
const clock = new SystemClock();
const revocations = testRevocations(clock);
const encryptor = new FieldEncryptor(developmentDataKey(config.get("CELL_CODE")));

let uow: UnitOfWork;
let enrolment: MfaEnrolmentService;
let totpFactor: TotpFactor;
let recoveryFactor: RecoveryCodeFactor;
let signUp: PasswordSignUpFlow;
let signIn: PasswordSignInFlow;
let verification: MfaVerificationFlow;
let stepUp: StepUpService;
let _sessionService: SessionService;

class NoBreaches extends BreachedPasswordChecker {
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_mfa",
  ip: "203.0.113.9",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_mfa", "user");

/** Narrows away a null the test does not expect, without a bare throw (PROJECT.md 7.2.8). */
function required<T>(value: T | null): T {
  if (value === null) throw new InternalError({ detail: { reason: "expected a value" } });
  return value;
}

/** The code an authenticator app would be showing for a secret right now. */
const codeFor = (secret: string): string => new Totp(clock).current(secret);

/**
 * The code for the following step.
 *
 * Confirming an enrolment spends the current one, so a sign-in a moment later has to
 * present the next. That is the replay defence working, not a quirk of the test.
 */
const nextCodeFor = (secret: string): string =>
  new Totp(clock).at(base32Decode(secret), Math.floor(clock.nowMs() / 1000 / 30) + 1);

/** What the session actually claims, read from the row rather than from the caller. */
async function amrOf(sessionId: string): Promise<readonly string[]> {
  const session = await uow.run(tenant, (tx) =>
    new SessionRepository(tx, tenant).findById(sessionId),
  );
  return session?.amr ?? [];
}

async function liveSessions(userId: string): Promise<number> {
  const rows = await uow.run(tenant, (tx) => new SessionRepository(tx, tenant).listForUser(userId));
  return rows.filter((row) => row.revokedAt === null).length;
}

async function newUser(email: string): Promise<string> {
  const issued = sessionOf(
    await signUp.authenticate(context, { email, password: "a-good-password" }),
  );
  return issued.userId;
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const gate = testMfaGate(uow, clock, config);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(uow, clock, issuer, config, revocations.publisher);
  _sessionService = sessions;
  signUp = new PasswordSignUpFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    uow,
    new Argon2idHasher(),
    new NoBreaches(),
  );
  signIn = new PasswordSignInFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    uow,
    new Argon2idHasher(),
    clock,
  );
  enrolment = new MfaEnrolmentService(uow, clock, encryptor, config);
  totpFactor = new TotpFactor(uow, encryptor, clock);
  recoveryFactor = new RecoveryCodeFactor(uow, clock);
  const registry = new MfaFactorRegistry(totpFactor, recoveryFactor);
  const challenges = new MfaChallengeVerifier(uow, clock);
  verification = new MfaVerificationFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    uow,
    clock,
    registry,
    challenges,
  );
  stepUp = new StepUpService(uow, clock, config, gate, registry, challenges, sessions);

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

describe("enrolling an authenticator", () => {
  it("hands back a uri and a secret and no image of either", async () => {
    const userId = await newUser("totp-start@a.test");
    const started = await enrolment.startTotp(context, userId, "Phone");

    expect(started.factorId.startsWith("mfa_")).toBe(true);
    expect(started.uri.startsWith("otpauth://totp/")).toBe(true);
    expect(new URL(started.uri).searchParams.get("secret")).toBe(started.secret);
  });

  /** Until it is confirmed the secret proves nothing, which is what the second call is for. */
  it("does not count as a factor until a code confirms it", async () => {
    const userId = await newUser("totp-unconfirmed@a.test");
    await enrolment.startTotp(context, userId, null);

    expect(await totpFactor.enrolled(context, userId)).toBe(false);
    expect((await enrolment.list(context, userId)).factors).toHaveLength(0);
  });

  it("confirms with a generated code and issues a recovery sheet", async () => {
    const userId = await newUser("totp-confirm@a.test");
    const started = await enrolment.startTotp(context, userId, "Phone");

    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );

    expect(confirmed.factor.type).toBe(MfaFactorType.Totp);
    expect(confirmed.factor.label).toBe("Phone");
    expect(confirmed.recoveryCodes?.codes).toHaveLength(10);
    expect(await totpFactor.enrolled(context, userId)).toBe(true);
  });

  it("refuses a wrong code and leaves the factor unconfirmed", async () => {
    const userId = await newUser("totp-wrong@a.test");
    const started = await enrolment.startTotp(context, userId, null);

    await expect(
      enrolment.confirmTotp(context, userId, started.factorId, "000000"),
    ).rejects.toMatchObject({ code: "mfa_factor_invalid" });
    expect(await totpFactor.enrolled(context, userId)).toBe(false);
  });

  it("refuses a second authenticator once one is confirmed", async () => {
    const userId = await newUser("totp-twice@a.test");
    const started = await enrolment.startTotp(context, userId, null);
    await enrolment.confirmTotp(context, userId, started.factorId, codeFor(started.secret));

    await expect(enrolment.startTotp(context, userId, null)).rejects.toMatchObject({
      code: "mfa_factor_already_enrolled",
    });
  });

  /** An abandoned enrolment must not stand between the user and a second attempt. */
  it("replaces an enrolment that was started and never confirmed", async () => {
    const userId = await newUser("totp-restart@a.test");
    const abandoned = await enrolment.startTotp(context, userId, null);
    const second = await enrolment.startTotp(context, userId, null);

    expect(second.factorId).not.toBe(abandoned.factorId);
    await expect(
      enrolment.confirmTotp(context, userId, abandoned.factorId, codeFor(abandoned.secret)),
    ).rejects.toMatchObject({ code: "not_found" });
    await enrolment.confirmTotp(context, userId, second.factorId, codeFor(second.secret));
    expect(await totpFactor.enrolled(context, userId)).toBe(true);
  });

  /** A factor id in a URL is exactly the value somebody tries on somebody else's account. */
  it("refuses to confirm a factor belonging to another user", async () => {
    const owner = await newUser("totp-owner@a.test");
    const stranger = await newUser("totp-stranger@a.test");
    const started = await enrolment.startTotp(context, owner, null);

    await expect(
      enrolment.confirmTotp(context, stranger, started.factorId, codeFor(started.secret)),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await totpFactor.enrolled(context, owner)).toBe(false);
  });
});

describe("proving an authenticator", () => {
  it("accepts the current code and refuses it the second time", async () => {
    const userId = await newUser("totp-replay@a.test");
    const started = await enrolment.startTotp(context, userId, null);
    await enrolment.confirmTotp(context, userId, started.factorId, codeFor(started.secret));

    // Confirmation already spent this step, so the same code must not work again: that
    // is the whole point of writing the counter back.
    await expect(totpFactor.prove(context, userId, codeFor(started.secret))).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
  });

  it("refuses a code minted from another user's secret", async () => {
    const owner = await newUser("totp-cross-a@a.test");
    const other = await newUser("totp-cross-b@a.test");
    const mine = await enrolment.startTotp(context, owner, null);
    await enrolment.confirmTotp(context, owner, mine.factorId, codeFor(mine.secret));
    const theirs = await enrolment.startTotp(context, other, null);
    await enrolment.confirmTotp(context, other, theirs.factorId, codeFor(theirs.secret));

    await expect(totpFactor.prove(context, owner, codeFor(theirs.secret))).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
  });

  /** A factor nobody enrolled has to fail exactly as a wrong code does. */
  it("answers a user with no factor the same way it answers a wrong code", async () => {
    const userId = await newUser("totp-none@a.test");
    await expect(totpFactor.prove(context, userId, "123456")).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
  });
});

describe("recovery codes", () => {
  async function enrolled(email: string): Promise<{ userId: string; codes: readonly string[] }> {
    const userId = await newUser(email);
    const started = await enrolment.startTotp(context, userId, null);
    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );
    return { userId, codes: confirmed.recoveryCodes?.codes ?? [] };
  }

  it("signs in on a code and crosses it off", async () => {
    const { userId, codes } = await enrolled("recovery-use@a.test");
    const [code] = codes;

    await expect(recoveryFactor.prove(context, userId, code ?? "")).resolves.toBe("recovery");
    expect((await enrolment.list(context, userId)).recoveryCodesRemaining).toBe(9);
  });

  it("refuses the same code twice", async () => {
    const { userId, codes } = await enrolled("recovery-replay@a.test");
    const [code] = codes;

    await recoveryFactor.prove(context, userId, code ?? "");
    await expect(recoveryFactor.prove(context, userId, code ?? "")).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
  });

  it("accepts a code retyped in a form it was never shown in", async () => {
    const { userId, codes } = await enrolled("recovery-typed@a.test");
    const typed = (codes[0] ?? "").toLowerCase().replace(/-/g, " ");

    await expect(recoveryFactor.prove(context, userId, typed)).resolves.toBe("recovery");
  });

  /**
   * The attack the per-user scope exists for. A recovery code is compared by value, so a
   * lookup on the digest alone would sign the caller in as whoever the code belonged to.
   */
  it("refuses another user's code", async () => {
    const mine = await enrolled("recovery-mine@a.test");
    const theirs = await enrolled("recovery-theirs@a.test");

    await expect(
      recoveryFactor.prove(context, mine.userId, theirs.codes[0] ?? ""),
    ).rejects.toMatchObject({ code: "mfa_factor_invalid" });
    expect((await enrolment.list(context, theirs.userId)).recoveryCodesRemaining).toBe(10);
  });

  it("does not reissue a sheet somebody may already have printed", async () => {
    const userId = await newUser("recovery-keep@a.test");
    // Standing in for an account that already had codes before this enrolment, which is
    // what a second factor type will produce once there is one.
    await uow.run(tenant, (tx) =>
      new MfaRecoveryCodeRepository(tx, tenant).replaceAll(userId, ["a-standing-digest"]),
    );

    const started = await enrolment.startTotp(context, userId, null);
    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );

    expect(confirmed.recoveryCodes).toBeNull();
    expect((await enrolment.list(context, userId)).recoveryCodesRemaining).toBe(1);
  });

  it("replaces the whole sheet on regeneration", async () => {
    const { userId, codes } = await enrolled("recovery-regen@a.test");
    const fresh = await enrolment.regenerateRecoveryCodes(context, userId);

    expect(fresh.codes).toHaveLength(10);
    await expect(recoveryFactor.prove(context, userId, codes[0] ?? "")).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
    await expect(recoveryFactor.prove(context, userId, fresh.codes[0] ?? "")).resolves.toBe(
      "recovery",
    );
  });

  /**
   * Ten single-use passwords must not outlive the factor they were the fallback for: the
   * owner turned MFA off and believes nothing stands in front of the account any more.
   */
  it("goes with the last factor when it is removed", async () => {
    const { userId, codes } = await enrolled("recovery-removed@a.test");
    const factorId = (await enrolment.list(context, userId)).factors[0]?.id ?? "";

    await enrolment.remove(context, userId, factorId);

    expect((await enrolment.list(context, userId)).recoveryCodesRemaining).toBe(0);
    await expect(recoveryFactor.prove(context, userId, codes[0] ?? "")).rejects.toMatchObject({
      code: "mfa_factor_invalid",
    });
  });
});

describe("the secret at rest", () => {
  it("is encrypted, so a read of the table yields no working authenticator", async () => {
    const userId = await newUser("totp-at-rest@a.test");
    const started = await enrolment.startTotp(context, userId, null);

    const { rows } = await harness.owner.query<{ secret_encrypted: string }>(
      `SELECT secret_encrypted FROM mfa_factors WHERE project_id = $1 AND user_id = $2`,
      [PROJECT, userId],
    );
    const stored = rows[0]?.secret_encrypted ?? "";
    expect(stored).not.toBe(started.secret);
    expect(encryptor.decrypt(stored, PROJECT)).toBe(started.secret);
  });

  it("stores only a digest of a recovery code", async () => {
    const userId = await newUser("recovery-at-rest@a.test");
    const started = await enrolment.startTotp(context, userId, null);
    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );

    const { rows } = await harness.owner.query<{ code_hash: string }>(
      `SELECT code_hash FROM mfa_recovery_codes WHERE project_id = $1 AND user_id = $2`,
      [PROJECT, userId],
    );
    const hashes = rows.map((row) => row.code_hash);
    for (const code of confirmed.recoveryCodes?.codes ?? []) expect(hashes).not.toContain(code);
    expect(hashes).toHaveLength(10);
  });
});

describe("signing in with a second factor", () => {
  const password = "a-good-password";

  /** Enrols an authenticator and hands back everything a later sign-in needs. */
  async function enrolledUser(
    email: string,
  ): Promise<{ userId: string; secret: string; codes: readonly string[] }> {
    const userId = await newUser(email);
    const started = await enrolment.startTotp(context, userId, null);
    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );
    return { userId, secret: started.secret, codes: confirmed.recoveryCodes?.codes ?? [] };
  }

  it("stops a correct password at a challenge rather than a session", async () => {
    const email = "signin-challenged@a.test";
    await enrolledUser(email);

    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));

    expect(outcome.challenge.purpose).toBe("sign_in");
    expect(outcome.challenge.factors).toEqual([MfaFactorType.Totp, MfaFactorType.RecoveryCode]);
  });

  /** The property the whole feature rests on: one factor creates no session at all. */
  it("creates no session for a first factor alone", async () => {
    const email = "signin-nosession@a.test";
    const { userId } = await enrolledUser(email);

    const before = await liveSessions(userId);
    challengeOf(await signIn.authenticate(context, { email, password }));

    expect(await liveSessions(userId)).toBe(before);
  });

  it("issues a session claiming both factors when the code is right", async () => {
    const email = "signin-completed@a.test";
    const { secret } = await enrolledUser(email);
    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));

    // A step later, because confirming the enrolment already spent the current one.
    const issued = sessionOf(
      await verification.authenticate(context, {
        challengeId: outcome.challenge.challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(secret),
      }),
    );

    expect(issued.user.email).toBe(email);
    expect(await amrOf(issued.sessionId)).toEqual([
      AuthMethod.Password,
      AuthMethod.Totp,
      AuthMethod.Mfa,
    ]);
  });

  it("refuses to spend one challenge twice", async () => {
    const email = "signin-once@a.test";
    const { secret } = await enrolledUser(email);
    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));
    const challengeId = outcome.challenge.challengeId;

    await verification.authenticate(context, {
      challengeId,
      factor: MfaFactorType.Totp,
      code: nextCodeFor(secret),
    });
    await expect(
      verification.authenticate(context, {
        challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(secret),
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  it("costs an attempt for a wrong code, and dies on the fifth", async () => {
    const email = "signin-bruteforce@a.test";
    await enrolledUser(email);
    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));
    const challengeId = outcome.challenge.challengeId;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        verification.authenticate(context, {
          challengeId,
          factor: MfaFactorType.Totp,
          code: "000000",
        }),
      ).rejects.toMatchObject({ code: "mfa_factor_invalid" });
    }
    await expect(
      verification.authenticate(context, {
        challengeId,
        factor: MfaFactorType.Totp,
        code: "000000",
      }),
    ).rejects.toMatchObject({ code: "challenge_attempts_exhausted" });
  });

  it("completes on a recovery code when the authenticator is gone", async () => {
    const email = "signin-recovery@a.test";
    const { codes } = await enrolledUser(email);
    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));

    const issued = sessionOf(
      await verification.authenticate(context, {
        challengeId: outcome.challenge.challengeId,
        factor: MfaFactorType.RecoveryCode,
        code: codes[0] ?? "",
      }),
    );

    expect(await amrOf(issued.sessionId)).toContain(AuthMethod.RecoveryCode);
  });

  /**
   * A challenge names a user. Answering it with a factor belonging to somebody else must
   * be indistinguishable from a wrong code, and must not sign anybody in.
   */
  it("refuses a code from another account's authenticator", async () => {
    const victim = "signin-victim@a.test";
    await enrolledUser(victim);
    const attacker = await enrolledUser("signin-attacker@a.test");
    const outcome = challengeOf(await signIn.authenticate(context, { email: victim, password }));

    await expect(
      verification.authenticate(context, {
        challengeId: outcome.challenge.challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(attacker.secret),
      }),
    ).rejects.toMatchObject({ code: "mfa_factor_invalid" });
  });

  it("leaves a user with nothing enrolled signing in on one factor", async () => {
    const email = "signin-plain@a.test";
    await newUser(email);

    const issued = sessionOf(await signIn.authenticate(context, { email, password }));
    expect(await amrOf(issued.sessionId)).toEqual([AuthMethod.Password]);
  });
});

describe("stepping up inside a session", () => {
  const password = "a-good-password";

  /**
   * A session that exists, on an account that has since enrolled an authenticator.
   *
   * The order is the realistic one and it is also the only one that works: confirming an
   * enrolment spends the current TOTP step, so a sign-in that also proved the factor
   * would leave nothing this test could present. That is the replay defence, not a quirk.
   */
  async function signedInThenEnrolled(
    email: string,
  ): Promise<{ principal: SessionPrincipal; secret: string; codes: readonly string[] }> {
    const userId = await newUser(email);
    const issued = sessionOf(await signIn.authenticate(context, { email, password }));
    const started = await enrolment.startTotp(context, userId, null);
    const confirmed = await enrolment.confirmTotp(
      context,
      userId,
      started.factorId,
      codeFor(started.secret),
    );
    return {
      principal: await principalFor(issued.sessionId),
      secret: started.secret,
      codes: confirmed.recoveryCodes?.codes ?? [],
    };
  }

  /** Read from the session row, which is where a step-up writes and the guard reads. */
  async function principalFor(sessionId: string): Promise<SessionPrincipal> {
    const session = required(
      await uow.run(tenant, (tx) => new SessionRepository(tx, tenant).findById(sessionId)),
    );
    return {
      userId: session.userId,
      sessionId,
      amr: session.amr,
      factorVerifiedAt: session.factorVerifiedAt,
    };
  }

  it("lets a user with nothing enrolled straight past", async () => {
    const email = "stepup-none@a.test";
    await newUser(email);
    const issued = sessionOf(await signIn.authenticate(context, { email, password }));
    const principal = await principalFor(issued.sessionId);

    await expect(stepUp.assertRecent(context, principal)).resolves.toBeUndefined();
    expect(await stepUp.start(context, principal)).toBeNull();
  });

  it("passes when the proof is inside the window", async () => {
    const { principal } = await signedInThenEnrolled("stepup-fresh@a.test");
    const fresh: SessionPrincipal = { ...principal, factorVerifiedAt: clock.now() };

    await expect(stepUp.assertRecent(context, fresh)).resolves.toBeUndefined();
  });

  it("refuses when the proof is older than the window", async () => {
    const { principal } = await signedInThenEnrolled("stepup-stale@a.test");
    const stale: SessionPrincipal = {
      ...principal,
      factorVerifiedAt: new Date(clock.nowMs() - 60 * 60 * 1000),
    };

    await expect(stepUp.assertRecent(context, stale)).rejects.toMatchObject({
      code: "reauthentication_required",
    });
  });

  it("refuses a session that never proved a factor at all", async () => {
    const { principal } = await signedInThenEnrolled("stepup-never@a.test");

    expect(principal.factorVerifiedAt).toBeNull();
    await expect(stepUp.assertRecent(context, principal)).rejects.toMatchObject({
      code: "reauthentication_required",
    });
  });

  it("mints a fresh token and moves the factor age", async () => {
    const { principal, secret } = await signedInThenEnrolled("stepup-complete@a.test");
    const challenge = required(await stepUp.start(context, principal));

    const completed = await stepUp.complete(context, principal, {
      challengeId: challenge.challengeId,
      factor: MfaFactorType.Totp,
      code: nextCodeFor(secret),
    });

    expect(completed.accessToken.length).toBeGreaterThan(0);
    const after = await principalFor(principal.sessionId);
    expect(after.factorVerifiedAt).not.toBeNull();
    expect(after.amr).toContain(AuthMethod.Mfa);
    await expect(stepUp.assertRecent(context, after)).resolves.toBeUndefined();
  });

  /** A recovery code is for a lost phone. Spending one to confirm an action spends it wrongly. */
  it("does not offer a recovery code, and refuses one that is presented", async () => {
    const { principal, codes } = await signedInThenEnrolled("stepup-recovery@a.test");
    const challenge = required(await stepUp.start(context, principal));

    expect(challenge.factors).toEqual([MfaFactorType.Totp]);
    await expect(
      stepUp.complete(context, principal, {
        challengeId: challenge.challengeId,
        factor: MfaFactorType.RecoveryCode,
        code: codes[0] ?? "",
      }),
    ).rejects.toMatchObject({ code: "mfa_factor_invalid" });
  });

  /**
   * A challenge minted in one session must not raise the factor age of another, or a
   * device that proved nothing inherits a proof made somewhere else.
   */
  it("refuses a challenge minted in a different session", async () => {
    const email = "stepup-pinned@a.test";
    const { principal, secret } = await signedInThenEnrolled(email);
    const challenge = required(await stepUp.start(context, principal));

    // A second session for the same user, which is the interesting case: same person,
    // different device, and still not the session the challenge was minted in.
    const outcome = challengeOf(await signIn.authenticate(context, { email, password }));
    const second = sessionOf(
      await verification.authenticate(context, {
        challengeId: outcome.challenge.challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(secret),
      }),
    );
    const borrower = await principalFor(second.sessionId);

    await expect(
      stepUp.complete(context, borrower, {
        challengeId: challenge.challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(secret),
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  /** A step-up challenge is not a sign-in, and must not be spendable as one. */
  it("cannot be spent through the sign-in route", async () => {
    const { principal, secret } = await signedInThenEnrolled("stepup-crosspurpose@a.test");
    const challenge = required(await stepUp.start(context, principal));

    await expect(
      verification.authenticate(context, {
        challengeId: challenge.challengeId,
        factor: MfaFactorType.Totp,
        code: nextCodeFor(secret),
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });
});
