import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { SystemClock } from "@idenzy/core/time/clock";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { openidConfigurationSchema } from "@idenzy/protocol/schemas/discovery";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdenzyExceptionFilter } from "../dist/common/exception.filter.js";
import { WellKnownController } from "../dist/well-known/well-known.controller.js";
import { SilentLogger, testConfig } from "./fixtures.js";

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  const config = testConfig();
  const moduleRef = await Test.createTestingModule({
    controllers: [WellKnownController],
    providers: [
      { provide: AppConfig, useValue: config },
      {
        provide: TokenIssuer,
        useFactory: () =>
          LocalEs256Issuer.create(new SystemClock(), config.get("ISSUER_BASE_URL"), 300),
      },
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

/** Every `*_endpoint` in the document, as a path this service can be asked for. */
const advertisedEndpoints = (document: Record<string, unknown>, issuer: string): string[] =>
  Object.entries(document)
    .filter(([name, value]) => name.endsWith("_endpoint") && typeof value === "string")
    .map(([, value]) => (value as string).slice(issuer.length));

describe("OIDC discovery", () => {
  it("satisfies the published schema", async () => {
    const response = await fetch(`${base}/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    expect(openidConfigurationSchema.safeParse(await response.json()).success).toBe(true);
  });

  /**
   * The test that matters, and the one whose absence let three dead endpoints ship.
   *
   * A discovery document is a promise a client acts on without asking first: it reads
   * `authorization_endpoint` and redirects a real user there. So the assertion is not
   * that the document parses — it did, with `/oauth/authorize` in it — but that every
   * URL it names is a route this service actually serves.
   */
  it("advertises no endpoint that does not exist", async () => {
    const issuer = testConfig().get("ISSUER_BASE_URL");
    const document = (await (
      await fetch(`${base}/.well-known/openid-configuration`)
    ).json()) as Record<string, unknown>;

    const paths = [
      ...advertisedEndpoints(document, issuer),
      // jwks_uri is the one URL that is not named `*_endpoint` and is the one every
      // verifier actually fetches, so it is checked by name rather than by convention.
      (document["jwks_uri"] as string).slice(issuer.length),
    ];

    for (const path of paths) {
      const response = await fetch(base + path);
      expect(response.status, `${path} is advertised by discovery`).not.toBe(404);
    }
  });

  it("names the issuer it signs with", async () => {
    const document = (await (
      await fetch(`${base}/.well-known/openid-configuration`)
    ).json()) as Record<string, unknown>;
    expect(document["issuer"]).toBe(testConfig().get("ISSUER_BASE_URL"));
    expect(document["id_token_signing_alg_values_supported"]).toEqual(["ES256"]);
  });
});
