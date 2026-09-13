import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessTokenSource, MetadataTokenSource } from "../src/google/access-token-source.js";
import { CloudTasksScheduler, shardOf } from "../src/webhooks/cloud-tasks-scheduler.js";

/**
 * The queue adapter, against a stand-in for Google (ADR-0012).
 *
 * A local server in place of `cloudtasks.googleapis.com` is the only honest way to test this without
 * a Cloud project: what can be asserted is the request we make — the queue it goes to, the time we
 * ask for, the identity the task is minted with, and the body it carries — and that is the whole of
 * our side of the contract. What cannot be asserted here is that Google then calls us back, which is
 * stated in the terraform README rather than pretended at.
 */

const DELIVERY = "22222222-2222-2222-2222-222222222222";
const PROJECT = "11111111-1111-1111-1111-111111111111";
const ENDPOINT = "33333333-3333-3333-3333-333333333333";

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
  constructor(private ms: number) {
    super();
  }
  override now(): Date {
    return new Date(this.ms);
  }
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

class FakeTokens extends AccessTokenSource {
  calls = 0;
  override token(): Promise<string> {
    this.calls += 1;
    return Promise.resolve("ya29.fake");
  }
}

interface Captured {
  readonly path: string;
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

/** Cloud Tasks, as far as this test is concerned: it records and answers. */
class FakeTasksApi {
  readonly captured: Captured[] = [];
  private server: Server | null = null;
  private status = 200;

