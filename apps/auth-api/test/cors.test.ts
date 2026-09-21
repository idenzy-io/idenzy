import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { UnknownProjectError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { HealthController } from "../dist/health/health.controller.js";
import { CorsPolicy } from "../dist/http/cors-policy.js";
import { LocalCell } from "../dist/tenancy/local-cell.js";
import { ProjectResolver, type ResolvedProject } from "../dist/tenancy/project-resolver.js";
import { TenantResolutionGuard } from "../dist/tenancy/tenant-resolution.guard.js";
import { FailingController } from "../dist/testing/failing.controller.js";
import { WellKnownController } from "../dist/well-known/well-known.controller.js";
import { SilentLogger, testCell, testConfig } from "./fixtures.js";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const ALLOWED = "https://app.acme.test";
const EVIL = "https://evil.test";
const AUTH_HOST = "auth.acme.test";

class StubResolver extends ProjectResolver {
  constructor() {
    // Every method is overridden; the base's Drizzle handle is never reached.
    super(null as never);
  }

  override byApiKey(key: string): Promise<ResolvedProject> {
    if (!key.startsWith("pk_us1_live")) {
      return Promise.reject(new UnknownProjectError({ detail: { key } }));
    }
    return Promise.resolve(project());
  }

  override byHost(host: string): Promise<ResolvedProject> {
    if (host.split(":")[0] !== AUTH_HOST) {
      return Promise.reject(new UnknownProjectError({ detail: { host } }));
    }
    return Promise.resolve(project());
  }
}

function project(): ResolvedProject {
  return {
    projectId: PROJECT,
    cellId: "cell",
    complianceTier: "standard",
    plan: "free",
    keyKind: "publishable",
    scopes: [],
    allowedOrigins: [ALLOWED],
    hasAuthDomain: true,
  };
}

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  // Production, so the development localhost allowance cannot mask a real refusal.
  const config = testConfig({ IDENZY_ENV: "production" });
  const moduleRef = await Test.createTestingModule({
    controllers: [FailingController, HealthController, WellKnownController],
    providers: [
      { provide: AppConfig, useValue: config },
      { provide: ProjectResolver, useValue: new StubResolver() },
      { provide: LocalCell, useValue: testCell() },
      {
        provide: TokenIssuer,
        useFactory: () =>
          LocalEs256Issuer.create(new SystemClock(), config.get("ISSUER_BASE_URL"), 300),
      },
      CorsPolicy,
      { provide: APP_GUARD, useClass: TenantResolutionGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new IdenzyExceptionFilter(new SilentLogger()));
  app.get(CorsPolicy).bindTo(app.getHttpAdapter().getInstance());
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

const key = { [IdenzyHeader.PublishableKey]: "pk_us1_live_abc" };

describe("the actual response is where the browser's gate is", () => {
  it("lets an allowlisted origin read a credentialed response", async () => {
    const response = await fetch(`${base}/test/tenant`, { headers: { ...key, origin: ALLOWED } });
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("gives an unregistered origin no header at all, so the read is blocked", async () => {
    const response = await fetch(`${base}/test/tenant`, { headers: { ...key, origin: EVIL } });
    // Deliberately not a 403: the refusal is the browser's, and a hard status here would
    // tell a prober that the origin was checked and rejected rather than never allowed.
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never pairs a wildcard with credentials on any route", async () => {
    for (const path of ["/test/tenant", "/healthz", "/.well-known/jwks.json"]) {
      const response = await fetch(base + path, { headers: { ...key, origin: ALLOWED } });
      const allowOrigin = response.headers.get("access-control-allow-origin");
      const credentials = response.headers.get("access-control-allow-credentials");
      expect(allowOrigin === "*" && credentials === "true").toBe(false);
    }
  });

  it("still carries CORS on an error, so the SDK can read our error code", async () => {
    const response = await fetch(`${base}/test/tenant`, {
      headers: { [IdenzyHeader.PublishableKey]: "pk_us1_nope", origin: EVIL },
    });
    expect(response.status).toBe(404);
    // The one place an unvetted origin is echoed. The body is our own error contract, and
    // without this the SDK sees an opaque network failure instead of `unknown_project`.
    expect(response.headers.get("access-control-allow-origin")).toBe(EVIL);
  });

  it("keeps tenant-scoped responses out of shared caches, and varies on origin", async () => {
    const response = await fetch(`${base}/test/tenant`, { headers: { ...key, origin: ALLOWED } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("origin");
  });

  it("leaves the well-known documents cacheable, which is what they are for", async () => {
    const response = await fetch(`${base}/.well-known/jwks.json`, { headers: { origin: EVIL } });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    // An origin-varying JWKS is uncacheable at the CDN, which defeats the point of it.
    expect(response.headers.get("vary")?.toLowerCase() ?? "").not.toContain("origin");
    expect(response.headers.get("cache-control")).toContain("max-age");
  });
});

describe("preflight is strict wherever the project can be resolved", () => {
  /**
   * Injected rather than fetched, because `Host` is a forbidden header name for `fetch`:
   * undici overwrites it from the URL, so a test that used fetch would silently be checking
   * the shared-host path while claiming to check the custom-domain one.
   */
  async function preflight(headers: Record<string, string>): Promise<{
    status: number;
    allowOrigin: string | undefined;
    allowMethods: string | undefined;
    allowHeaders: string | undefined;
    body: string;
  }> {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/test/tenant",
      headers: { "access-control-request-method": "POST", ...headers },
    });
    return {
      status: response.statusCode,
      allowOrigin: response.headers["access-control-allow-origin"]?.toString(),
      allowMethods: response.headers["access-control-allow-methods"]?.toString(),
      allowHeaders: response.headers["access-control-allow-headers"]?.toString(),
      body: response.body,
    };
  }

  it("refuses a cross-site preflight on a custom auth domain", async () => {
    // The Host names the project, so the allowlist can be checked before the real request
    // is ever sent. This is also the only deployment where cookie mode works, so it is the
    // only one where there are ambient credentials worth protecting.
    const response = await preflight({ origin: EVIL, host: AUTH_HOST });
    expect(response.status).toBe(204);
    expect(response.allowOrigin).toBeUndefined();
  });

  it("allows an allowlisted preflight on that same domain", async () => {
    const response = await preflight({ origin: ALLOWED, host: AUTH_HOST });
    expect(response.allowOrigin).toBe(ALLOWED);
    expect(response.allowMethods).toContain("POST");
    expect(response.allowHeaders).toContain(IdenzyHeader.PublishableKey);
  });

  it("reflects on the shared host, where no project can be resolved", async () => {
    // Grants nothing readable: a preflight only says the browser may send the real request,
    // and the real response is where Access-Control-Allow-Origin decides anything.
    const response = await preflight({ origin: EVIL, host: "api.idenzy.test" });
    expect(response.allowOrigin).toBe(EVIL);
  });

  it("never reaches a controller or the guard", async () => {
    // FailingController's routes throw, and the tenant guard refuses a request with no
    // credentials. A 204 with an empty body proves the preflight short-circuits both.
    const response = await preflight({ origin: ALLOWED, host: AUTH_HOST });
    expect(response.status).toBe(204);
    expect(response.body).toBe("");
  });
});
