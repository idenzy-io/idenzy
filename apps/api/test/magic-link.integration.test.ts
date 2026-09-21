import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { NoStoredTemplates, TemplateRenderer } from "@idenzy/templating/renderer";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { CapturingEmailProvider } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import { Mailer } from "../dist/delivery/mailer.js";
import { SendingDomains } from "../dist/delivery/sending-domains.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { MagicLinkFlow } from "../dist/magic-link/magic-link.flow.js";
import { MAGIC_LINK_REDIRECT, MagicLinkService } from "../dist/magic-link/magic-link-service.js";
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
const REGISTERED = "https://app.test/auth/finish";
const clock = new SystemClock();
const actives = testActives(clock);
const revocations = testRevocations(clock);
const config = testConfig();
const encryptor = new FieldEncryptor(developmentDataKey("test"));

let uow: UnitOfWork;
let service: MagicLinkService;
let flow: MagicLinkFlow;
let mail: CapturingEmailProvider;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_link",
  ip: "203.0.113.9",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_link", "user");

/** The token as the user's mail client sees it, out of the link we actually rendered. */
function tokenIn(to: string): string {
  const body = mail.lastTo(to)?.text ?? "";
  const link = /https?:\/\/\S+/.exec(body)?.[0] ?? "";
  return new URL(link).searchParams.get("token") ?? "";
}

