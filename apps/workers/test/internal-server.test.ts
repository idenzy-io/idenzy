import { AccessTokenInvalidError, ValidationFailedError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { afterEach, describe, expect, it } from "vitest";
import { TaskCallerVerifier } from "../src/google/task-caller-verifier.js";
import { InternalServer, type TaskRunner } from "../src/http/internal-server.js";
import type { TaskOutcome } from "../src/webhooks/webhook-task-endpoint.js";

/**
 * The worker's two routes: health, and the retry lane's entry.
 *
 * What is being asserted is the shape of the door rather than what is behind it — which caller gets
 * in, which status code the queue is told, and that the route does not exist at all in a deployment
 * without a queue. The delivery half is in `webhook-pipeline.integration.test.ts`, where there is a
 * database to claim in.
 */

const PATH = "/internal/webhooks/dispatch";

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

/** Accepts one token, refuses the rest, the way the real one refuses anything but Google's. */
class FakeVerifier extends TaskCallerVerifier {
  override verify(token: string): Promise<string> {
    if (token !== "good") {
      return Promise.reject(new AccessTokenInvalidError({ detail: { reason: "not google's" } }));
    }
    return Promise.resolve("webhooks@idenzy-dev.iam.gserviceaccount.com");
  }
}

class FakeRunner implements TaskRunner {
  readonly bodies: unknown[] = [];
  outcome: TaskOutcome = "attempted";
  failure: Error | null = null;

  run(body: unknown): Promise<TaskOutcome> {
    this.bodies.push(body);
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(this.outcome);
  }
}

let server: InternalServer | null = null;

async function listen(dispatch?: { verifier: TaskCallerVerifier; endpoint: TaskRunner }) {
  const started = new InternalServer(
    {
      port: 0,
      ...(dispatch === undefined ? {} : { dispatch: { path: PATH, ...dispatch } }),
    },
    new SilentLogger(),
  );
  server = started;
  const port = await started.start();
  return `http://127.0.0.1:${port}`;
}

function post(base: string, token: string | null, body: string): Promise<Response> {
  return fetch(`${base}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body,
  });
}

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("the worker's http surface", () => {
  it("answers health without a token, because that is what the platform asks", async () => {
    const base = await listen();
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("has no dispatch route at all without a queue", async () => {
    const base = await listen();
    // Not a 401: an endpoint that dispatches deliveries is not left listening on the chance somebody
    // configures a queue later.
    expect((await post(base, "good", "{}")).status).toBe(404);
  });

  it("answers anything else with a 404", async () => {
    const base = await listen({ verifier: new FakeVerifier(), endpoint: new FakeRunner() });
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}${PATH}`)).status).toBe(404);
  });

  it("refuses a call with no bearer token, without reading the body", async () => {
    const runner = new FakeRunner();
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    expect((await post(base, null, '{"delivery":"dlv_x"}')).status).toBe(401);
    expect(runner.bodies).toHaveLength(0);
  });

  it("refuses a token the verifier does not accept", async () => {
    const runner = new FakeRunner();
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    expect((await post(base, "forged", "{}")).status).toBe(401);
    expect(runner.bodies).toHaveLength(0);
  });

  it("runs the task and says which of the two things happened", async () => {
    const runner = new FakeRunner();
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    const attempted = await post(base, "good", '{"delivery":"dlv_a","project":"prj_b"}');
    expect(attempted.status).toBe(200);
    expect(await attempted.json()).toEqual({ outcome: "attempted" });
    expect(runner.bodies[0]).toEqual({ delivery: "dlv_a", project: "prj_b" });

    // A duplicate task is the ordinary case and not a failure, so the queue hears 200 either way.
    runner.outcome = "skipped";
    const skipped = await post(base, "good", "{}");
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toEqual({ outcome: "skipped" });
  });

  it("refuses a body that is not json", async () => {
    const base = await listen({ verifier: new FakeVerifier(), endpoint: new FakeRunner() });
    expect((await post(base, "good", "not json")).status).toBe(400);
  });

  it("passes a refusal from the task through with its own status", async () => {
    const runner = new FakeRunner();
    runner.failure = new ValidationFailedError({ message: "not a delivery" });
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    // A task naming something that is not a delivery will never succeed, so the queue is told 400 and
    // is done with it rather than being asked to try again.
    expect((await post(base, "good", "{}")).status).toBe(400);
  });

  it("answers 503 when the attempt could not be made at all", async () => {
    const runner = new FakeRunner();
    runner.failure = new Error("the database is gone");
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    // Visible in the queue's metrics and nothing more: the queue does not retry, and the sweeper finds
    // the row whatever this answered.
    expect((await post(base, "good", "{}")).status).toBe(503);
  });

  it("refuses a body far larger than a task's before reading it", async () => {
    const runner = new FakeRunner();
    const base = await listen({ verifier: new FakeVerifier(), endpoint: runner });

    expect((await post(base, "good", "x".repeat(8 * 1024))).status).toBe(413);
    expect(runner.bodies).toHaveLength(0);
  });
});