  async start(): Promise<string> {
    this.server = createServer((request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        this.captured.push({
          path: request.url ?? "",
          authorization: String(request.headers.authorization ?? ""),
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        });
        response.writeHead(this.status, { "content-type": "application/json" });
        response.end(this.status === 200 ? '{"name":"task"}' : '{"error":{"status":"NOT_FOUND"}}');
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, resolve);
    });
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  answers(status: number): void {
    this.status = status;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

const api = new FakeTasksApi();
let baseUrl = "";

const settings = {
  project: "idenzy-dev",
  location: "europe-west4",
  queuePrefix: "idenzy-eu-1-webhooks",
  shards: 8,
  serviceAccount: "webhooks@idenzy-dev.iam.gserviceaccount.com",
  url: "https://workers-abc.a.run.app/internal/webhooks/dispatch",
  audience: "https://workers-abc.a.run.app",
};

function scheduler(tokens: AccessTokenSource = new FakeTokens()): CloudTasksScheduler {
  return new CloudTasksScheduler(tokens, settings, new SilentLogger(), { baseUrl });
}

function delivery(webhookId = ENDPOINT) {
  return { id: DELIVERY, projectId: PROJECT, webhookId };
}

/** The one task in a captured request. Asserted rather than asserted-away: nothing else sends here. */
function taskIn(request: Captured | undefined): Record<string, unknown> {
  expect(request).toBeDefined();
  const body = request?.body as { task?: Record<string, unknown> };
  const task = body.task;
  expect(task).toBeDefined();
  return task ?? {};
}

beforeAll(async () => {
  baseUrl = await api.start();
});

afterAll(async () => {
  await api.stop();
});

describe("arming a retry as a Cloud Task", () => {
  it("creates one task on the endpoint's own queue, at the time we asked for", async () => {
    api.answers(200);
    api.captured.length = 0;
    const at = new Date("2026-09-13T10:00:00.000Z");

    await scheduler().schedule(delivery(), at);

    const [request] = api.captured;
    expect(request?.authorization).toBe("Bearer ya29.fake");
    expect(request?.path).toBe(
      `/v2/projects/idenzy-dev/locations/europe-west4/queues/idenzy-eu-1-webhooks-${shardOf(ENDPOINT, 8)}/tasks`,
    );

    const task = taskIn(request);
    expect(task["scheduleTime"]).toBe("2026-09-13T10:00:00.000Z");
    const http = task["httpRequest"] as Record<string, unknown>;
    expect(http["url"]).toBe(settings.url);
    expect(http["httpMethod"]).toBe("POST");
    // The identity is minted for us by the queue rather than carried as a secret, which is the whole
    // reason this endpoint needs no shared token.
    expect(http["oidcToken"]).toEqual({
      serviceAccountEmail: settings.serviceAccount,
      audience: settings.audience,
    });
  });

  it("carries the two ids and nothing else, in the form the product prints them", async () => {
    api.answers(200);
    api.captured.length = 0;

    await scheduler().schedule(delivery(), new Date());

    const task = taskIn(api.captured[0]);
    const http = task["httpRequest"] as Record<string, string>;
    const body = JSON.parse(Buffer.from(http["body"] ?? "", "base64").toString("utf8"));
    // No payload, no attempt number, no signature: the row is the truth about all three by the time
    // the task fires, and a task carrying its own copy could deliver a body the delivery has finished
    // with.
    expect(body).toEqual({
      delivery: PublicId.encode(IdPrefix.Delivery, DELIVERY).value,
      project: PublicId.encode(IdPrefix.Project, PROJECT).value,
    });
  });

  it("throws when the queue refuses, because the sweeper is what covers it", async () => {
    api.answers(404);
    api.captured.length = 0;

    // A 404 is the shard count exceeding the number of queues Terraform made. The dispatcher swallows
    // this and logs it: the row already says when it is due, so the cost is the sweeper's interval.
    await expect(scheduler().schedule(delivery(), new Date())).rejects.toThrow();
  });
});

describe("which queue a delivery goes to", () => {
  it("always sends one endpoint's retries to the same queue", () => {
    const first = shardOf(ENDPOINT, 8);
    for (let index = 0; index < 5; index += 1) expect(shardOf(ENDPOINT, 8)).toBe(first);
  });

  it("spreads endpoints across the pool", () => {
    const ids = Array.from({ length: 400 }, (_, index) => `endpoint-${index}`);
    const used = new Set(ids.map((id) => shardOf(id, 8)));
    expect(used.size).toBe(8);
    for (const shard of used) {
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(8);
    }
  });
});

describe("reading the queue out of the environment", () => {
  const environment = {
    IDENZY_ENV: "development",
    DATABASE_URL: "postgres://localhost/idenzy",
    VALKEY_URL: "redis://localhost:6379",
    CELL_CODE: "eu-1",
    KMS_KEY_RING: "ring",
    ISSUER_BASE_URL: "https://auth.idenzy.dev",
  };

  it("answers null when there is no queue, which is what a developer machine has", () => {
    expect(CloudTasksScheduler.settingsFrom(AppConfig.fromEnvironment(environment))).toBeNull();
  });

  it("refuses to start on a half-configured queue", () => {
    // Four of the five would fall back to the sweeper silently, and the only symptom would be retry
    // latency nobody is watching. This is the one case worth failing a boot over.
    expect(() =>
      CloudTasksScheduler.settingsFrom(
        AppConfig.fromEnvironment({
          ...environment,
          GCP_PROJECT_ID: "idenzy-dev",
          WEBHOOK_TASKS_LOCATION: "europe-west4",
          WEBHOOK_TASKS_QUEUE_PREFIX: "idenzy-eu-1-webhooks",
          WEBHOOK_TASKS_SERVICE_ACCOUNT: "webhooks@idenzy-dev.iam.gserviceaccount.com",
        }),
      ),
    ).toThrow(/half configured/);
  });

  it("defaults the audience to the url the task calls, as Cloud Tasks itself does", () => {
    const read = CloudTasksScheduler.settingsFrom(
      AppConfig.fromEnvironment({
        ...environment,
        GCP_PROJECT_ID: "idenzy-dev",
        WEBHOOK_TASKS_LOCATION: "europe-west4",
        WEBHOOK_TASKS_QUEUE_PREFIX: "idenzy-eu-1-webhooks",
        WEBHOOK_TASKS_SERVICE_ACCOUNT: "webhooks@idenzy-dev.iam.gserviceaccount.com",
        WEBHOOK_DISPATCH_URL: settings.url,
      }),
    );
    expect(read?.audience).toBe(settings.url);
    expect(read?.shards).toBe(8);
  });
});

describe("the token the metadata server hands out", () => {
  it("is asked for once and reused until it is nearly expired", async () => {
    let served = 0;
    const metadata = createServer((request, response) => {
      served += 1;
      expect(request.headers["metadata-flavor"]).toBe("Google");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: `token-${served}`, expires_in: 3600 }));
    });
    await new Promise<void>((resolve) => {
      metadata.listen(0, resolve);
    });
    const { port } = metadata.address() as AddressInfo;

    const clock = new FixedClock(Date.parse("2026-09-13T10:00:00.000Z"));
    const tokens = new MetadataTokenSource(clock, {
      url: `http://127.0.0.1:${port}/token`,
    });

    expect(await tokens.token()).toBe("token-1");
    expect(await tokens.token()).toBe("token-1");
    expect(served).toBe(1);

    // Past the hour minus the minute that is deliberately not spent.
    clock.advance(3600);
    expect(await tokens.token()).toBe("token-2");
    expect(served).toBe(2);

    await new Promise<void>((resolve) => {
      metadata.close(() => resolve());
    });
  });
});
