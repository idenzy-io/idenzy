import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { FraudGuard, SpendCap } from "@idenzy/domain/ports/sms-provider";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { LoggingSmsProvider } from "@idenzy/providers-sms/logging-sms-provider";
import { MetadataPhoneGeography } from "@idenzy/providers-sms/metadata-phone-geography";
import { ProviderRouter } from "@idenzy/providers-sms/provider-router";
import { NoStoredSmsTemplates, SmsRenderer } from "@idenzy/templating/sms-renderer";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import { Texter } from "../dist/delivery/texter.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { EmailOtpFlow } from "../dist/otp/email-otp.flow.js";
import { OtpVerification } from "../dist/otp/otp-verification.js";
import { SmsOtpFlow } from "../dist/otp/sms-otp.flow.js";
import { SmsOtpService } from "../dist/otp/sms-otp-service.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "55555555-5555-5555-5555-555555555555";
const clock = new SystemClock();
const actives = testActives(clock);
const revocations = testRevocations(clock);
const config = testConfig();
const hasher = new Argon2idHasher();
const encryptor = new FieldEncryptor(developmentDataKey("test"));

/** Keeps every rendered body, so a test reads the code the way the handset would. */
class CapturingLogger extends Logger {
  readonly lines: string[] = [];
  override debug(): void {}
  override info(message: string): void {
    this.lines.push(message);
  }
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

const allowing: FraudGuard = { assertAllowed: () => Promise.resolve() };
const unlimited: SpendCap = { reserve: () => Promise.resolve(), settle: () => Promise.resolve() };

let uow: UnitOfWork;
let gate: ReturnType<typeof testMfaGate>;
let service: SmsOtpService;
let verification: OtpVerification;
let smsFlow: SmsOtpFlow;
let transcript: CapturingLogger;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_sms_otp",
  ip: "203.0.113.11",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};

const PHONE = E164PhoneNumber.parse("+14155550101");

/** The code as the recipient reads it, out of the message we actually rendered. */
function codeIn(number: string): string {
  const line = transcript.lines.findLast((entry) => entry.includes(number)) ?? "";
  return /\b(\d{6})\b/.exec(line)?.[1] ?? "";
}

async function start(number: E164PhoneNumber): Promise<string> {
  const started = await service.start(context, number);
  return started.challengeId;
}

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
    new ProjectSettingsReader(uow),
  );

  transcript = new CapturingLogger();
  const geography = new MetadataPhoneGeography();
  const provider = new LoggingSmsProvider(allowing, unlimited, transcript, "development");
  const router = new ProviderRouter(
    [provider],
    [{ country: "*", providers: [provider.id] }],
    clock,
  );
  const texter = new Texter(uow, new SmsRenderer(new NoStoredSmsTemplates()), router, geography);
  service = new SmsOtpService(
    uow,
    clock,
    hasher,
    encryptor,
    texter,
    config,
    new ProjectSettingsReader(uow),
  );

  const hooks = new NullFlowHooks();
  const audit = new OutboxFlowAudit(uow, clock);
  smsFlow = new SmsOtpFlow(sessions, hooks, audit, gate, actives, uow, clock, hasher, encryptor);
  verification = new OtpVerification(
    uow,
    new EmailOtpFlow(sessions, hooks, audit, gate, actives, uow, clock, hasher, encryptor),
    smsFlow,
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
  // SMS OTP is off in `DEFAULT_PROJECT_SETTINGS`, and deliberately: it costs money per
  // message and is the channel fraud reaches for first, so a project has to ask for it. The
  // service reads that setting before anything else, so a project seeded with bare defaults
  // refuses every test in this file — which is what it did until this line existed.
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name, settings)
     VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k',
             '{"otp":{"sms":{"enabled":true,"allowSignUp":true}}}'::jsonb)`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("starting an sms challenge", () => {
  it("texts a code carrying the project's own name", async () => {
    await start(PHONE);
    const line = transcript.lines.findLast((entry) => entry.includes(PHONE.value)) ?? "";
    expect(line).toContain("Acme");
    expect(codeIn(PHONE.value)).toMatch(/^\d{6}$/);
  });

  /**
   * The same property the email path has, for the same reason: there is no branch on
   * whether the number has an account, because an unknown one gets a real code and
   * verifying it creates the account.
   */
  it("answers the same for a known and an unknown number", async () => {
    const known = await start(PHONE);
    const unknown = await start(E164PhoneNumber.parse("+14155550102"));
    expect(known.startsWith("chl_")).toBe(true);
    expect(unknown.startsWith("chl_")).toBe(true);
  });

  it("never stores the number or the code in a form the table can give back", async () => {
    const number = E164PhoneNumber.parse("+14155550103");
    await start(number);
    const { rows } = await harness.owner.query<{ target_encrypted: string; code_hash: string }>(
      `SELECT target_encrypted, code_hash FROM otp_challenges ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.target_encrypted).not.toContain(number.value);
    expect(rows[0]?.code_hash).toMatch(/^\$argon2id\$/);
  });
});

