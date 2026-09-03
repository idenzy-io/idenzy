import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { TemplateType } from "@idenzy/protocol/enums/delivery";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { NoStoredTemplates, TemplateRenderer } from "@idenzy/templating/renderer";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { CapturingEmailProvider } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../dist/delivery/mailer.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { EmailOtpFlow } from "../dist/otp/email-otp.flow.js";
import { EmailOtpService } from "../dist/otp/email-otp-service.js";
import { SessionService } from "../dist/session/session-service.js";
import { testConfig, testMfaGate, testRevocations } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const clock = new SystemClock();
const revocations = testRevocations(clock);
const config = testConfig();
const hasher = new Argon2idHasher();
const encryptor = new FieldEncryptor(developmentDataKey("test"));

let uow: UnitOfWork;
let service: EmailOtpService;
let flow: EmailOtpFlow;
let mail: CapturingEmailProvider;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_otp",
  ip: "203.0.113.7",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_otp", "user");

/** The code as the user reads it, out of the mail we actually rendered. */
function codeIn(to: string): string {
  const body = mail.lastTo(to)?.text ?? "";
  return /\b(\d{6})\b/.exec(body)?.[1] ?? "";
}

async function start(email: string): Promise<string> {
  const started = await service.start(context, email);
  return started.challengeId;
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const gate = testMfaGate(uow, clock, config);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(uow, clock, issuer, config, revocations.publisher);

  mail = new CapturingEmailProvider();
  const mailer = new Mailer(uow, new TemplateRenderer(new NoStoredTemplates()), mail, config);
  service = new EmailOtpService(uow, clock, hasher, encryptor, mailer, config);
  flow = new EmailOtpFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    uow,
    clock,
    hasher,
    encryptor,
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
     VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("starting a challenge", () => {
  it("mails a code carrying the project's own name", async () => {
    await start("newcomer@a.test");
    const message = mail.lastTo("newcomer@a.test");
    expect(message?.subject).toContain("Acme");
    expect(codeIn("newcomer@a.test")).toMatch(/^\d{6}$/);
  });

  /**
   * PROJECT.md 4.7. Start must not be an account-enumeration oracle, and here it is not
   * a careful imitation of one shape by another: there is no branch on whether the
   * account exists, because an unknown address gets a real code and verifying it creates
   * the account.
   */
  it("answers the same for a known and an unknown address", async () => {
    const known = await start("newcomer@a.test");
    const unknown = await start("nobody-at-all@a.test");
    expect(known.startsWith("chl_")).toBe(true);
    expect(unknown.startsWith("chl_")).toBe(true);
    expect(known).not.toBe(unknown);
  });

  it("never stores the address or the code in a form the table can give back", async () => {
    await start("secret@a.test");
    const { rows } = await harness.owner.query<{ target_encrypted: string; code_hash: string }>(
      `SELECT target_encrypted, code_hash FROM otp_challenges ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.target_encrypted).not.toContain("secret@a.test");
    expect(rows[0]?.code_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.code_hash).not.toContain(codeIn("secret@a.test"));
  });

  it("retires the previous code, so a resend leaves exactly one that works", async () => {
    const first = await start("resend@a.test");
    const firstCode = codeIn("resend@a.test");
    const second = await start("resend@a.test");

    await expect(
      flow.authenticate(context, { challengeId: first, code: firstCode }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
    const issued = sessionOf(
      await flow.authenticate(context, {
        challengeId: second,
        code: codeIn("resend@a.test"),
      }),
    );
    expect(issued.user.email).toBe("resend@a.test");
  });
});

describe("verifying a challenge", () => {
  it("creates a verified account for an address that had none", async () => {
    const challengeId = await start("fresh@a.test");
    const issued = sessionOf(
      await flow.authenticate(context, {
        challengeId,
        code: codeIn("fresh@a.test"),
      }),
    );

    expect(issued.user.email).toBe("fresh@a.test");
    // Stronger than password sign-up produces: they read a message we sent there.
    expect(issued.user.emailVerified).toBe(true);
    expect(issued.accessToken.split(".")).toHaveLength(3);
  });

  it("signs an existing user in and marks their address verified", async () => {
    await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).create({
        email: "existing@a.test",
        emailVerified: false,
        phone: null,
        passwordHash: null,
        passwordAlgoVersion: null,
        displayName: null,
        avatarUrl: null,
      }),
    );
    const challengeId = await start("existing@a.test");
    const issued = sessionOf(
      await flow.authenticate(context, {
        challengeId,
        code: codeIn("existing@a.test"),
      }),
    );
    expect(issued.user.emailVerified).toBe(true);
  });

  it("cannot be replayed, however close together the two attempts arrive", async () => {
    const challengeId = await start("replay@a.test");
    const code = codeIn("replay@a.test");
    const outcomes = await Promise.allSettled([
      flow.authenticate(context, { challengeId, code }),
      flow.authenticate(context, { challengeId, code }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  });

  /**
   * The counter has to survive the failed request. If a wrong guess only counted when
   * the request succeeded, the cap of five would never advance and the whole six-digit
   * keyspace would be walkable.
   */
  it("kills the challenge after five wrong guesses, and counts them even though each call fails", async () => {
    const challengeId = await start("bruteforce@a.test");
    const wrong = codeIn("bruteforce@a.test") === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(flow.authenticate(context, { challengeId, code: wrong })).rejects.toMatchObject({
        code: "challenge_invalid",
      });
    }
    await expect(flow.authenticate(context, { challengeId, code: wrong })).rejects.toMatchObject({
      code: "challenge_attempts_exhausted",
    });

    // Dead even for the right code, which is the point of an attempt cap.
    await expect(
      flow.authenticate(context, { challengeId, code: codeIn("bruteforce@a.test") }),
    ).rejects.toMatchObject({ code: "challenge_attempts_exhausted" });
  });

  it("refuses a challenge that has expired", async () => {
    const challengeId = await start("expired@a.test");
    await harness.owner.query(
      `UPDATE otp_challenges SET expires_at = now() - interval '1 minute'
       WHERE consumed_at IS NULL`,
    );
    await expect(
      flow.authenticate(context, { challengeId, code: codeIn("expired@a.test") }),
    ).rejects.toMatchObject({ code: "challenge_expired" });
  });

  it("refuses a challenge id that was never issued", async () => {
    await expect(
      flow.authenticate(context, {
        challengeId: "chl_00000000000000000000000000000000",
        code: "123456",
      }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });
});

describe("what the code lands in", () => {
  it("renders the built-in template, not a string built at the call site", async () => {
    await start("template@a.test");
    const message = mail.lastTo("template@a.test");
    expect(message?.html).toContain("Your sign-in code");
    expect(message?.text).toContain("expires in 10 minutes");
    expect(message?.from).toBe(config.get("EMAIL_FROM_ADDRESS"));
  });

  it("uses the type the flow asked for", () => {
    expect(TemplateType.EmailOtp).toBe("email_otp");
  });

  it("burns the challenge row itself, not only the session path", async () => {
    const challengeId = await start("cleanup@a.test");
    sessionOf(await flow.authenticate(context, { challengeId, code: codeIn("cleanup@a.test") }));

    const { rows } = await harness.owner.query<{ consumed_at: Date | null }>(
      `SELECT consumed_at FROM otp_challenges WHERE id = $1`,
      [PublicId.parse(IdPrefix.Challenge, challengeId).uuid],
    );
    expect(rows[0]?.consumed_at).not.toBeNull();
  });
});
