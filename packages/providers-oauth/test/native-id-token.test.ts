import type { ProviderCredentials } from "@idenzy/domain/ports/oauth-provider";
import { FakeClock } from "@idenzy/testing/fakes";
import type { OAuthProviderDependencies } from "@idenzy/testing/oauth-provider-conformance";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { nativeAudiencesOf } from "../src/oidc-provider.js";
import { AppleProvider } from "../src/providers/apple-provider.js";
import { GoogleProvider } from "../src/providers/google-provider.js";

/**
 * Native Sign in with Apple and Google (PROJECT.md 4.4), through the real JWKS path.
 *
 * A native token arrives with no redirect, so the token is all the proof there is, and every
 * check on it is a defence with an attack behind it: another app's token (audience), another
 * issuer's (mix-up), an old one (expiry), and one from a sign-in this project did not start
 * (nonce). Each has a test that presents the attack and expects the refusal (PROJECT.md 7.4).
 *
 * Its own file because the key sets are cached per process, keyed on the provider's JWKS URL:
 * a fresh module is a fresh cache, so the unreachable-key-set case below sees no earlier fetch.
 */

const deps: OAuthProviderDependencies = {
  // Never called: a native token is verified against the key set, which arrives by `fetch`.
  // The cast is the one the conformance tests use for the same unused client.
  http: { json: () => Promise.reject(new Error("no network in this test")) } as never,
  clock: new FakeClock(new Date()),
  flows: { start: () => Promise.resolve(""), consume: () => Promise.resolve(null) },
  allowlist: { isAllowed: () => Promise.resolve(true) },
};

const DIGEST = "6f1ed002ab5595859014ebf0951522d9f2e5d3a0d4f0c1b3c6f5a2c6b7c8d9e0";
const apple = new AppleProvider(deps.http, deps.clock, deps.flows, deps.allowlist);
const google = new GoogleProvider(deps.http, deps.clock, deps.flows, deps.allowlist);

const appleCredentials: ProviderCredentials = {
  clientId: "com.example.web",
  clientSecret: "",
  scopes: [],
  config: { teamId: "ABCDE12345", keyId: "KEY1234567", nativeAudiences: "com.example.ios" },
};
const googleCredentials: ProviderCredentials = {
  clientId: "web-client.apps.googleusercontent.com",
  clientSecret: "",
  scopes: [],
  config: { nativeAudiences: "ios-client.apps.googleusercontent.com" },
};

let sign: (claims: Record<string, unknown>, audience: string, lifetime?: string) => Promise<string>;
let serveKeys: () => void;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "native-key", alg: "RS256" };
  serveKeys = () =>
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  serveKeys();
  sign = (claims, audience, lifetime = "5m") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "native-key" })
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(lifetime)
      .sign(privateKey);
});

describe("a key set that cannot be fetched", () => {
  /** Runs first, against a module whose cache has never fetched anything. */
  it("is the provider failing, not a bad token", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const fresh = await import("../src/providers/apple-provider.js");
    const provider = new fresh.AppleProvider(deps.http, deps.clock, deps.flows, deps.allowlist);
    const token = await sign(
      { iss: "https://appleid.apple.com", sub: "001", nonce: DIGEST },
      "com.example.ios",
    );
    await expect(provider.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "oauth_provider_error",
    });
    serveKeys();
  });
});

describe("apple", () => {
  const valid = {
    iss: "https://appleid.apple.com",
    sub: "001234.abc",
    email: "ada@privaterelay.appleid.com",
    email_verified: "true",
    nonce: DIGEST,
  };

  it("accepts a token minted for the project's iOS app", async () => {
    const profile = await apple.verifyIdToken(
      appleCredentials,
      await sign(valid, "com.example.ios"),
      DIGEST,
    );
    expect(profile).toEqual({
      providerUserId: "001234.abc",
      email: "ada@privaterelay.appleid.com",
      emailVerified: true,
      displayName: null,
      avatarUrl: null,
    });
  });

  it("accepts a token minted for the project's Services ID", async () => {
    const token = await sign(valid, "com.example.web");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).resolves.toMatchObject({
      providerUserId: "001234.abc",
    });
  });

  it("refuses a token minted for somebody else's app", async () => {
    const token = await sign(valid, "com.attacker.ios");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("refuses a token from a sign-in this project did not start", async () => {
    const token = await sign({ ...valid, nonce: "a".repeat(64) }, "com.example.ios");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("refuses a token that carries no nonce at all", async () => {
    const { nonce: _, ...withoutNonce } = valid;
    const token = await sign(withoutNonce, "com.example.ios");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("refuses a token signed under another issuer", async () => {
    const token = await sign({ ...valid, iss: "https://appleid.example.test" }, "com.example.ios");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("refuses an expired token", async () => {
    const token = await sign(valid, "com.example.ios", "-5m");
    await expect(apple.verifyIdToken(appleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("refuses a token whose signature is not the provider's", async () => {
    const token = await sign(valid, "com.example.ios");
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.${"A".repeat(342)}`;
    await expect(apple.verifyIdToken(appleCredentials, forged, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });
});

describe("google", () => {
  const valid = {
    iss: "https://accounts.google.com",
    sub: "1098",
    email: "ada@example.com",
    email_verified: true,
    name: "Ada Lovelace",
    picture: "https://lh3.googleusercontent.com/a/ada",
    nonce: DIGEST,
  };

  it("accepts a token minted for the web client, as Credential Manager mints them", async () => {
    const profile = await google.verifyIdToken(
      googleCredentials,
      await sign(valid, "web-client.apps.googleusercontent.com"),
      DIGEST,
    );
    expect(profile).toEqual({
      providerUserId: "1098",
      email: "ada@example.com",
      emailVerified: true,
      displayName: "Ada Lovelace",
      avatarUrl: "https://lh3.googleusercontent.com/a/ada",
    });
  });

  it("accepts a token minted for the project's iOS client, with Google's bare issuer", async () => {
    const token = await sign(
      { ...valid, iss: "accounts.google.com" },
      "ios-client.apps.googleusercontent.com",
    );
    await expect(google.verifyIdToken(googleCredentials, token, DIGEST)).resolves.toMatchObject({
      providerUserId: "1098",
    });
  });

  it("refuses any issuer that only resembles Google's", async () => {
    const token = await sign(
      { ...valid, iss: "https://accounts.google.com.evil.test" },
      "web-client.apps.googleusercontent.com",
    );
    await expect(google.verifyIdToken(googleCredentials, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });

  it("keeps the project's Workspace restriction for native tokens too", async () => {
    const restricted = {
      ...googleCredentials,
      config: { ...googleCredentials.config, hostedDomain: "corp.test" },
    };
    const token = await sign(valid, "web-client.apps.googleusercontent.com");
    await expect(google.verifyIdToken(restricted, token, DIGEST)).rejects.toMatchObject({
      code: "id_token_invalid",
    });
  });
});

describe("native audiences", () => {
  it("are read from one setting, separated however a console pastes them", () => {
    const credentials = {
      ...googleCredentials,
      config: { nativeAudiences: " a.apps, b.apps\nc.apps  " },
    };
    expect(nativeAudiencesOf(credentials)).toEqual(["a.apps", "b.apps", "c.apps"]);
    expect(nativeAudiencesOf({ ...googleCredentials, config: {} })).toEqual([]);
  });
});
