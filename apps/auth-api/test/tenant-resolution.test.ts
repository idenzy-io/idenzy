import "reflect-metadata";
import { UnknownProjectError } from "@idenzy/core/errors";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { LocalCell } from "../dist/tenancy/local-cell.js";
import { ProjectResolver, type ResolvedProject } from "../dist/tenancy/project-resolver.js";
import { TenantResolutionGuard } from "../dist/tenancy/tenant-resolution.guard.js";
import { FailingController } from "../dist/testing/failing.controller.js";
import { SilentLogger, testCell } from "./fixtures.js";

const BY_KEY = "11111111-1111-1111-1111-111111111111";
const BY_HOST = "22222222-2222-2222-2222-222222222222";

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
    if (!key.startsWith("pk_us1_live") && !key.startsWith("sk_us1_live")) {
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
}

function project(projectId: string, keyKind: string | null): ResolvedProject {
  return {
    projectId,
    cellId: "cell",
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
      { provide: LocalCell, useValue: testCell() },
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

async function get(headers: Record<string, string>): Promise<Answer> {
  const response = await fetch(`${base}/test/tenant`, { headers });
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
      [IdenzyHeader.PublishableKey]: "pk_us1_live_abc",
      authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.not.a.key",
    });
    expect(answer.projectId).toBe(BY_KEY);
    // A publishable key is the application speaking, not a machine actor.
    expect(answer.actor).toBe("user");
  });

  it("refuses a secret key without ever looking it up", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "sk_us1_live_abc" });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("secret_key_not_permitted");
    // The assertion that matters: no query ran, so the endpoint cannot be used to find out
    // whether a secret key someone found is genuine.
    expect(resolver.lookups).toEqual([]);
  });

  it("answers a real secret key exactly as it answers a fabricated one", async () => {
    const real = await get({ [IdenzyHeader.PublishableKey]: "sk_us1_live_abc" });
    const fake = await get({ [IdenzyHeader.PublishableKey]: "sk_us1_deadbeef" });
    expect(real).toEqual(fake);
  });

  it("refuses a value that is not an API key at all", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "not-a-key" });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("invalid_api_key");
    expect(resolver.lookups).toEqual([]);
  });
});

/**
 * The refusal PROJECT.md 4.13.5 has always promised and nothing implemented (ADR-0006's sibling).
 *
 * "Routing refuses cross-cell access: a request that resolves to a project in another cell is
 * rejected rather than proxied, so data cannot transit a jurisdiction by accident." The panel said
 * so to customers too. What existed was `ResolvedProject.cellId`, lifted out of the resolution
 * function and read by nothing.
 */
describe("a key for another cell is refused", () => {
  it("refuses it before any lookup, so nothing is learned about whether it is real", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_eu1_live_abc" });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("wrong_region");
    // The whole point of the first line. A refusal that reached the database would have
    // confirmed the key exists, and would have had nothing left to say about where to go.
    expect(resolver.lookups).toEqual([]);
  });

  it("refuses one on Authorization too, which is where a server-side caller would put it", async () => {
    const answer = await get({ authorization: "Bearer sk_eu1_live_abc" });
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("wrong_region");
    expect(resolver.lookups).toEqual([]);
  });

  it("names the region the caller should have used, since that is the only actionable half", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_eu1_live_abc" });
    expect(answer.message).toContain("eu1");
    expect(answer.message).toContain("us1");
    // Never the key. A message is logged and forwarded in ways a detail is not.
    expect(answer.message).not.toContain("live_abc");
  });

  it("treats a key naming no cell as malformed rather than misdirected", async () => {
    // `pk_abc` has a kind and a body and no cell segment. It is not a key for somewhere else;
    // it is not a key, and saying "wrong region" about it would be a guess.
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_abc" });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("invalid_api_key");
    expect(resolver.lookups).toEqual([]);
  });

  it("accepts a key for this cell, so the check is a filter and not a wall", async () => {
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_us1_live_abc" });
    expect(answer.projectId).toBe(BY_KEY);
  });
});

describe("resolution order is first-present-wins, not a fallback chain", () => {
  it("does not fall through to Host when the header is present but unresolvable", async () => {
    const answer = await get({
      [IdenzyHeader.PublishableKey]: "pk_us1_unknown",
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
    const answer = await get({ [IdenzyHeader.PublishableKey]: "pk_us1_live_secret_kind" });
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
    const publishable = await get({ authorization: "Bearer pk_us1_live_abc" });
    expect(publishable.projectId).toBe(BY_KEY);
    expect(publishable.actor).toBe("user");

    const secret = await get({ authorization: "Bearer sk_us1_live_abc" });
    expect(secret.projectId).toBe(BY_KEY);
    expect(secret.actor).toBe("api_key");
  });
});
