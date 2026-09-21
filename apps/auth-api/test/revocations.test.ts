import "reflect-metadata";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { IssuerTokenVerifier } from "@idenzy/crypto/tokens/token-verifier";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import {
  REVOCATION_SNAPSHOT_TYP,
  revocationSnapshotSchema,
} from "@idenzy/protocol/schemas/revocation";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { RevocationController } from "../dist/revocation/revocation.controller.js";
import { LocalCell } from "../dist/tenancy/local-cell.js";
import { ProjectResolver } from "../dist/tenancy/project-resolver.js";
import { SecretKeyGuard } from "../dist/tenancy/secret-key.guard.js";
import { TenantResolutionGuard } from "../dist/tenancy/tenant-resolution.guard.js";
import { InMemoryRevocationCommands, SilentLogger, testCell, testConfig } from "./fixtures.js";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const SESSION = "ses_00000000000000000001";
const clock = new SystemClock();
const config = testConfig();

let app: NestFastifyApplication;
let base: string;
let commands: InMemoryRevocationCommands;
let set: RevocationSet;
let issuer: TokenIssuer;

/** Resolves any key, so what these tests exercise is the guard's rules and not the lookup. */
function resolver(): Pick<ProjectResolver, "byHost" | "byApiKey" | "byPublishableKey"> {
  const project = {
    projectId: PROJECT,
    cellId: "cell",
    complianceTier: "standard",
    plan: "pro",
    scopes: [],
    allowedOrigins: [],
    hasAuthDomain: false,
  };
  return {
    byHost: () => Promise.resolve({ ...project, keyKind: null }),
    byApiKey: () => Promise.resolve({ ...project, keyKind: ApiKeyKind.Secret }),
    byPublishableKey: () => Promise.resolve({ ...project, keyKind: ApiKeyKind.Publishable }),
  };
}

beforeAll(async () => {
  issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  commands = new InMemoryRevocationCommands();
  set = new RevocationSet(commands, clock, 360);

  const moduleRef = await Test.createTestingModule({
    controllers: [RevocationController],
    providers: [
      { provide: AppConfig, useValue: config },
      { provide: TokenIssuer, useValue: issuer },
      { provide: RevocationSet, useValue: set },
      { provide: ProjectResolver, useValue: resolver() },
      { provide: LocalCell, useValue: testCell() },
      { provide: APP_GUARD, useClass: TenantResolutionGuard },
      { provide: APP_GUARD, useClass: SecretKeyGuard },
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
  commands.sorted.clear();
  commands.strings.clear();
});

function withSecretKey(headers: Record<string, string> = {}): RequestInit {
  return { headers: { authorization: "Bearer sk_us1_test_abcdef", ...headers } };
}

async function claims(body: string): Promise<unknown> {
  const keys = createLocalJWKSet({ keys: [...(await issuer.publicKeys())] });
  const { payload } = await jwtVerify(body, keys, {
    issuer: config.get("ISSUER_BASE_URL"),
    typ: REVOCATION_SNAPSHOT_TYP,
  });
  return payload;
}

describe("who may read the set", () => {
  /**
   * A project id travels in every access token's `aud`, so it reaches browsers. A public
   * endpoint would let anyone holding one token watch that project's revocations, which
   * names users and times their security events (ADR-0009).
   */
  it("refuses a publishable key, which is the one that reaches a browser", async () => {
    const response = await fetch(`${base}/v1/revocations`, {
      headers: { [IdenzyHeader.PublishableKey]: "pk_us1_test_abc" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "insufficient_scope" } });
  });

  /** Resolving by Host is an application being used, not a machine acting. */
  it("refuses a request that named its project by Host alone", async () => {
    const response = await fetch(`${base}/v1/revocations`);

    expect(response.status).toBe(403);
  });

  it("serves a secret key", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());

    expect(response.status).toBe(200);
  });
});

describe("the published snapshot", () => {
  it("is a signed statement anyone with our JWKS can check", async () => {
    await set.revokeSessions(PROJECT, [SESSION], clock.now());

    const response = await fetch(`${base}/v1/revocations`, withSecretKey());
    const payload = await claims(await response.text());

    expect(response.headers.get("content-type")).toContain("application/jwt");
    expect(payload).toMatchObject({ sessions: [SESSION] });
  });

  /**
   * The same key signs access tokens, so the media type is the only thing that stops a
   * snapshot being replayed where a token is expected (RFC 8725 section 3.11).
   */
  it("is typed as something that is not an access token", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());

    expect(decodeProtectedHeader(await response.text()).typ).toBe(REVOCATION_SNAPSHOT_TYP);
  });

  /**
   * Without an expiry, anything on the path could serve one copy forever and revocation
   * would stop working with nothing observable at either end.
   */
  it("expires, so a withheld copy becomes stale rather than invisible", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());
    const payload = (await claims(await response.text())) as { exp: number; iat: number };

    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it("matches the wire schema, including the retention window it was built with", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());

    const parsed = revocationSnapshotSchema.safeParse(await claims(await response.text()));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.retentionSeconds).toBe(config.get("ACCESS_TOKEN_TTL_SECONDS") + 60);
  });

  it("carries a bulk revocation as one watermark, not a list of sessions", async () => {
    await set.revokeUser(PROJECT, "usr_00000000000000000001", clock.now());

    const response = await fetch(`${base}/v1/revocations`, withSecretKey());
    const payload = (await claims(await response.text())) as { users: unknown[] };

    expect(payload.users).toHaveLength(1);
  });

  it("is not cached anywhere shared, because one project's set is not another's", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());

    expect(response.headers.get("cache-control")).toContain("private");
  });
});

/**
 * Both statements carry the same signature from the same project key, so a verifier that
 * checked only the signature would accept a snapshot as somebody's credential. Two things
 * stop it, and this asserts the outcome of both: a snapshot cannot carry the claims that
 * name a session, and its media type is not `JWT`. The test that isolates the second one
 * lives in `@idenzy/node`, where a token can be minted without going through our issuer.
 */
describe("a snapshot presented as an access token", () => {
  it("is refused where an access token is expected", async () => {
    const response = await fetch(`${base}/v1/revocations`, withSecretKey());
    const snapshot = await response.text();

    const verifier = new IssuerTokenVerifier(issuer, config.get("ISSUER_BASE_URL"));

    await expect(verifier.verify(snapshot)).rejects.toMatchObject({
      code: "access_token_invalid",
    });
  });
});

describe("polling it", () => {
  /**
   * The ETag is over the content rather than the signature. A fresh signature every poll
   * would change the bytes each time, which is what would put a fleet of pollers on our
   * origin for a set that has not moved.
   */
  it("answers 304 when nothing has been revoked since the last poll", async () => {
    const first = await fetch(`${base}/v1/revocations`, withSecretKey());
    const etag = first.headers.get("etag") ?? "";

    const second = await fetch(`${base}/v1/revocations`, withSecretKey({ "if-none-match": etag }));

    expect(etag).not.toBe("");
    expect(second.status).toBe(304);
  });

  it("answers afresh once something has been revoked", async () => {
    const first = await fetch(`${base}/v1/revocations`, withSecretKey());
    const etag = first.headers.get("etag") ?? "";
    await set.revokeSessions(PROJECT, [SESSION], clock.now());

    const second = await fetch(`${base}/v1/revocations`, withSecretKey({ "if-none-match": etag }));

    expect(second.status).toBe(200);
  });
});
