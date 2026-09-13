import "reflect-metadata";
import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { RateLimitStrategy } from "@idenzy/cache/rate-limit-strategy";
import { SlidingWindowStrategy } from "@idenzy/cache/sliding-window-strategy";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { ValkeyHarness } from "@idenzy/testing/valkey-harness";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import {
  TEST_IP_LIMIT,
  TEST_SUBJECT_LIMIT,
  ThrottledController,
} from "../dist/testing/throttled.controller.js";
import { ClientIpResolver } from "../dist/throttling/client-ip.js";
import { RateLimitGuard } from "../dist/throttling/rate-limit.guard.js";
import { SilentLogger, testConfig } from "./fixtures.js";

/**
 * The limiter against a real Valkey (PROJECT.md 4.9).
 *
 * A fake agrees with the caller by construction here: a sliding window is four commands in
 * a MULTI, and whether the count it returns is the count depends on the server. What the
 * unit suite cannot say either is that the two dimensions hold separate budgets, which is
 * the whole reason there are two.
 *
 * The controller is local to this file rather than one of ours, because what is under test
 * is the guard and the strategy behind it. Wiring each real route to a spec is asserted by
 * `rate-limit-coverage.test.ts`, which reads the metadata rather than spending the budget.
 */

const valkey = new ValkeyHarness();
let app: NestFastifyApplication;
let client: ValkeyClient;
let base: string;

const IP_LIMIT = TEST_IP_LIMIT;
const SUBJECT_LIMIT = TEST_SUBJECT_LIMIT;

/** One request, with the address the resolver will read. Hops is 0, so the socket decides. */
function post(path: string, body: unknown): Promise<Response> {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await valkey.start();
  client = createValkeyClient({ url: valkey.url, onError: () => {} });

  const moduleRef = await Test.createTestingModule({
    controllers: [ThrottledController],
    providers: [
      { provide: AppConfig, useValue: testConfig() },
      { provide: Logger, useClass: SilentLogger },
      ClientIpResolver,
      {
        provide: RateLimitStrategy,
        useValue: new SlidingWindowStrategy(client, new SystemClock()),
      },
      { provide: APP_GUARD, useClass: RateLimitGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new IdenzyExceptionFilter(new SilentLogger()));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = await app.getUrl();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await client?.quit();
  await valkey.stop();
});

describe("rate limiting", () => {
  it("lets a route with no spec through untouched", async () => {
    for (let i = 0; i < IP_LIMIT * 3; i += 1) {
      expect((await post("/test/throttled/open", {})).status).toBe(200);
    }
  });

  it("refuses past the subject limit, and says how long to wait", async () => {
    const body = { email: "spray-target@example.test" };

    for (let i = 0; i < SUBJECT_LIMIT; i += 1) {
      expect((await post("/test/throttled/subject", body)).status).toBe(200);
    }

    const refused = await post("/test/throttled/subject", body);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");

    const payload = (await refused.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe(ErrorCode.RateLimited);
  });

  /**
   * The reason the subject dimension exists at all. Every request above came from this
   * same address and the address budget is nowhere near spent, so what refused them was
   * the account they named — which is the bucket a distributed attacker cannot spread out
   * of, and the one an address-only limiter does not have.
   */
  it("holds a separate budget per subject", async () => {
    expect(
      (await post("/test/throttled/subject", { email: "someone-else@example.test" })).status,
    ).toBe(200);
  });

  it("takes the subject from whichever declared field the request carries", async () => {
    const phone = { phone: "+15550000001" };
    for (let i = 0; i < SUBJECT_LIMIT; i += 1) {
      expect((await post("/test/throttled/subject", phone)).status).toBe(200);
    }
    expect((await post("/test/throttled/subject", phone)).status).toBe(429);
  });

  it("limits nothing when the request names no subject it was told to look for", async () => {
    for (let i = 0; i < SUBJECT_LIMIT * 3; i += 1) {
      expect((await post("/test/throttled/subject", { nothing: "here" })).status).toBe(200);
    }
  });

  /**
   * And the reason the address dimension exists. Naming a fresh account every time evades
   * every subject bucket there is, so the burst has to be caught by where it came from.
   */
  it("refuses a burst that names a new subject every time", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < IP_LIMIT + 2; i += 1) {
      statuses.push(
        (await post("/test/throttled/address", { email: `fresh-${String(i)}@example.test` }))
          .status,
      );
    }
    expect(statuses.slice(0, IP_LIMIT)).toEqual(Array(IP_LIMIT).fill(200));
    expect(statuses.at(-1)).toBe(429);
  });
});
