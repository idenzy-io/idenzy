import { AccessTokenInvalidError, MissingCredentialsError } from "@idenzy/core/errors";
import { IdenzyCookie } from "@idenzy/protocol/http/headers";
import { beforeAll, describe, expect, it } from "vitest";
import { AccessTokenVerifier } from "../src/idenzy-node.js";
import { StaticJwks } from "../src/jwks.js";
import { ISSUER, OTHER_PROJECT, PROJECT, type TestIssuer, testIssuer } from "./fixtures.js";

let tokens: TestIssuer;
let verifier: AccessTokenVerifier;

beforeAll(async () => {
  tokens = await testIssuer();
  verifier = new AccessTokenVerifier(
    { issuerUrl: ISSUER, projectId: PROJECT },
    new StaticJwks(tokens.jwks),
  );
});

describe("a token we issued", () => {
  it("verifies, and reads the claims at the types it promises", async () => {
    const verified = await verifier.verify(await tokens.mint({ amr: ["pwd", "otp"], fva: 30 }));

    expect(verified.userId).toBe("usr_00000000000000000001");
    expect(verified.sessionId).toBe("ses_00000000000000000001");
    expect(verified.projectId).toBe(PROJECT);
    expect(verified.amr).toEqual(["pwd", "otp"]);
    expect(verified.factorVerifiedSecondsAgo).toBe(30);
    expect(verified.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reads when the session was signed in to, and null where the token does not say", async () => {
    const signedIn = Math.floor(Date.now() / 1000) - 3600;
    const verified = await verifier.verify(await tokens.mint({ extra: { auth_time: signedIn } }));
    expect(verified.authenticatedAt).toEqual(new Date(signedIn * 1000));

    expect((await verifier.verify(await tokens.mint())).authenticatedAt).toBeNull();
  });

  it("hands back the whole payload, for the claims a project adds to its own tokens", async () => {
    const verified = await verifier.verify(await tokens.mint({ extra: { plan: "pro" } }));

    expect(verified.claims["plan"]).toBe("pro");
  });

  it("reports no second factor as null, which callers must read as unsatisfiable", async () => {
    const verified = await verifier.verify(await tokens.mint());

    expect(verified.factorVerifiedSecondsAgo).toBeNull();
  });
});

/**
 * The attacks. One issuer serves every project on a deployment, so the signature is not
 * evidence of anything on its own: `aud` is what separates one customer's tokens from
 * another's, and every one of these would pass a check that only verified the signature.
 */
describe("a token we did not issue for this project", () => {
  it("refuses a valid token minted for a different project", async () => {
    const other = await tokens.mint({ audience: OTHER_PROJECT });

    await expect(verifier.verify(other)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it("refuses a token from another issuer, however well signed", async () => {
    const elsewhere = await tokens.mint({ issuer: "https://auth.evil.test" });

    await expect(verifier.verify(elsewhere)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it("refuses a token signed by a key we do not publish", async () => {
    const stranger = await testIssuer("stranger-key");

    await expect(verifier.verify(await stranger.mint())).rejects.toBeInstanceOf(
      AccessTokenInvalidError,
    );
  });

  it("refuses an expired token, tolerating only the skew it was configured for", async () => {
    const stale = await tokens.mint({ expiresInSeconds: -60 });

    await expect(verifier.verify(stale)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it("refuses a token with no session claim, which is what makes ours revocable", async () => {
    const noSession = await tokens.mint({ extra: { sid: undefined } });

    await expect(verifier.verify(noSession)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it("refuses an unsigned token, which is the oldest trick there is", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: PROJECT, sub: "usr_1", sid: "ses_1", exp: 9e9, iat: 0 }),
    ).toString("base64url");

    await expect(verifier.verify(`${header}.${body}.`)).rejects.toBeInstanceOf(
      AccessTokenInvalidError,
    );
  });
});

describe("configuring the verifier", () => {
  it("refuses a project id that is not one, rather than verifying against nothing", () => {
    expect(
      () =>
        new AccessTokenVerifier(
          { issuerUrl: ISSUER, projectId: "acme" },
          new StaticJwks({ keys: [] }),
        ),
    ).toThrow(AccessTokenInvalidError);
  });
});

describe("reading the token out of a request", () => {
  it("takes the bearer token when there is one", async () => {
    const token = await tokens.mint();

    const verified = await verifier.verifyRequest({ authorization: `Bearer ${token}` });

    expect(verified.sessionId).toBe("ses_00000000000000000001");
  });

  /** The cookie is what makes a server-rendered page for a signed-in user cost no round trip. */
  it("falls back to the session cookie, which is what SSR has", async () => {
    const token = await tokens.mint();

    const verified = await verifier.verifyRequest({
      cookie: `other=1; ${IdenzyCookie.Session}=${token}; ${IdenzyCookie.Csrf}=abc`,
    });

    expect(verified.userId).toBe("usr_00000000000000000001");
  });

  it("reads a Headers object as readily as a plain record", async () => {
    const token = await tokens.mint();
    const headers = new Headers({ authorization: `Bearer ${token}` });

    const verified = await verifier.verifyRequest(headers);

    expect(verified.projectId).toBe(PROJECT);
  });

  it("says the credential is missing rather than that it is invalid", async () => {
    await expect(verifier.verifyRequest({})).rejects.toBeInstanceOf(MissingCredentialsError);
  });

  it("ignores a scheme that is not Bearer", async () => {
    const token = await tokens.mint();

    await expect(
      verifier.verifyRequest({ authorization: `Basic ${token}` }),
    ).rejects.toBeInstanceOf(MissingCredentialsError);
  });
});

/**
 * The project key signs revocation snapshots as well as access tokens, so a signature is
 * not evidence of which one is in hand. This token is otherwise perfect: right issuer,
 * right audience, live, and carrying the `sub` and `sid` a session token carries. Only the
 * media type says it is something else (RFC 8725 section 3.11).
 */
describe("a statement of another kind", () => {
  it("is refused even when it is shaped exactly like an access token", async () => {
    const statement = await tokens.mint({ typ: "idenzy-revocations+jwt" });

    await expect(verifier.verify(statement)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });
});
