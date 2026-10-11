import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { ResourceNotFoundError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { LocalKeyEncryption } from "@idenzy/crypto/kms/local-key-encryption";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import {
  generateSigningKey,
  SigningKeyStore,
  WrappedEs256Issuer,
  type WrappedSigningKey,
} from "@idenzy/crypto/tokens/wrapped-es256-issuer";
import { type Jwk, jwksSchema } from "@idenzy/protocol/schemas/discovery";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { ProjectKeysController } from "../dist/well-known/project-keys.controller.js";
import { SilentLogger, testConfig } from "./fixtures.js";

const ACME = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const GLOBEX = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const publicOf = (uuid: string): string => `prj_${uuid.replaceAll("-", "")}`;
const wrapping = new LocalKeyEncryption(randomBytes(32));

/** Two projects that exist, and a key made for each on first use, like the real store. */
class MemoryKeys extends SigningKeyStore {
  private readonly made = new Map<string, Promise<WrappedSigningKey>>();
  override primary(projectId: string): Promise<WrappedSigningKey> {
    if (projectId !== ACME && projectId !== GLOBEX) {
      return Promise.reject(new ResourceNotFoundError({ detail: { entity: "project" } }));
    }
    const key = this.made.get(projectId) ?? generateSigningKey(projectId, wrapping);
    this.made.set(projectId, key);
    return key;
  }
  override async publishable(projectId: string): Promise<readonly Jwk[]> {
    return [(await this.primary(projectId)).publicJwk];
  }
}

let app: NestFastifyApplication;
let base: string;
let issuer: TokenIssuer;
const ISSUER = testConfig().get("ISSUER_BASE_URL");

beforeAll(async () => {
  issuer = new WrappedEs256Issuer(new SystemClock(), ISSUER, 300, new MemoryKeys(), wrapping);
  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectKeysController],
    providers: [{ provide: TokenIssuer, useValue: issuer }],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new IdenzyExceptionFilter(new SilentLogger()));
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

const jwksOf = (projectId: string): URL => new URL(`${base}/v1/projects/${projectId}/jwks.json`);

function mint(projectId: string): Promise<{ token: string }> {
  return issuer.issue({
    sub: "usr_8f14e45fceea167a5a36dedd4bea2543",
    sid: "ses_1f0b1e6c8a7d4e2f9b3c5d8a7e6f4b21",
    aud: publicOf(projectId),
    amr: ["magic_link"],
  });
}

describe("a project's signing keys", () => {
  it("are published at the project's own path, cacheable", async () => {
    const response = await fetch(jwksOf(publicOf(ACME)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const body = jwksSchema.parse(await response.json());
    expect(body.keys).toHaveLength(1);
  });

  it("are a different key for every project", async () => {
    const acme = jwksSchema.parse(await (await fetch(jwksOf(publicOf(ACME)))).json());
    const globex = jwksSchema.parse(await (await fetch(jwksOf(publicOf(GLOBEX)))).json());
    expect(acme.keys[0]?.kid).not.toBe(globex.keys[0]?.kid);
    expect(acme.keys[0]?.x).not.toBe(globex.keys[0]?.x);
  });

  /**
   * What a verifier configured with three facts (this URL, the issuer, the audience) gets, and
   * the boundary per-project keys exist for: a token for one project does not verify against
   * another's keys, whatever audience the verifier was told to expect.
   */
  it("verify that project's tokens and nobody else's", async () => {
    const { token } = await mint(ACME);
    const verified = await jwtVerify(token, createRemoteJWKSet(jwksOf(publicOf(ACME))), {
      issuer: ISSUER,
      audience: publicOf(ACME),
    });
    expect(verified.payload.aud).toBe(publicOf(ACME));

    await expect(
      jwtVerify(token, createRemoteJWKSet(jwksOf(publicOf(GLOBEX))), { issuer: ISSUER }),
    ).rejects.toThrow();
  });

  it("are not found for a project that does not exist, or an id that is not one", async () => {
    const unknown = publicOf("00000000-0000-4000-8000-000000000000");
    const refused = await fetch(jwksOf(unknown));
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control") ?? "").not.toContain("max-age");
    expect((await fetch(jwksOf("not-a-project"))).status).toBe(404);
  });

  it("leave nothing at the deployment-wide paths, which could only be right for one project", async () => {
    expect((await fetch(`${base}/.well-known/jwks.json`)).status).toBe(404);
    expect((await fetch(`${base}/.well-known/openid-configuration`)).status).toBe(404);
  });
});
