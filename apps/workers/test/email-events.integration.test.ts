import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { suppressionDigest } from "@idenzy/crypto/delivery/suppression-digest";
import { EmailDeliveryStatsRepository } from "@idenzy/persistence/repository/email-delivery-stats-repository";
import { EmailProviderEventRepository } from "@idenzy/persistence/repository/email-provider-event-repository";
import { EmailSendingHoldRepository } from "@idenzy/persistence/repository/email-sending-hold-repository";
import { ProjectEmailActivityReader } from "@idenzy/persistence/repository/project-email-activity-reader";
import { SuppressionRepository } from "@idenzy/persistence/repository/suppression-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  SnsMessageVerifier,
  SnsSubscriptionConfirmer,
} from "@idenzy/providers-email/aws/sns-message-verifier";
import { PROJECT_TAG } from "@idenzy/providers-email/ses-events";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailEventEndpoint } from "../src/email/email-event-endpoint.js";
import { EmailReputationBreaker } from "../src/email/email-reputation-breaker.js";

/**
 * The SES feedback loop, against a real Postgres (risks.md 2 and 2b).
 *
 * Two properties here are only observable with the database in place, and both are the whole
 * point of the design. A redelivered notification must move no counter — the guard is a unique
 * index and nothing else, so a fake would agree with whatever this code believed about its own
 * idempotency. And a hold must be readable by the send path under the project's own tenant key
 * while being invisible to every other project, which is a privilege question rather than a
 * code one.
 */

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";
const TOPIC = "arn:aws:sns:eu-west-1:123456789012:idenzy-email-events";
const CERT_URL = "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-test.pem";

let uow: UnitOfWork;
let privateKey: string;
let certificate: string;
let workDir: string;
let nextMessageId = 0;

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

class FixedClock extends Clock {
  constructor(private instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
  moveTo(instant: Date): void {
    this.instant = instant;
  }
}

const clock = new FixedClock(new Date("2026-03-04T11:10:00Z"));

/** A fresh SNS message id, so two notifications are not each other's duplicate by accident. */
function nextId(): string {
  nextMessageId += 1;
  return `msg-${String(nextMessageId)}`;
}

/** A signed SNS envelope carrying an SES event, the way the real topic sends one. */
function notification(event: Readonly<Record<string, unknown>>, messageId?: string): string {
  const envelope: Record<string, string> = {
    Type: "Notification",
    MessageId: messageId ?? nextId(),
    TopicArn: TOPIC,
    Message: JSON.stringify(event),
    Timestamp: "2026-03-04T11:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL: CERT_URL,
  };

  let canonical = "";
  for (const field of ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]) {
    const value = envelope[field];
    if (value === undefined) continue;
    canonical += `${field}\n${value}\n`;
  }
  const signer = createSign("RSA-SHA1");
  signer.update(canonical, "utf8");
  envelope["Signature"] = signer.sign(privateKey, "base64");
  return JSON.stringify(envelope);
}

const bounce = (address: string, type = "Permanent", subType = "General") => ({
  eventType: "Bounce",
  mail: { messageId: "ses-1", tags: { [PROJECT_TAG]: [PROJECT] } },
  bounce: {
    bounceType: type,
    bounceSubType: subType,
    bouncedRecipients: [{ emailAddress: address }],
  },
});

const complaint = (address: string) => ({
  eventType: "Complaint",
  mail: { messageId: "ses-2", tags: { [PROJECT_TAG]: [PROJECT] } },
  complaint: { complainedRecipients: [{ emailAddress: address }] },
});

const send = (projectId = PROJECT) => ({
  eventType: "Send",
  mail: { messageId: "ses-3", tags: { [PROJECT_TAG]: [projectId] } },
});

function endpoint(): EmailEventEndpoint {
  return new EmailEventEndpoint(
    uow,
    new EmailProviderEventRepository(harness.db),
    new SnsMessageVerifier({ topicArns: [TOPIC] }),
    new SnsSubscriptionConfirmer(),
    clock,
    new SilentLogger(),
  );
}

