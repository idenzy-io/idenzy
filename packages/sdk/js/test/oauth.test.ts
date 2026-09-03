import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { describe, expect, it } from "vitest";
import type { Navigation } from "../src/browser/navigation.js";
import { codeFromRedirect } from "../src/browser/redirect-result.js";
import { IdenzyRedirectError } from "../src/errors.js";
import { Idenzy } from "../src/idenzy.js";
import type { PkceStore } from "../src/oauth/pkce-store.js";
import { FakeTransport, FixedClock, json, sessionCreated } from "./fixtures.js";

class RecordingPkce implements PkceStore {
  saved: string | null = null;
  taken = 0;

  save(verifier: string): void {
    this.saved = verifier;
  }

  take(): string | null {
    this.taken += 1;
    const held = this.saved;
    this.saved = null;
    return held;
  }
}

class FakeNavigation implements Navigation {
  assigned: string | null = null;

  constructor(private url: string | null = null) {}

  assign(url: string): void {
    this.assigned = url;
    this.url = url;
  }

  current(): string | null {
    return this.url;
  }
}

function build(transport: FakeTransport, url: string | null = null) {
  const pkce = new RecordingPkce();
  const navigation = new FakeNavigation(url);
  const client = new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport, navigation, pkce, clock: new FixedClock() },
  );
  return { client, pkce, navigation };
}

describe("starting a social sign-in", () => {
  it("asks for the URL over json and navigates itself", async () => {
    const transport = new FakeTransport(() =>
      json(200, { authorizationUrl: "https://accounts.google.test/o/oauth2?state=abc" }),
    );
    const { client, navigation } = build(transport);

    await client.signIn.withOAuth({ provider: "google", redirectUri: "https://app.acme.test/cb" });

    expect(transport.to("v1/auth/oauth/google/start")).toHaveLength(1);
    expect(navigation.assigned).toBe("https://accounts.google.test/o/oauth2?state=abc");
  });

  it("sends the challenge and keeps the verifier, which is the whole point of pkce", async () => {
    let verifierAtRequest: string | null = null;
    const pkceHolder = { store: null as RecordingPkce | null };
    const transport = new FakeTransport(() => {
      verifierAtRequest = pkceHolder.store?.saved ?? null;
      return json(200, { authorizationUrl: "https://accounts.google.test/o/oauth2" });
    });
    const { client, pkce } = build(transport);
    pkceHolder.store = pkce;

    await client.oauth.authorizationUrl({
      provider: "google",
      redirectUri: "https://app.acme.test/cb",
    });

    const body = transport.bodyOf(transport.to("v1/auth/oauth/google/start")[0]!);
    expect(body["codeChallenge"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body["codeChallenge"]).not.toBe(verifierAtRequest);
    // Stored before the answer arrived: the flow is bound to the challenge from that moment,
    // and a verifier saved afterwards is one an interrupted page load can lose.
    expect(verifierAtRequest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("finishing a social sign-in", () => {
  it("spends the verifier once and never a second time", async () => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const { client, pkce } = build(transport, "https://app.acme.test/cb?code=abcdefghijklmnopqrst");
    pkce.save("verifier-one");

    await client.oauth.completeFromRedirect();
    await client.oauth.exchange("abcdefghijklmnopqrst");

    const exchanges = transport.to("v1/auth/oauth/exchange");
    expect(transport.bodyOf(exchanges[0]!)["codeVerifier"]).toBe("verifier-one");
    expect(transport.bodyOf(exchanges[1]!)).not.toHaveProperty("codeVerifier");
  });

  it("signs in and holds the session, so the next call has a token", async () => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const { client } = build(transport, "https://app.acme.test/cb?code=abcdefghijklmnopqrst");

    await client.oauth.completeFromRedirect();

    expect(client.user?.email).toBe("ada@example.test");
    expect(await client.getToken()).toBe("access.one");
  });

  it("does nothing on a route the redirect never reached", async () => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const { client } = build(transport, "https://app.acme.test/cb");

    expect(await client.oauth.completeFromRedirect()).toBeNull();
    expect(transport.requests).toHaveLength(0);
  });
});

describe("the redirect we come back on", () => {
  it("raises the error it carries", () => {
    expect(() =>
      codeFromRedirect(`https://app.acme.test/cb?error=${ErrorCode.AccountBanned}`),
    ).toThrowError(IdenzyRedirectError);
  });

  it("never hands back a code we do not define", () => {
    let raised: unknown;
    try {
      codeFromRedirect("https://app.acme.test/cb?error=whatever-an-attacker-writes");
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toMatchObject({ code: ErrorCode.OauthProviderError });
  });

  it("reads the single-use code, and nothing where there is none", () => {
    expect(codeFromRedirect("https://app.acme.test/cb?code=xyz")).toBe("xyz");
    expect(codeFromRedirect("https://app.acme.test/cb")).toBeNull();
    expect(codeFromRedirect(null)).toBeNull();
  });
});
