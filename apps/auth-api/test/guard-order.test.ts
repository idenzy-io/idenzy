import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { ApplicationConfig } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, describe, expect, it } from "vitest";
import { AppModule } from "../dist/app.module.js";
import { VALKEY } from "../dist/cache/cache.module.js";
import { TestValkey, testConfig } from "./fixtures.js";

/**
 * The order the global guards run in (PROJECT.md 9.3).
 *
 * `SessionModule` has said since phase 2 that "the wiring test pins that order", and it
 * did not — nothing asserted it anywhere, so the order was an implicit consequence of the
 * import list in `AppModule` and a reordering would have been silent in every way that
 * matters. Three of these positions are load-bearing:
 *
 * - `SecretKeyGuard` reads the credential kind `TenantResolutionGuard` recorded, so it
 *   cannot run first.
 * - `RateLimitGuard` keys each bucket on the resolved project. Ahead of tenant resolution
 *   every project would silently share one bucket, and the symptom is one busy customer
 *   throttling everybody else — visible as our product being flaky, not as a bug here.
 * - `SessionTransportGuard` decides how a session is carried, so `SessionGuard` has to
 *   come after it.
 *
 * Asserted as an exact list rather than as pairwise "before" checks, because an
 * inserted guard belongs in a reviewed diff either way.
 */
let app: NestFastifyApplication;

afterAll(async () => {
  await app?.close();
});

describe("global guard order", () => {
  it("runs tenant resolution first, then the limiter, then the session guards", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(testConfig())
      .overrideProvider(VALKEY)
      .useValue(new TestValkey())
      .compile();

    // Initialised rather than only compiled: APP_GUARD providers are bound during init,
    // so a compiled module reports no global guards at all — which is worth knowing,
    // because an assertion written as "does not contain" would have passed against an
    // empty list and proved nothing. Nothing listens and no query runs, so the pool stays
    // idle.
    //
    // `getGlobalGuards`, not `getGlobalRequestGuards`: singleton enhancers go to the
    // first and only request-scoped ones to the second, and every guard here is a
    // singleton. Reading the wrong list is the same empty array.
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();

    const guards = app
      .get(ApplicationConfig)
      .getGlobalGuards()
      .map((guard) => (guard as object).constructor.name);

    expect(guards).toEqual([
      "TenantResolutionGuard",
      "SecretKeyGuard",
      "RateLimitGuard",
      "SessionTransportGuard",
      "SessionGuard",
    ]);
  });
});