function inTenant<T>(
  projectId: string,
  work: (repos: {
    stats: EmailDeliveryStatsRepository;
    holds: EmailSendingHoldRepository;
    suppressions: SuppressionRepository;
  }) => Promise<T>,
): Promise<T> {
  const tenant = new TenantContext(projectId, "req_test", "system");
  return uow.transaction((tx) =>
    work({
      stats: new EmailDeliveryStatsRepository(tx, tenant),
      holds: new EmailSendingHoldRepository(tx, tenant),
      suppressions: new SuppressionRepository(tx, tenant),
    }),
  );
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "ses-events-"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyPath = join(workDir, "key.pem");
  const certPath = join(workDir, "cert.pem");
  writeFileSync(keyPath, privateKey);
  execFileSync("openssl", [
    "req",
    "-new",
    "-x509",
    "-key",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=sns.amazonaws.com",
  ]);
  certificate = readFileSync(certPath, "utf8");

  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  for (const id of [PROJECT, OTHER_PROJECT]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [id, rows[0]?.id],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(certificate, { status: 200 }))),
  );
  clock.moveTo(new Date("2026-03-04T11:10:00Z"));
  await harness.owner.query(
    `TRUNCATE email_delivery_stats, email_sending_holds, email_provider_events, suppressions`,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("receiving an SES delivery event", () => {
  it("suppresses a hard bounce under the project its tag names, and counts it", async () => {
    expect(await endpoint().run(notification(bounce("dead@example.test")))).toBe("recorded");

    const found = await inTenant(PROJECT, async ({ stats, suppressions }) => ({
      window: await stats.since("2026-03-01"),
      // Hashed with the same function the send path looks up with; two spellings of that
      // digest would make every lookup miss and the list read as permanently empty.
      blocked: await suppressions.isSuppressed("email", suppressionDigest("dead@example.test")),
      // And the casing the bounce reported is not the casing we sent.
      blockedOtherCase: await suppressions.isSuppressed(
        "email",
        suppressionDigest("DEAD@Example.Test"),
      ),
    }));

    expect(found.window.bounced).toBe(1);
    expect(found.blocked).toBe(true);
    expect(found.blockedOtherCase).toBe(true);
  });

  /*
   * The property the whole ledger exists for. SNS is at-least-once, so a redelivery is
   * ordinary — and a rate is the one thing double counting actually breaks: suppressing an
   * address twice is harmless, deciding a project bounces at 10% when it bounces at 5% stops
   * a blameless customer's mail.
   */
  it("moves nothing on a redelivery of the same message", async () => {
    const same = notification(bounce("dead@example.test"), "sns-duplicate");

    expect(await endpoint().run(same)).toBe("recorded");
    expect(await endpoint().run(same)).toBe("duplicate");
    expect(await endpoint().run(same)).toBe("duplicate");

    const window = await inTenant(PROJECT, ({ stats }) => stats.since("2026-03-01"));
    expect(window.bounced).toBe(1);
  });

  it("counts a transient bounce without blocking the address", async () => {
    await endpoint().run(notification(bounce("full@example.test", "Transient", "MailboxFull")));

    const found = await inTenant(PROJECT, async ({ stats, suppressions }) => ({
      window: await stats.since("2026-03-01"),
      blocked: await suppressions.isSuppressed("email", suppressionDigest("full@example.test")),
    }));

    // It still counts towards the rate, because AWS counts it towards ours.
    expect(found.window.bounced).toBe(1);
    expect(found.blocked).toBe(false);
  });

  it("suppresses a complaint, which is somebody pressing the spam button", async () => {
    await endpoint().run(notification(complaint("cross@example.test")));

    const found = await inTenant(PROJECT, async ({ stats, suppressions }) => ({
      window: await stats.since("2026-03-01"),
      blocked: await suppressions.isSuppressed("email", suppressionDigest("cross@example.test")),
    }));

    expect(found.window.complained).toBe(1);
    expect(found.blocked).toBe(true);
  });

  /*
   * A message sent before sends carried a tag. Its bounce cannot be attributed to anybody, and
   * guessing would suppress an address on the wrong project's list.
   */
  it("records an untagged event without charging it to a project", async () => {
    const untagged = notification({ eventType: "Bounce", mail: { messageId: "ses-x" } });
    expect(await endpoint().run(untagged)).toBe("untagged");

    const window = await inTenant(PROJECT, ({ stats }) => stats.since("2026-03-01"));
    expect(window.bounced).toBe(0);
  });

  it("refuses a notification from a topic it does not subscribe to", async () => {
    const foreign = JSON.parse(notification(bounce("dead@example.test"))) as Record<string, string>;
    foreign["TopicArn"] = "arn:aws:sns:eu-west-1:999999999999:not-ours";

    await expect(endpoint().run(JSON.stringify(foreign))).rejects.toMatchObject({
      code: "validation_failed",
    });
    const window = await inTenant(PROJECT, ({ stats }) => stats.since("2026-03-01"));
    expect(window.bounced).toBe(0);
  });
});

describe("stopping a project whose mail is damaging the account", () => {
  const breaker = () =>
    new EmailReputationBreaker(
      uow,
      new ProjectEmailActivityReader(harness.db),
      clock,
      new SilentLogger(),
      { minimumSends: 10 },
    );

  /** Puts a day's figures in directly, which is faster than posting a thousand notifications. */
  async function seed(
    projectId: string,
    sent: number,
    bounced: number,
    day = "2026-03-04",
  ): Promise<void> {
    await inTenant(projectId, async ({ stats }) => {
      await stats.increment(day, "sent", sent);
      if (bounced > 0) await stats.increment(day, "bouncedHard", bounced);
    });
  }

  it("opens a hold on a project past the line, and leaves a clean one alone", async () => {
    await seed(PROJECT, 100, 10);
    await seed(OTHER_PROJECT, 100, 1);

    expect(await breaker().runOnce()).toBe(1);

    const held = await inTenant(PROJECT, ({ holds }) => holds.current());
    const clean = await inTenant(OTHER_PROJECT, ({ holds }) => holds.current());

    expect(held?.reason).toBe("bounce_rate");
    expect(held?.bounceRatePpm).toBe(100_000);
    expect(held?.observedSends).toBe(100);
    expect(clean).toBeNull();
  });

  it("opens one hold however many passes run", async () => {
    await seed(PROJECT, 100, 10);
    await breaker().runOnce();
    expect(await breaker().runOnce()).toBe(0);

    const { rows } = await harness.owner.query<{ count: string }>(
      `SELECT count(*) FROM email_sending_holds WHERE project_id = $1`,
      [PROJECT],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  /*
   * The way back, and the case that showed the breaker could not find one.
   *
   * A held project sends nothing, so it produces no delivery events, so within a window it
   * has no recent rows at all — and a breaker that only looked at projects with recent events
   * would stop seeing the very projects it had stopped. It looks at open holds too, which is
   * the half that makes this releasable rather than permanent.
   */
  it("releases a hold once the bad days age out, even though nothing was sent since", async () => {
    await seed(PROJECT, 100, 10);
    await breaker().runOnce();
    expect(await inTenant(PROJECT, ({ holds }) => holds.current())).not.toBeNull();

    // Past the window, and deliberately with no new traffic: the bad days age out rather than
    // being improved on, which is the only path a stopped project actually has.
    clock.moveTo(new Date("2026-03-20T11:10:00Z"));

    expect(await breaker().runOnce()).toBe(1);
    expect(await inTenant(PROJECT, ({ holds }) => holds.current())).toBeNull();

    const { rows } = await harness.owner.query<{ released_by: string | null }>(
      `SELECT released_by FROM email_sending_holds WHERE project_id = $1`,
      [PROJECT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.released_by, "the breaker released it, not a person").toBeNull();
  });

  /*
   * The negative that proves the isolation, which repo.md says must never become optional.
   * The send path reads a hold under the sending project's own tenant key, so a policy that
   * let one project see another's would be one project stopping another's mail.
   */
  it("hides one project's hold from every other project", async () => {
    await seed(PROJECT, 100, 10);
    await breaker().runOnce();

    expect(await inTenant(PROJECT, ({ holds }) => holds.current())).not.toBeNull();
    expect(await inTenant(OTHER_PROJECT, ({ holds }) => holds.current())).toBeNull();

    const window = await inTenant(OTHER_PROJECT, ({ stats }) => stats.since("2026-03-01"));
    expect(window.sent, "nor its counters").toBe(0);
  });

  it("counts only what its own tag claimed", async () => {
    await endpoint().run(notification(send(PROJECT)));
    await endpoint().run(notification(send(OTHER_PROJECT)));

    expect(await inTenant(PROJECT, ({ stats }) => stats.since("2026-03-01"))).toMatchObject({
      sent: 1,
    });
    expect(await inTenant(OTHER_PROJECT, ({ stats }) => stats.since("2026-03-01"))).toMatchObject({
      sent: 1,
    });
  });
});
