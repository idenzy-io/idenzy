import "reflect-metadata";
import { UnknownProjectError } from "@idenzy/core/errors";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { ProjectResolver, type ResolvedProject } from "../dist/tenancy/project-resolver.js";
import { TenantResolutionGuard } from "../dist/tenancy/tenant-resolution.guard.js";
import { FailingController } from "../dist/testing/failing.controller.js";
import { SilentLogger } from "./fixtures.js";

const BY_KEY = "11111111-1111-1111-1111-111111111111";
const BY_HOST = "22222222-2222-2222-2222-222222222222";
const BY_FLOW = "33333333-3333-3333-3333-333333333333";

/**
 * A resolver that records every lookup, because several of these tests assert that **no**
 * lookup happened. A refusal that reaches the database has already told the caller their key
 * exists, whatever it answers afterwards.
 */
class RecordingResolver extends ProjectResolver {
  readonly lookups: string[] = [];

  constructor() {
    // The real one takes a Drizzle handle it never gets to use here: every method is
    // overridden, and a test that reached the base would fail loudly rather than query.
    super(null as never);
  }

  override byApiKey(key: string): Promise<ResolvedProject> {
    this.lookups.push(`key:${key}`);
    if (!key.startsWith("pk_live") && !key.startsWith("sk_live")) {
      return Promise.reject(new UnknownProjectError({ detail: { key } }));
    }
    // "secret_kind" stands for a provisioning mistake: a pk_-prefixed value whose stored
    // row says secret. Only the kind check can catch it.
    const kind = key.startsWith("sk_") || key.includes("secret_kind") ? "secret" : "publishable";
    return Promise.resolve(project(BY_KEY, kind));
  }

  override byHost(host: string): Promise<ResolvedProject> {
    this.lookups.push(`host:${host}`);
    return Promise.resolve(project(BY_HOST, null));
  }

  override byMagicLinkToken(token: string): Promise<ResolvedProject> {
    this.lookups.push(`link:${token}`);
    if (token !== "issued-token") {
      return Promise.reject(new UnknownProjectError({ detail: { flow: "magic_link" } }));
    }
    return Promise.resolve(project(BY_FLOW, null));
  }
}

function project(projectId: string, keyKind: string | null): ResolvedProject {
  return {
    projectId,
    complianceTier: "standard",
    plan: "free",
    keyKind,
    scopes: [],
    allowedOrigins: ["https://app.acme.test"],
    hasAuthDomain: true,
  };
}

let app: NestFastifyApplication;
let base: string;
let resolver: RecordingResolver;

beforeAll(async () => {
  resolver = new RecordingResolver();
  const moduleRef = await Test.createTestingModule({
    controllers: [FailingController],
    providers: [
      { provide: ProjectResolver, useValue: resolver },
      { provide: APP_GUARD, useClass: TenantResolutionGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new IdenzyExceptionFilter(new SilentLogger()));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resolver.lookups.length = 0;
});

interface Answer {
  readonly status: number;
  readonly code: string | undefined;
  readonly projectId: string | undefined;
  readonly actor: string | undefined;
  /** The public message, for the one refusal whose job is to say where to go instead. */
  readonly message: string | undefined;
}

async function get(headers: Record<string, string>, path = "/test/tenant"): Promise<Answer> {
  const response = await fetch(`${base}${path}`, { headers });
  const body = (await response.json()) as {
    error?: { code: string; message?: string };
    projectId?: string;
    actor?: string;
  };
  return {
    status: response.status,
    code: body.error?.code,
    projectId: body.projectId,
    actor: body.actor,
    message: body.error?.message,
  };
}

describe("the publishable key header", () => {
  it("names the project while Authorization carries the user's token", async () => {
    const answer = await get({
      [IdenzyHeader.PublishableKey]: "pk_live_abc",
      authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.not.a.key",
    });
    expect(answer.projectId).toBe(BY_KEY);
    // A publishable key is the application speaking, not a machine actor.
    expect(answer.actor).toBe("user");
  });

  it("refuses a secret key without ever looking it up", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "sk_live_abc" });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("secret_key_not_permitted");
    // The assertion that matters: no query ran, so the endpoint cannot be used to find out
    // whether a secret key someone found is genuine.
    expect(resolver.lookups).toEqual([]);
  });

  it("answers a real secret key exactly as it answers a fabricated one", async () => {
    const real = await get({ [IdenzyHeader.PublishableKey]: "sk_live_abc" });
    const fake = await get({ [IdenzyHeader.PublishableKey]: "sk_deadbeef" });
    expect(real).toEqual(fake);
  });

  it("refuses a value that is not an API key at all", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "not-a-key" });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("invalid_api_key");
    expect(resolver.lookups).toEqual([]);
  });
});

describe("resolution order is first-present-wins, not a fallback chain", () => {
  it("does not fall through to Host when the header is present but unresolvable", async () => {
    const answer = await get({
      [IdenzyHeader.PublishableKey]: "pk_unknown",
      host: "acme.auth.test",
    });
    // The failure that would be silent is resolving BY_HOST here: a request that named one
    // project would have run against another.
    expect(answer.projectId).toBeUndefined();
    expect(answer.status).toBe(404);
    expect(answer.code).toBe("unknown_project");
  });

  it("refuses a publishable-shaped key whose stored kind is secret", async () => {
    // Provisioning mistake rather than an attack, and the prefix check cannot catch it:
    // only the stored kind knows. Both checks exist because they see different things.
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_live_secret_kind" });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("secret_key_not_permitted");
    expect(answer.projectId).toBeUndefined();
  });

  it("still resolves by Host when nothing else is presented", async () => {
    const answer = await get({ host: "acme.auth.test" });
    expect(answer.projectId).toBe(BY_HOST);
    expect(answer.actor).toBe("user");
  });

  it("still accepts a key on Authorization, and audits a secret one as a machine", async () => {
    const publishable = await get({ authorization: "Bearer pk_live_abc" });
    expect(publishable.projectId).toBe(BY_KEY);
    expect(publishable.actor).toBe("user");

    const secret = await get({ authorization: "Bearer sk_live_abc" });
    expect(secret.projectId).toBe(BY_KEY);
    expect(secret.actor).toBe("api_key");
  });
});

describe("a route a browser is sent to with a one-time secret", () => {
  it("is named by the secret, where the shared host names nothing", async () => {
    const answer = await get({}, "/test/tenant-from-link?token=issued-token");
    expect(answer.projectId).toBe(BY_FLOW);
    expect(resolver.lookups).toEqual(["link:issued-token"]);
  });

  it("refuses a secret nobody issued, rather than falling back to Host", async () => {
    const answer = await get({}, "/test/tenant-from-link?token=forged");
    expect(answer.code).toBe("unknown_project");
    expect(resolver.lookups).toEqual(["link:forged"]);
  });

  it("still lets a presented key win, first present as everywhere", async () => {
    const answer = await get(
      { [IdenzyHeader.PublishableKey]: "pk_live_abc" },
      "/test/tenant-from-link?token=issued-token",
    );
    expect(answer.projectId).toBe(BY_KEY);
  });

  it("means nothing on a route that doesn't take one", async () => {
    const answer = await get({}, "/test/tenant?token=issued-token");
    expect(answer.projectId).toBe(BY_HOST);
  });
});
