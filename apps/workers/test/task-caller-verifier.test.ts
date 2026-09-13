import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWK, type KeyObject, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleOidcVerifier } from "../src/google/task-caller-verifier.js";

/**
 * The token on an incoming task, verified against a key set we serve ourselves.
 *
 * This is the real verifier, not a fake: the only thing standing in for Google is the key set, which
 * is what makes every attack below expressible. The three that matter are a token signed by somebody
 * else, a genuine Google token issued for another audience, and a genuine token for this audience
 * belonging to another identity — because a public audience means any Google account can obtain one.
 */

const AUDIENCE = "https://workers-abc.a.run.app";
const SERVICE_ACCOUNT = "webhooks@idenzy-dev.iam.gserviceaccount.com";

let keys: { readonly privateKey: KeyObject; readonly publicKey: KeyObject };
let forged: { readonly privateKey: KeyObject; readonly publicKey: KeyObject };
let jwks: Server | null = null;
let jwksUri = "";

async function token(
  claims: Readonly<Record<string, unknown>>,
  signWith: KeyObject = keys.privateKey,
): Promise<string> {
  return await new SignJWT({ email: SERVICE_ACCOUNT, email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signWith);
}

function verifier(): GoogleOidcVerifier {
  return new GoogleOidcVerifier(
    { audience: AUDIENCE, serviceAccount: SERVICE_ACCOUNT },
    {
      jwksUri,
    },
  );
}

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  forged = await generateKeyPair("RS256");
  const published: JWK = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256" };

  jwks = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [published] }));
  });
  await new Promise<void>((resolve) => {
    jwks?.listen(0, resolve);
  });
  const { port } = jwks.address() as AddressInfo;
  jwksUri = `http://127.0.0.1:${port}/certs`;
});

afterAll(async () => {
  const server = jwks;
  jwks = null;
  if (server === null) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("who may ask this worker to dispatch a delivery", () => {
  it("accepts the service account the queue mints tokens for", async () => {
    expect(await verifier().verify(await token({}))).toBe(SERVICE_ACCOUNT);
  });

  it("refuses a token signed by somebody else's key", async () => {
    await expect(verifier().verify(await token({}, forged.privateKey))).rejects.toThrow();
  });

  it("refuses a token issued for another audience", async () => {
    const other = await new SignJWT({ email: SERVICE_ACCOUNT, email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("https://someone-elses-service.a.run.app")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);

    // Genuinely Google's, genuinely valid, and not for us. Accepting it would make every service in
    // the project a caller of this one.
    await expect(verifier().verify(other)).rejects.toThrow();
  });

  it("refuses another identity holding a valid token for this audience", async () => {
    await expect(verifier().verify(await token({ email: "intern@example.com" }))).rejects.toThrow();
  });

  it("refuses an identity whose email is not verified", async () => {
    await expect(verifier().verify(await token({ email_verified: false }))).rejects.toThrow();
  });

  it("refuses an expired token", async () => {
    const stale = await new SignJWT({ email: SERVICE_ACCOUNT, email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keys.privateKey);

    await expect(verifier().verify(stale)).rejects.toThrow();
  });
});
