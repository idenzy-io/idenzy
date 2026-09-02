import "reflect-metadata";
import { Logger } from "@idenzy/core/logging/logger";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { HealthController } from "../dist/health/health.controller.js";
import { FailingController } from "../dist/testing/failing.controller.js";
import { WellKnownController } from "../dist/well-known/well-known.controller.js";

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController, WellKnownController, FailingController],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new IdenzyExceptionFilter(new SilentLogger()));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

describe("the auth API never returns HTML", () => {
  // PROJECT.md 4.3: we render nothing, which is what removes XSS and clickjacking from
  // our surface. A text/html response from an auth endpoint is a bug, so it is a test.
  it.each([
    "/healthz",
    "/readyz",
    "/.well-known/openid-configuration",
    "/.well-known/jwks.json",
    "/test/boom",
    "/test/unhandled",
    "/does-not-exist",
  ])("%s responds with JSON, not HTML", async (path) => {
    const response = await fetch(base + path);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
    expect(contentType).not.toContain("text/html");
    expect(await response.text()).not.toMatch(/<html|<!DOCTYPE/i);
  });
});

describe("error contract", () => {
  it("returns the stable code and status", async () => {
    const response = await fetch(`${base}/test/boom`);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("invalid_credentials");
    expect(body.error.requestId).toBeTruthy();
  });

  it("never leaks internal detail into the response", async () => {
    const raw = await (await fetch(`${base}/test/boom`)).text();
    expect(raw).not.toContain("usr_secret");
    expect(raw).not.toContain("internal");
  });

  it("turns an unrecognized error into a generic 500 with no message leakage", async () => {
    const response = await fetch(`${base}/test/unhandled`);
    const raw = await response.text();
    expect(response.status).toBe(500);
    expect(raw).toContain("internal_error");
    expect(raw).not.toContain("revealing message");
    expect(raw).not.toContain("UnrecognizedFailure");
  });
});