async function clickThrough(email: string): Promise<string> {
  await service.start(context, email, REGISTERED);
  const destination = await service.follow(context, tokenIn(email));
  return new URL(destination).searchParams.get("code") ?? "";
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
  service = new MagicLinkService(
    uow,
    clock,
    encryptor,
    mailer,
    config,
    new ProjectSettingsReader(uow),
  );
  flow = new MagicLinkFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    gate,
    actives,
    uow,
    clock,
  );

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    // Magic links are off in `DEFAULT_PROJECT_SETTINGS`, and the service reads that before
    // anything else, so a project seeded with bare defaults refuses every test in this file.
    // The allowlist stays where it is: `redirect_uris` is the table the exchange checks, and
    // the settings copy of it is a different list for a different purpose.
    `INSERT INTO projects (id, org_id, name, kms_key_name, settings)
     VALUES ($1, $2, 'Acme', 'k',
             '{"otp":{"magicLink":{"enabled":true,"allowSignUp":true}}}'::jsonb)`,
    [PROJECT, rows[0]?.id],
  );
  await uow.transaction((tx) =>
    new RedirectUriRepository(tx, tenant).register(MAGIC_LINK_REDIRECT, REGISTERED),
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("issuing a link", () => {
  it("mails a link pointing at our own callback, not at the customer's route", async () => {
    await service.start(context, "linked@a.test", REGISTERED);
    const link = /https?:\/\/\S+/.exec(mail.lastTo("linked@a.test")?.text ?? "")?.[0] ?? "";
    expect(link.startsWith(`${config.get("ISSUER_BASE_URL")}/v1/auth/magic-link/callback`)).toBe(
      true,
    );
    expect(new URL(link).searchParams.get("token")).toBeTruthy();
  });

  /**
   * PROJECT.md 4.6 and 4.7. We render no page, so this allowlist is the only thing
   * between our redirect and an attacker's, and our domain in front of their page is the
   * most valuable phishing asset an auth provider can hand out.
   */
  it("refuses a redirect target the project did not register, and says nothing about it", async () => {
    for (const attempt of [
      "https://evil.test/steal",
      `${REGISTERED}/`,
      `${REGISTERED}?next=https://evil.test`,
      "https://app.test.evil.test/auth/finish",
      "http://app.test/auth/finish",
    ]) {
      const error = await service
        .start(context, "probe@a.test", attempt)
        .catch((caught: unknown) => caught);
      expect(error, attempt).toMatchObject({ code: "redirect_uri_not_allowed", status: 400 });
      expect((error as Error).message, attempt).not.toContain(attempt);
    }
    expect(mail.lastTo("probe@a.test")).toBeNull();
  });

  it("stores the address encrypted rather than in clear", async () => {
    await service.start(context, "stored@a.test", REGISTERED);
    const { rows } = await harness.owner.query<{ target_encrypted: string }>(
      `SELECT target_encrypted FROM magic_link_tokens ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.target_encrypted).not.toContain("stored@a.test");
  });
});

describe("following a link", () => {
  it("redirects to the registered route carrying a code and nothing else", async () => {
    await service.start(context, "click@a.test", REGISTERED);
    const destination = new URL(await service.follow(context, tokenIn("click@a.test")));

    expect(destination.origin + destination.pathname).toBe(REGISTERED);
    expect([...destination.searchParams.keys()]).toEqual(["code"]);
    // A session in a URL is a session in browser history, a Referer header and the
    // customer's access logs. The redirect must carry none of it.
    expect(destination.toString()).not.toContain("eyJ");
  });

  it("sends the browser where the token was minted for, not where the click asks", async () => {
    await service.start(context, "pinned@a.test", REGISTERED);
    const destination = await service.follow(context, tokenIn("pinned@a.test"));
    expect(destination.startsWith(REGISTERED)).toBe(true);
  });

  /**
   * A mail scanner that follows links pre-consumes the token, which is exactly why OTP is
   * the default and links are the option. Whoever arrives second gets nothing.
   */
  it("burns the token on the first click", async () => {
    await service.start(context, "scanner@a.test", REGISTERED);
    const token = tokenIn("scanner@a.test");
    await service.follow(context, token);
    await expect(service.follow(context, token)).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  it("refuses an expired link", async () => {
    await service.start(context, "stale@a.test", REGISTERED);
    await harness.owner.query(
      `UPDATE magic_link_tokens SET expires_at = now() - interval '1 minute'
       WHERE consumed_at IS NULL`,
    );
    await expect(service.follow(context, tokenIn("stale@a.test"))).rejects.toMatchObject({
      code: "challenge_expired",
    });
  });

  it("cannot be talked into a redirect by an unknown token", async () => {
    await expect(service.follow(context, generateOpaqueToken())).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });
});

describe("exchanging the code", () => {
  it("returns a session for a verified account it may have just created", async () => {
    const code = await clickThrough("exchanged@a.test");
    const issued = sessionOf(await flow.authenticate(context, { code }));

    expect(issued.user.email).toBe("exchanged@a.test");
    expect(issued.user.emailVerified).toBe(true);
    expect(issued.accessToken.split(".")).toHaveLength(3);
  });

  it("spends the code exactly once", async () => {
    const code = await clickThrough("spent@a.test");
    sessionOf(await flow.authenticate(context, { code }));
    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  /**
   * `auth_codes` is shared with OAuth on purpose, so this endpoint has to refuse a code
   * minted for another route. Without the check, a session's amr would stop describing
   * what was actually proved.
   */
  it("refuses a code that was minted for a different method", async () => {
    const code = generateOpaqueToken();
    const borrowed = await clickThrough("mixer@a.test");
    const session = sessionOf(await flow.authenticate(context, { code: borrowed }));

    await uow.transaction((tx) =>
      new AuthCodeRepository(tx, tenant).issue({
        userId: session.userId,
        codeHash: hashToken(code),
        amr: [AuthMethod.Oauth],
        codeChallenge: null,
        redirectUri: REGISTERED,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );

    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  it("refuses an expired code", async () => {
    const code = await clickThrough("late@a.test");
    await harness.owner.query(
      `UPDATE auth_codes SET expires_at = now() - interval '1 minute' WHERE consumed_at IS NULL`,
    );
    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "challenge_expired",
    });
  });

  it("refuses a suspended account even though the click already happened", async () => {
    const code = await clickThrough("banned-link@a.test");
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
    await harness.owner.query(
      `UPDATE users SET banned_until = now() + interval '1 day' WHERE email = 'banned-link@a.test'`,
    );
    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "account_banned",
    });
  });
});
