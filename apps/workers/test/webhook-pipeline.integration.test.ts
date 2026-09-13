import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Sha256WebhookSigner } from "@idenzy/crypto/webhooks/webhook-signer";
import { verifyWebhook } from "@idenzy/node/webhooks";
import { AuditEventReader } from "@idenzy/persistence/repository/audit-event-reader";
import { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import { WebhookDeliveryRepository } from "@idenzy/persistence/repository/webhook-delivery-repository";
import { WebhookDueReader } from "@idenzy/persistence/repository/webhook-due-reader";
import { WebhookRepository } from "@idenzy/persistence/repository/webhook-repository";
import { WebhookStatsRepository } from "@idenzy/persistence/repository/webhook-stats-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { WEBHOOK_FAILURES_BEFORE_DISABLED } from "@idenzy/protocol/schemas/webhooks";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SweepingScheduler } from "../src/webhooks/delivery-scheduler.js";
import { WebhookDispatcher } from "../src/webhooks/webhook-dispatcher.js";
import { WebhookRelay } from "../src/webhooks/webhook-relay.js";
import { WebhookSweeper } from "../src/webhooks/webhook-sweeper.js";
import { HttpsWebhookTransport } from "../src/webhooks/webhook-transport.js";

/**
 * The pipeline end to end, against a real Postgres and a real HTTP receiver (ADR-0012).
 *
 * The assertion that matters most is the one nothing else can make: the receiver verifies each
 * delivery with `verifyWebhook` from the server SDK we publish. Our signer and our customers'
 * verifier meeting over a socket is the only test that proves the two halves of the contract agree,
 * and it is exactly what the note on the webhooks screen found missing the first time — a documented
 * example that could not verify its own documented request.
 */

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const CELL = "eu-test";
const clock = new SystemClock();

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

/** What the receiver saw, verified rather than merely received. */
interface Received {
  readonly verified: boolean;
  readonly deliveryId: string;
  readonly event: string;
  readonly attempt: string;
  readonly body: string;
  readonly reason: string | null;
}

class Receiver {
  readonly received: Received[] = [];
  private server: Server | null = null;
  private answer: { status: number; body: string } = { status: 200, body: '{"ok":true}' };
  private hold = 0;

  async start(secrets: string[]): Promise<string> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let verified = false;
        let reason: string | null = null;
        let deliveryId = "";
        let event = "";
        try {
          const result = verifyWebhook({ rawBody: body, headers: request.headers, secrets });
          verified = true;
          deliveryId = result.deliveryId;
          event = result.envelope.type;
        } catch (error: unknown) {
          reason = error instanceof Error ? error.message : "unknown";
        }
        this.received.push({
          verified,
          deliveryId,
          event,
          attempt: String(request.headers["x-idenzy-attempt"] ?? ""),
          body,
          reason,
        });
        const send = () => {
          response.writeHead(this.answer.status, { "content-type": "application/json" });
          response.end(this.answer.body);
        };
        if (this.hold > 0) setTimeout(send, this.hold);
        else send();
      });
    });
    const server = this.server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/hooks`;
  }

  answers(status: number, body = "{}"): void {
    this.answer = { status, body };
  }

  waits(ms: number): void {
    this.hold = ms;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === null) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }
}

let uow: UnitOfWork;
let dispatcher: WebhookDispatcher;
let relay: WebhookRelay;
let sweeper: WebhookSweeper;
let encryptor: FieldEncryptor;
const receiver = new Receiver();
let endpointUrl = "";

const SECRET = "whsec_integration_secret";

function inTenant<T>(work: (repos: Repos, tenant: TenantContext) => Promise<T>): Promise<T> {
  const tenant = new TenantContext(PROJECT, "req_test", "system");
  return uow.run(tenant, (tx) =>
    work(
      {
        endpoints: new WebhookRepository(tx, tenant),
        deliveries: new WebhookDeliveryRepository(tx, tenant),
        stats: new WebhookStatsRepository(tx, tenant),
      },
      tenant,
    ),
  );
}

interface Repos {
  readonly endpoints: WebhookRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly stats: WebhookStatsRepository;
}

async function enqueue(topic: string, payload: Record<string, unknown> = {}): Promise<void> {
  await harness.owner.query(
    `INSERT INTO outbox (project_id, topic, payload) VALUES ($1, $2, $3::jsonb)`,
    [PROJECT, topic, JSON.stringify(payload)],
  );
}

async function endpointFor(events: string[], url = endpointUrl) {
  return await inTenant((repos, tenant) =>
    repos.endpoints.create({
      url,
      description: "integration",
      secretCiphertext: encryptor.encrypt(SECRET, tenant.projectId),
      events,
      allEvents: false,
      enabled: true,
    }),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  encryptor = new FieldEncryptor(developmentDataKey(CELL));
  endpointUrl = await receiver.start([SECRET]);

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

  const logger = new SilentLogger();
  dispatcher = new WebhookDispatcher(
    uow,
    new Sha256WebhookSigner(),
    encryptor,
    new HttpsWebhookTransport({ allowLoopbackHttp: true }),
    new SweepingScheduler(),
    clock,
    logger,
  );
  relay = new WebhookRelay(
    new AuditEventReader(harness.db),
    new RelayOffsetRepository(harness.db),
    uow,
    dispatcher,
    clock,
    logger,
  );
  sweeper = new WebhookSweeper(new WebhookDueReader(harness.db), uow, dispatcher, clock, logger);
}, 180_000);

afterAll(async () => {
  await receiver.stop();
  await harness.stop();
});

afterEach(async () => {
  receiver.received.length = 0;
  receiver.answers(200, '{"ok":true}');
  receiver.waits(0);
  // Each case starts from an empty queue and its own watermark, so one case's events cannot be
  // another's. Deleting the offsets is what makes the relay re-read from its cold start.
  await harness.owner.query("DELETE FROM webhook_deliveries");
  await harness.owner.query("DELETE FROM webhooks");
  await harness.owner.query("DELETE FROM outbox");
  await harness.owner.query("DELETE FROM relay_offsets");
  await harness.owner.query("DELETE FROM webhook_endpoint_stats");
});

describe("the webhook pipeline", () => {
  it("delivers an event, and the receiver verifies it with the published SDK", async () => {
    const endpoint = await endpointFor(["session.created"]);
    await enqueue("session.created", { sessionId: "ses_1", userId: "usr_1" });

    const created = await relay.sweep();
    expect(created).toBe(1);
    expect(receiver.received).toHaveLength(1);

    const [call] = receiver.received;
    expect(call?.verified, call?.reason ?? "verified").toBe(true);
    expect(call?.event).toBe("session.created");
    expect(call?.attempt).toBe("1");
    // The envelope carries the event's own data, and the delivery id a receiver dedupes on.
    expect(JSON.parse(call?.body ?? "{}").data).toEqual({ sessionId: "ses_1", userId: "usr_1" });
    expect(call?.deliveryId.startsWith("dlv_")).toBe(true);

    const [delivery] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(delivery?.status).toBe("delivered");
    expect(delivery?.attempts).toHaveLength(1);
    expect(delivery?.attempts[0]?.status).toBe(200);
    // Taken, so the body is gone: there is nothing left to send it to (ADR-0012).
    expect(delivery?.payload).toBeNull();
  });

  it("maps an internal topic onto the public event name", async () => {
    await endpointFor(["mfa.enrolled"]);
    await enqueue("security.mfa_enrolled", { factor: "totp" });

    await relay.sweep();
    expect(receiver.received[0]?.event).toBe("mfa.enrolled");
    expect(receiver.received[0]?.verified).toBe(true);
  });

  it("sends nothing for a topic nobody subscribed to", async () => {
    await endpointFor(["user.updated"]);
    await enqueue("session.created", { sessionId: "ses_1" });

    expect(await relay.sweep()).toBe(0);
    expect(receiver.received).toHaveLength(0);
  });

  it("sends nothing to a paused endpoint", async () => {
    const endpoint = await endpointFor(["session.created"]);
    await inTenant((repos) => repos.endpoints.disable(endpoint.id, "paused", new Date()));
    await enqueue("session.created", {});

    expect(await relay.sweep()).toBe(0);
    expect(receiver.received).toHaveLength(0);
  });

  it("fans one event out to every subscribed endpoint", async () => {
    const first = await endpointFor(["session.created"]);
    const second = await endpointFor(["session.created"]);
    await enqueue("session.created", {});

    expect(await relay.sweep()).toBe(2);
    expect(receiver.received).toHaveLength(2);
    expect(receiver.received.every((call) => call.verified)).toBe(true);
    // Two deliveries, two ids: a receiver that took one has not taken the other.
    expect(new Set(receiver.received.map((call) => call.deliveryId)).size).toBe(2);
    expect([first.id, second.id]).toHaveLength(2);
  });

  /* The replay case: the relay is at-least-once, and the unique index is what makes that safe. */
  it("does not send twice when the same event is relayed again", async () => {
    await endpointFor(["session.created"]);
    await enqueue("session.created", {});

    await relay.sweep();
    await harness.owner.query("DELETE FROM relay_offsets");
    await relay.sweep();

    expect(receiver.received).toHaveLength(1);
  });

  it("retries a refusal on the published schedule and keeps the body until it is finished", async () => {
    const endpoint = await endpointFor(["session.created"]);
    receiver.answers(500, "no thanks");
    await enqueue("session.created", { a: 1 });

    await relay.sweep();
    expect(receiver.received).toHaveLength(1);

    const [failing] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(failing?.status).toBe("queued");
    expect(failing?.attempts[0]?.status).toBe(500);
    // The receiver's own words, kept as evidence.
    expect(failing?.attempts[0]?.response).toBe("no thanks");
    // Ten seconds out, which is the first entry in the schedule.
    const due = (failing?.nextAttemptAt?.getTime() ?? 0) - Date.now();
    expect(due).toBeGreaterThan(5_000);
    expect(due).toBeLessThan(15_000);
    // Still owed, so the body it will be signed from is still there.
    expect(failing?.payload).not.toBeNull();
  });

  it("takes over a due delivery from the sweeper and delivers it", async () => {
    const endpoint = await endpointFor(["session.created"]);
    receiver.answers(503);
    await enqueue("session.created", {});
    await relay.sweep();
    expect(receiver.received).toHaveLength(1);

    // The receiver recovers, and the retry falls due.
    receiver.answers(200);
    await inTenant(async (repos) => {
      const [delivery] = await repos.deliveries.listForEndpoint(endpoint.id);
      await harness.owner.query(
        "UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
        [delivery?.id],
      );
    });

    expect(await sweeper.sweep()).toBe(1);
    expect(receiver.received).toHaveLength(2);
    expect(receiver.received[1]?.attempt).toBe("2");
    // The same delivery, not a new one: the id a receiver dedupes on has not moved.
    expect(receiver.received[1]?.deliveryId).toBe(receiver.received[0]?.deliveryId);
    expect(receiver.received[1]?.verified).toBe(true);

    const [delivered] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(delivered?.status).toBe("delivered");
    expect(delivered?.attempts.map((attempt) => attempt.status)).toEqual([503, 200]);
  });

  it("counts what happened, so the figures do not need the window", async () => {
    const endpoint = await endpointFor(["session.created"]);
    await enqueue("session.created", {});
    await relay.sweep();

    const day = new Date().toISOString().slice(0, 10);
    const [stats] = await inTenant((repos) => repos.stats.forEndpoint(endpoint.id, day));
    expect(stats?.delivered).toBe(1);
    expect(stats?.attempts).toBe(1);
    expect(stats?.failed).toBe(0);
  });

  /* A 302 is a receiver that has not taken the delivery. Treating it as success is how six months
     of events go to a URL that moved. */
  it("treats anything but a 2xx as a failure, redirects included", async () => {
    const endpoint = await endpointFor(["session.created"]);
    receiver.answers(302);
    await enqueue("session.created", {});
    await relay.sweep();

    const [delivery] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(delivery?.status).toBe("queued");
    expect(delivery?.attempts[0]?.status).toBe(302);
  });

  it("records a timeout as an attempt with no status", async () => {
    const endpoint = await endpointFor(["session.created"]);
    // Longer than the inline lane's five seconds.
    receiver.waits(6_000);
    await enqueue("session.created", {});
    await relay.sweep();

    const [delivery] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(delivery?.attempts[0]?.status).toBeNull();
    expect(delivery?.attempts[0]?.error).toContain("No answer within");
    expect(delivery?.status).toBe("queued");
  }, 20_000);

  it("refuses an endpoint whose host resolves nowhere, without spending an attempt on TLS", async () => {
    const endpoint = await endpointFor(
      ["session.created"],
      "https://webhook-nowhere.invalid/hooks",
    );
    await enqueue("session.created", {});
    await relay.sweep();

    const [delivery] = await inTenant((repos) => repos.deliveries.listForEndpoint(endpoint.id));
    expect(delivery?.attempts[0]?.status).toBeNull();
    expect(delivery?.attempts[0]?.error).toBeTruthy();
    expect(delivery?.status).toBe("queued");
  });

  /**
   * The breaker: twenty failed attempts in a row and the endpoint is off with a reason.
   *
   * Every failure here goes through the dispatcher, which is the point — the first version of this
   * test drove the counter by hand and hid the fact that only *dead deliveries* were counted. A
   * delivery dies after eight attempts over a day, so twenty of those is a month of calling an
   * endpoint that has never answered. Counting attempts is what makes the number mean something,
   * and twenty events through a refusing endpoint is what proves it.
   */
  it("switches an endpoint off after twenty consecutive failed attempts", async () => {
    const endpoint = await endpointFor(["session.created"]);
    receiver.answers(500);

    for (let n = 0; n < WEBHOOK_FAILURES_BEFORE_DISABLED; n += 1) {
      await enqueue("session.created", { n });
      await relay.sweep();
    }

    expect(receiver.received).toHaveLength(WEBHOOK_FAILURES_BEFORE_DISABLED);
    const off = await inTenant((repos) => repos.endpoints.findById(endpoint.id));
    expect(off?.enabled).toBe(false);
    expect(off?.disabledReason).toBe("failing");
    // Nobody: the breaker is not a person, and a screen saying "paused by Idenzy" would read as us
    // having decided something about the customer's endpoint.
    expect(off?.disabledBy).toBeNull();

    // And it stops: the next event reaches a disabled endpoint and writes no delivery at all.
    const before = receiver.received.length;
    await enqueue("session.created", { after: true });
    expect(await relay.sweep()).toBe(0);
    expect(receiver.received).toHaveLength(before);
  }, 30_000);

  it("clears the run of failures as soon as one lands", async () => {
    const endpoint = await endpointFor(["session.created"]);
    receiver.answers(500);
    await enqueue("session.created", { a: 1 });
    await relay.sweep();
    expect((await inTenant((r) => r.endpoints.findById(endpoint.id)))?.consecutiveFailures).toBe(1);

    receiver.answers(200);
    await enqueue("session.created", { a: 2 });
    await relay.sweep();
    expect((await inTenant((r) => r.endpoints.findById(endpoint.id)))?.consecutiveFailures).toBe(0);
  });

  it("stops signing with a secret whose rotation window has closed", async () => {
    const endpoint = await endpointFor(["session.created"]);
    // Rotated to a secret the receiver does not hold, with the window already shut: only the new
    // one signs, so the receiver refuses — which is the failure a customer would see if they had
    // not deployed in time, and proves the deadline is enforced rather than decorative.
    await inTenant((repos, tenant) =>
      repos.endpoints.rotateSecret(
        endpoint.id,
        encryptor.encrypt("whsec_rotated_secret", tenant.projectId),
        new Date(Date.now() - 1_000),
        new Date(),
      ),
    );
    await enqueue("session.created", {});
    await relay.sweep();

    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]?.verified).toBe(false);
  });

  it("signs with both secrets inside the rotation window", async () => {
    const endpoint = await endpointFor(["session.created"]);
    await inTenant((repos, tenant) =>
      repos.endpoints.rotateSecret(
        endpoint.id,
        encryptor.encrypt("whsec_rotated_secret", tenant.projectId),
        new Date(Date.now() + 3_600_000),
        new Date(),
      ),
    );
    await enqueue("session.created", {});
    await relay.sweep();

    // The receiver still holds only the old secret, and verifies: both are in the header.
    expect(receiver.received[0]?.verified, receiver.received[0]?.reason ?? "").toBe(true);
  });
});
