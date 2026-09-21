import { SystemClock } from "@idenzy/core/time/clock";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { generateOpaqueToken } from "@idenzy/crypto/tokens/random";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { EmailProvider } from "@idenzy/domain/ports/email-provider";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { confirmPasswordResetSchema } from "@idenzy/protocol/schemas/auth";
import { NoStoredTemplates, TemplateRenderer } from "@idenzy/templating/renderer";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { AllowAll, CapturingEmailProvider, CountAll } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EmailChangeService } from "../dist/account/email-change-service.js";
import { EmailVerificationService } from "../dist/account/email-verification-service.js";
import { ProfileService } from "../dist/account/profile-service.js";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import { Mailer } from "../dist/delivery/mailer.js";
import { RedirectKind, RedirectTargets } from "../dist/delivery/redirect-targets.js";
import { SendingDomains } from "../dist/delivery/sending-domains.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { PasswordResetService } from "../dist/password/password-reset-service.js";
import { PasswordSignInFlow } from "../dist/password/password-sign-in.flow.js";
import { PasswordSignUpFlow } from "../dist/password/password-sign-up.flow.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  SilentLogger,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const RESET_PAGE = "https://app.test/reset";
const VERIFY_PAGE = "https://app.test/verify";
const CHANGE_PAGE = "https://app.test/email";
const clock = new SystemClock();
const actives = testActives(clock);
const revocations = testRevocations(clock);
const config = testConfig();
const hasher = new Argon2idHasher();

let uow: UnitOfWork;
let reset: PasswordResetService;
let verification: EmailVerificationService;
let changes: EmailChangeService;
let profile: ProfileService;
let signUp: PasswordSignUpFlow;
let signIn: PasswordSignInFlow;
let mail: CapturingEmailProvider;

class NoBreaches extends BreachedPasswordChecker {
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

/** A provider that is down, for the one case where that must not fail the caller. */
class FailingEmail extends EmailProvider {
  override readonly id = "failing";
  // Widens the abstract base's protected constructor, the same reason every concrete
  // OAuth provider carries one.
  constructor() {
    super(new AllowAll(), new CountAll());
  }
  protected override dispatch(): Promise<string> {
    return Promise.reject(new Error("provider unavailable"));
  }
}

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_account",
  ip: "203.0.113.4",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_account", "user");

/**
 * The token as the recipient sees it, out of the link in the mail we rendered.
 *
 * Read it after `request` and before `confirm`. `notifyOnChange` defaults on, so a
 * successful confirm puts a `password_changed` mail after the link in `sent` — and
 * `lastTo` is a `findLast`, so calling this afterwards finds a body with no link in it.
 */
function tokenIn(to: string): string {
  const body = mail.lastTo(to)?.text ?? "";
  const link = /https?:\/\/\S+/.exec(body)?.[0] ?? "";
  return new URL(link).searchParams.get("token") ?? "";
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

  mail = new CapturingEmailProvider();
  const mailer = new Mailer(
    uow,
    new TemplateRenderer(new NoStoredTemplates()),
    mail,
    new SendingDomains(uow, config),
  );
  const targets = new RedirectTargets(uow);

  reset = new PasswordResetService(
    uow,
    clock,
    hasher,
    new NoBreaches(),
    mailer,
    targets,
    new ProjectSettingsReader(uow),
    revocations.publisher,
    new SilentLogger(),
  );
  verification = new EmailVerificationService(uow, clock, mailer, targets, config);
  profile = new ProfileService(uow);
  changes = new EmailChangeService(uow, clock, mailer, targets, config);

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
    new NoBreaches(),
    new ProjectSettingsReader(uow),
  );
  signIn = new PasswordSignInFlow(
    sessions,
    hooks,
    audit,
    gate,
    actives,
    uow,
    hasher,
    clock,
    new ProjectSettingsReader(uow),
  );

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
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
  await uow.run(tenant, async (tx) => {
    const redirects = new RedirectUriRepository(tx, tenant);
    await redirects.register(RedirectKind.PasswordReset, RESET_PAGE);
    await redirects.register(RedirectKind.EmailVerification, VERIFY_PAGE);
    await redirects.register(RedirectKind.EmailChange, CHANGE_PAGE);
  });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("resetting a password", () => {
  const email = "resetme@a.test";
  const original = "the-original-password";

  beforeAll(async () => {
    sessionOf(await signUp.authenticate(context, { email, password: original }));
  });

  it("mails a link to the project's own reset page", async () => {
    await reset.request(context, email);
    expect(mail.lastTo(email)?.text).toContain(RESET_PAGE);
    expect(tokenIn(email)).toBeTruthy();
  });

  /**
   * PROJECT.md 4.5. A different answer for an address we do not know turns the reset
   * form into an account enumeration oracle, which is the classic leak on this route.
   */
  it("answers the same for an address that has no account, and mails nothing", async () => {
    await expect(reset.request(context, "ghost@a.test")).resolves.toBeUndefined();
    expect(mail.lastTo("ghost@a.test")).toBeNull();
  });

  it("changes the password and ends every session the account held", async () => {
    const before = sessionOf(await signIn.authenticate(context, { email, password: original }));
    await reset.request(context, email);
    await reset.confirm(context, {
      token: tokenIn(email),
      password: "a-brand-new-password",
    });

    const session = await uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).findById(before.sessionId),
    );
    expect(session?.isRevoked()).toBe(true);
    await expect(signIn.authenticate(context, { email, password: original })).rejects.toMatchObject(
      { code: "invalid_credentials" },
    );
    const after = sessionOf(
      await signIn.authenticate(context, {
        email,
        password: "a-brand-new-password",
      }),
    );
    expect(after.user.email).toBe(email);
  });