describe("verifying an sms challenge", () => {
  it("creates the account with the number already verified", async () => {
    const number = E164PhoneNumber.parse("+14155550110");
    const challengeId = await start(number);
    const issued = sessionOf(
      await verification.authenticate(context, {
        challengeId,
        code: codeIn(number.value),
      }),
    );

    expect(issued.user.phone).toBe(number.value);
    expect(issued.user.phoneVerified).toBe(true);
    expect(issued.accessToken.length).toBeGreaterThan(0);
  });

  it("signs the same number back in rather than creating a second account", async () => {
    const number = E164PhoneNumber.parse("+14155550111");
    const first = sessionOf(
      await verification.authenticate(context, {
        challengeId: await start(number),
        code: codeIn(number.value),
      }),
    );
    const second = sessionOf(
      await verification.authenticate(context, {
        challengeId: await start(number),
        code: codeIn(number.value),
      }),
    );

    expect(second.userId).toBe(first.userId);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  /**
   * The denominator the fraud guard's pumping ratio is built from. Counted in the
   * transaction that consumed the challenge, so it cannot run twice for one code.
   */
  it("counts the verification against the day's sends", async () => {
    const before = await verifiedCount();
    const number = E164PhoneNumber.parse("+14155550112");
    sessionOf(
      await verification.authenticate(context, {
        challengeId: await start(number),
        code: codeIn(number.value),
      }),
    );
    expect(await verifiedCount()).toBe(before + 1);
  });

  it("refuses a code that was already spent", async () => {
    const number = E164PhoneNumber.parse("+14155550113");
    const challengeId = await start(number);
    const code = codeIn(number.value);

    sessionOf(await verification.authenticate(context, { challengeId, code }));
    await expect(verification.authenticate(context, { challengeId, code })).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  it("costs an attempt for a wrong code, and dies on the fifth", async () => {
    const number = E164PhoneNumber.parse("+14155550114");
    const challengeId = await start(number);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        verification.authenticate(context, { challengeId, code: "000000" }),
      ).rejects.toMatchObject({ code: "challenge_invalid" });
    }
    await expect(
      verification.authenticate(context, { challengeId, code: "000000" }),
    ).rejects.toMatchObject({ code: "challenge_attempts_exhausted" });

    await expect(
      verification.authenticate(context, { challengeId, code: codeIn(number.value) }),
    ).rejects.toMatchObject({ code: "challenge_attempts_exhausted" });
  });

  /**
   * The reason each flow checks the channel for itself rather than trusting the dispatch.
   * An SMS challenge resolved by the email flow would look a phone number up in the email
   * column, miss, and create an account with a phone number stored as an address, on a
   * code the caller had every right to present.
   */
  it("refuses an sms challenge handed to the email flow", async () => {
    const number = E164PhoneNumber.parse("+14155550115");
    const challengeId = await start(number);
    const email = new EmailOtpFlow(
      await sessionsFor(),
      new NullFlowHooks(),
      new OutboxFlowAudit(uow, clock),
      gate,
      actives,
      uow,
      clock,
      hasher,
      encryptor,
    );

    await expect(
      email.authenticate(context, { challengeId, code: codeIn(number.value) }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });

    // And the challenge is still good for the flow it belongs to.
    const issued = sessionOf(
      await smsFlow.authenticate(context, {
        challengeId,
        code: codeIn(number.value),
      }),
    );
    expect(issued.user.phone).toBe(number.value);
  });
});

async function sessionsFor(): Promise<SessionService> {
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  return new SessionService(
    uow,
    clock,
    issuer,
    config,
    revocations.publisher,
    claimTemplates(uow, clock),
    new NullAnalyticsRecorder(),
    new ProjectSettingsReader(uow),
  );
}

async function verifiedCount(): Promise<number> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  const { rows } = await harness.owner.query<{ sms_verified: string }>(
    `SELECT sms_verified FROM usage_daily
     WHERE project_id = $1 AND day = (now() at time zone 'utc')::date`,
    [PROJECT],
  );
  return Number(rows[0]?.sms_verified ?? 0);
}
