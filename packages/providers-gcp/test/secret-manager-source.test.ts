import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessTokenSource } from "../src/access-token-source.js";
import { SecretManagerSource } from "../src/secret-manager-source.js";

/**
 * Reading a secret over the Secret Manager REST API.
 *
 * Against a real HTTP server rather than a mocked `fetch`, because what is worth asserting is the
 * request this builds — the path, the version and the bearer header — and a mock that records
 * arguments would assert only that the code calls the mock.
 */
class FixedTokens extends AccessTokenSource {
  override token(): Promise<string> {
    return Promise.resolve("ya29.test");
  }
}

let server: Server;
let base: string;
let requests: { url: string; authorization: string | undefined }[] = [];
let respond: (url: string) => { status: number; body: unknown } = () => ({
  status: 200,
  body: { payload: { data: Buffer.from("hunter2").toString("base64") } },
});

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url ?? "", authorization: request.headers.authorization });
    const { status, body } = respond(request.url ?? "");
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function source(): SecretManagerSource {
  requests = [];
  return new SecretManagerSource("idenzy-dev", new FixedTokens(), { endpoint: base });
}

describe("fetching a secret", () => {
  it("decodes the base64 payload the API returns", async () => {
    expect(await source().fetch("database-url")).toBe("hunter2");
  });

  it("asks for the right secret, at the latest version, as this service account", async () => {
    const store = source();
    await store.fetch("database-url");
    expect(requests[0]?.url).toBe(
      "/v1/projects/idenzy-dev/secrets/database-url/versions/latest:access",
    );
    expect(requests[0]?.authorization).toBe("Bearer ya29.test");
  });

  /**
   * `latest` and not a pinned version, deliberately. A secret is rotated by adding a version, and a
   * pinned deployment would go on using the rotated-away value until somebody edited configuration
   * — which is the failure that makes people stop rotating.
   */
  it("reads latest unless a deployment pins one", async () => {
    requests = [];
    const pinned = new SecretManagerSource("idenzy-dev", new FixedTokens(), {
      endpoint: base,
      version: "7",
    });
    await pinned.fetch("database-url");
    expect(requests[0]?.url).toContain("/versions/7:access");
  });

  it("fetches once and serves the rest from memory", async () => {
    const store = source();
    await store.fetch("database-url");
    await store.fetch("database-url");
    expect(requests).toHaveLength(1);
  });

  /**
   * Boot fails rather than the process starting with a missing credential and finding out on the
   * first request that needed it.
   */
  it("refuses when the secret is not there", async () => {
    respond = () => ({ status: 404, body: { error: { message: "not found" } } });
    const caught = await source()
      .fetch("absent")
      .then(
        () => null,
        (error: unknown) => error as { detail?: Record<string, unknown> },
      );
    expect(caught?.detail?.["secret"]).toBe("absent");
    expect(caught?.detail?.["status"]).toBe(404);
    respond = () => ({
      status: 200,
      body: { payload: { data: Buffer.from("hunter2").toString("base64") } },
    });
  });

  /**
   * An error from a secret API is the last place to be relaxed about what gets echoed onward: the
   * body of a failed read can carry more than the status did.
   */
  it("puts nothing from the response body in the error", async () => {
    respond = () => ({ status: 403, body: { error: { message: "denied for sk_live_leaked" } } });
    const caught = await source()
      .fetch("stripe-key")
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(JSON.stringify(caught ?? {})).not.toContain("sk_live_leaked");
    respond = () => ({
      status: 200,
      body: { payload: { data: Buffer.from("hunter2").toString("base64") } },
    });
  });
});