  it("spends the token once", async () => {
    await reset.request(context, email);
    const token = tokenIn(email);
    await reset.confirm(context, {
      token,
      password: "another-new-password",
    });
    await expect(
      reset.confirm(context, {
        token,
        password: "third-password-here",
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  /**
   * Two links in a mailbox and only the newest should mean anything. Otherwise the one
   * most likely to be readable by someone else is the one that still works.
   */
  it("kills the previous link when a new one is requested", async () => {
    await reset.request(context, email);
    const older = tokenIn(email);
    await reset.request(context, email);

    await expect(
      reset.confirm(context, {
        token: older,
        password: "should-not-work",
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  it("refuses an expired token and an invented one", async () => {
    await reset.request(context, email);
    await harness.owner.query(
      `UPDATE verification_tokens SET expires_at = now() - interval '1 minute'
       WHERE consumed_at IS NULL AND purpose = 'password_reset'`,
    );
    await expect(
      reset.confirm(context, {
        token: tokenIn(email),
        password: "x".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "challenge_expired" });
    await expect(
      reset.confirm(context, {
        token: generateOpaqueToken(),
        password: "x".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });
});

/**
 * The three controls the Passwords screen has always offered and the reset path has never
 * read. Each one is asserted in the direction that fails: a policy nothing enforces looks
 * exactly like a policy that is working, which is the whole reason these exist.
 *
 * The policy is written straight into `projects.settings` rather than through the
 * management API, as `password.integration.test.ts` does for the same section: this is the
 * enforcement under test and not the plumbing that stores it.
 */
describe("the project's reset policy", () => {
  const email = "policy@a.test";
  const original = "the-original-password";

  async function setPolicy(policy: Readonly<Record<string, unknown>>): Promise<void> {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
    await harness.owner.query(
      `UPDATE projects SET settings = jsonb_build_object('password', $2::jsonb) WHERE id = $1`,
      [PROJECT, JSON.stringify(policy)],
    );
  }

  async function outstandingExpiry(): Promise<Date> {
    const { rows } = await harness.owner.query<{ expires_at: Date }>(
      `SELECT expires_at FROM verification_tokens
       WHERE consumed_at IS NULL AND purpose = 'password_reset'
       ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (row === undefined) return expect.fail("no outstanding reset token");
    return new Date(row.expires_at);
  }

  beforeAll(async () => {
    await signUp.authenticate(context, { email, password: original });
  });

  afterEach(async () => {
    await setPolicy({});
  });

  /**
   * The clock the Lifetimes screen used to call deployment-fixed. Two projects producing
   * two different expiries is what says the setting reached the write; that it is refused
   * once past is already covered above.
   */
  it("gives the link the lifetime the project chose, not a deployment-wide one", async () => {
    await setPolicy({ resetLifetime: 10 });
    const before = Date.now();
    await reset.request(context, email);
    const short = (await outstandingExpiry()).getTime() - before;
    expect(short).toBeGreaterThan(9 * 60_000);
    expect(short).toBeLessThan(11 * 60_000);

    await setPolicy({ resetLifetime: 60 });
    const later = Date.now();
    await reset.request(context, email);
    const long = (await outstandingExpiry()).getTime() - later;
    expect(long).toBeGreaterThan(59 * 60_000);
  });

  /** Off means off: the other devices stay, and nothing is published about them. */
  it("leaves other sessions alive when the project says to", async () => {
    await setPolicy({ signOutOnReset: false });
    const before = sessionOf(await signIn.authenticate(context, { email, password: original }));
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: "kept-signed-in-please" });

    const session = await uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).findById(before.sessionId),
    );
    expect(session?.isRevoked()).toBe(false);
    expect(
      await revocations.set.isRevoked(PROJECT, {
        sessionId: before.sessionId,
        userId: before.user.id,
        issuedAt: Math.floor(clock.now().getTime() / 1000),
      }),
    ).toBe(false);
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: original });
  });

  /**
   * The attack the removed request field was. `signOutOtherSessions` used to ride on the
   * body, so whoever built the reset form could switch off a protection the account's
   * owner had been shown as on. The schema strips what it does not declare, so a client
   * still sending it is ignored rather than refused — and the project's answer stands.
   */
  it("ignores a caller still asking for the opposite", async () => {
    await setPolicy({ signOutOnReset: true });
    const before = sessionOf(await signIn.authenticate(context, { email, password: original }));
    await reset.request(context, email);
    const stale = {
      token: tokenIn(email),
      password: "the-caller-cannot-say",
      signOutOtherSessions: false,
    };
    await reset.confirm(context, confirmPasswordResetSchema.parse(stale));

    const session = await uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).findById(before.sessionId),
    );
    expect(session?.isRevoked()).toBe(true);
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: original });
  });

  /**
   * A minimum only one of the two paths enforced was not a minimum: sign-up refused a
   * short password and a reset link set one anyway, with no session needed to do it.
   */
  it("refuses a password under the project's minimum", async () => {
    await setPolicy({ minLength: 20 });
    await reset.request(context, email);
    const token = tokenIn(email);
    await expect(
      reset.confirm(context, { token, password: "nineteen-chars-xyz" }),
    ).rejects.toMatchObject({ code: "password_too_short" });

    // The same link still works for a password that clears the bar, so the refusal did
    // not spend it.
    await reset.confirm(context, { token, password: "twenty-characters-ok" });
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: original });
  });

  it("mails the account when the project asks to be told, and nothing when it does not", async () => {
    await setPolicy({ notifyOnChange: true });
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: "told-about-this-one" });
    const told = mail.lastTo(email);
    expect(told?.subject).toContain("password was changed");
    // No destination is invented: the only URI we hold is where a reset token lands.
    expect(told?.text).not.toMatch(/https?:\/\//);

    await setPolicy({ notifyOnChange: false });
    await reset.request(context, email);
    const quiet = mail.sent.length;
    await reset.confirm(context, { token: tokenIn(email), password: original });
    expect(mail.sent.length).toBe(quiet);
  });

  /**
   * The honesty property of the whole notification. The password is committed by the time
   * the mail is attempted, so a send that throws must not come back as a failed reset —
   * the user would be sent round again to a form their new password already works against.
   */
  it("changes the password even when the notification cannot be sent", async () => {
    await setPolicy({ notifyOnChange: true });
    const broken = new PasswordResetService(
      uow,
      clock,
      hasher,
      new NoBreaches(),
      new Mailer(
        uow,
        new TemplateRenderer(new NoStoredTemplates()),
        new FailingEmail(),
        new SendingDomains(uow, config),
      ),
      new RedirectTargets(uow),
      new ProjectSettingsReader(uow),
      revocations.publisher,
      new SilentLogger(),
    );
    await reset.request(context, email);
    await expect(
      broken.confirm(context, { token: tokenIn(email), password: "sent-nowhere-at-all" }),
    ).resolves.toBeUndefined();

    const after = sessionOf(
      await signIn.authenticate(context, { email, password: "sent-nowhere-at-all" }),
    );
    expect(after.user.email).toBe(email);
    await reset.request(context, email);
    await reset.confirm(context, { token: tokenIn(email), password: original });
  });
});

describe("verifying an address", () => {
  let userId = "";

  beforeAll(async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "verifyme@a.test",
        password: "verify-me-password",
      }),
    );
    userId = issued.userId;
  });

  it("marks the address verified when the link is confirmed", async () => {
    await verification.request(context, userId);
    await verification.confirm(context, tokenIn("verifyme@a.test"));

    const user = await uow.run(tenant, (tx) => new UserRepository(tx, tenant).findById(userId));
    expect(user?.emailVerified).toBe(true);
  });

  it("does nothing and mails nothing when the address is already verified", async () => {
    const before = mail.sent.length;
    await verification.request(context, userId);
    expect(mail.sent.length).toBe(before);
  });

  /**
   * A reset token accepted here would let anyone who can trigger a reset for an address
   * they do not own have it marked verified.
   */
  it("will not accept a password reset token", async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "crossed@a.test",
        password: "crossed-wires-password",
      }),
    );
    await reset.request(context, "crossed@a.test");

    await expect(verification.confirm(context, tokenIn("crossed@a.test"))).rejects.toMatchObject({
      code: "challenge_invalid",
    });
    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findById(issued.userId),
    );
    expect(user?.emailVerified).toBe(false);
  });
});

describe("changing an address", () => {
  let userId = "";
  const from = "movingfrom@a.test";
  const to = "movingto@a.test";

  beforeAll(async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, { email: from, password: "moving-password" }),
    );
    userId = issued.userId;
  });

  it("writes to both addresses, and tells the old one where it is going", async () => {
    await changes.request(context, userId, to);
    expect(mail.lastTo(from)?.text).toContain(to);
    expect(mail.lastTo(to)).not.toBeNull();
    expect(tokenIn(from)).not.toBe(tokenIn(to));
  });

  /**
   * PROJECT.md 4.5. The first thing an attacker does with a stolen session is move the
   * account somewhere the owner cannot reach, so one confirmation is not enough however
   * convenient that would be.
   */
  it("does not move the address on one confirmation alone", async () => {
    expect(await changes.confirm(context, tokenIn(to))).toBe(false);
    const user = await uow.run(tenant, (tx) => new UserRepository(tx, tenant).findById(userId));
    expect(user?.email).toBe(from);
  });

  it("moves it, verified, once both sides have confirmed", async () => {
    expect(await changes.confirm(context, tokenIn(from))).toBe(true);
    const user = await uow.run(tenant, (tx) => new UserRepository(tx, tenant).findById(userId));
    expect(user?.email).toBe(to);
    // Confirming the link sent to the new address is exactly what verification asks for.
    expect(user?.emailVerified).toBe(true);
  });

  it("refuses to confirm an applied change twice", async () => {
    await expect(changes.confirm(context, tokenIn(to))).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  it("refuses an address that already belongs to someone else", async () => {
    sessionOf(
      await signUp.authenticate(context, { email: "taken@a.test", password: "taken-password" }),
    );
    await expect(changes.request(context, userId, "taken@a.test")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("abandons an earlier request when a new one is made", async () => {
    await changes.request(context, userId, "first-target@a.test");
    const staleOld = tokenIn(to);
    await changes.request(context, userId, "second-target@a.test");

    await expect(changes.confirm(context, staleOld)).rejects.toMatchObject({
      code: "challenge_expired",
    });
  });
});

describe("reading your own profile", () => {
  it("returns the signed-in user, and nothing private", async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "profile@a.test",
        password: "profile-password",
      }),
    );

    const me = await profile.me(context, issued.userId);
    expect(me.email).toBe("profile@a.test");
    expect(me.id).toBe(issued.user.publicId);
    // The projection is the same one every other endpoint hands back, so a field that is
    // private in one place cannot be public here.
    expect(Object.keys(me)).not.toContain("metadataPrivate");
  });

  it("answers session_revoked, not 404, when the user behind a live session is gone", async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "vanished@a.test",
        password: "vanished-password",
      }),
    );
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
    await harness.owner.query(`DELETE FROM users WHERE id = $1`, [issued.userId]);

    // Not-found would invite the client to retry. The session proved valid a moment ago, so
    // a missing user means the session should already have died.
    await expect(profile.me(context, issued.userId)).rejects.toMatchObject({
      code: "session_revoked",
    });
  });

  it("does not resolve a user belonging to another project", async () => {
    const issued = sessionOf(
      await signUp.authenticate(context, {
        email: "elsewhere@a.test",
        password: "elsewhere-password",
      }),
    );
    const other: FlowContext = { ...context, projectId: "99999999-9999-9999-9999-999999999999" };

    await expect(profile.me(other, issued.userId)).rejects.toMatchObject({
      code: "session_revoked",
    });
  });
});
