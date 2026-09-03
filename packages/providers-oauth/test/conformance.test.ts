import type { ProviderCredentials } from "@idenzy/domain/ports/oauth-provider";
import {
  OAuthProviderConformanceSuite,
  type OAuthProviderDependencies,
} from "@idenzy/testing/oauth-provider-conformance";
import { describe, expect, it } from "vitest";
import { AppleProvider } from "../src/providers/apple-provider.js";
import { DiscordProvider } from "../src/providers/discord-provider.js";
import { FacebookProvider } from "../src/providers/facebook-provider.js";
import { GithubProvider } from "../src/providers/github-provider.js";
import { GoogleProvider } from "../src/providers/google-provider.js";
import { LinkedinProvider } from "../src/providers/linkedin-provider.js";
import { MicrosoftProvider } from "../src/providers/microsoft-provider.js";
import { TwitchProvider } from "../src/providers/twitch-provider.js";
import { XProvider } from "../src/providers/x-provider.js";

const providers = {
  google: (d: OAuthProviderDependencies) =>
    new GoogleProvider(d.http, d.clock, d.flows, d.allowlist),
  microsoft: (d: OAuthProviderDependencies) =>
    new MicrosoftProvider(d.http, d.clock, d.flows, d.allowlist),
  github: (d: OAuthProviderDependencies) =>
    new GithubProvider(d.http, d.clock, d.flows, d.allowlist),
  apple: (d: OAuthProviderDependencies) => new AppleProvider(d.http, d.clock, d.flows, d.allowlist),
  facebook: (d: OAuthProviderDependencies) =>
    new FacebookProvider(d.http, d.clock, d.flows, d.allowlist),
  discord: (d: OAuthProviderDependencies) =>
    new DiscordProvider(d.http, d.clock, d.flows, d.allowlist),
  twitch: (d: OAuthProviderDependencies) =>
    new TwitchProvider(d.http, d.clock, d.flows, d.allowlist),
  linkedin: (d: OAuthProviderDependencies) =>
    new LinkedinProvider(d.http, d.clock, d.flows, d.allowlist),
  x: (d: OAuthProviderDependencies) => new XProvider(d.http, d.clock, d.flows, d.allowlist),
} as const;

const credentials: ProviderCredentials = {
  clientId: "client-id",
  clientSecret: "secret",
  scopes: [],
  config: {},
};

/**
 * PROJECT.md 4.6 and 7.4. The point of the base class is that a new provider is
 * endpoints and a profile mapping and cannot omit a security step, and this is what
 * turns that from a claim about code review into a property of the build.
 */
describe.each(Object.entries(providers))("%s", (name, factory) => {
  it("satisfies the OAuth provider family contract", async () => {
    const failures = await new OAuthProviderConformanceSuite().run({ name, subject: factory });
    expect(failures).toEqual([]);
  });
});

describe("provider specifics", () => {
  const deps = (): OAuthProviderDependencies => ({
    http: { json: () => Promise.reject(new Error("no network in this test")) } as never,
    clock: { now: () => new Date(), nowMs: () => Date.now() } as never,
    flows: { start: () => Promise.resolve(""), consume: () => Promise.resolve(null) },
    allowlist: { isAllowed: () => Promise.resolve(true) },
  });

  const request = {
    state: "s",
    nonce: "n",
    codeChallenge: "c",
    callbackUri: "https://auth.test/cb",
  };

  it("asks Google to let the user pick which account they mean", () => {
    const url = new URL(providers.google(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  /**
   * Apple posts the callback instead of redirecting to it whenever a scope beyond
   * `openid` is requested, so the controller has to accept both verbs. If this ever
   * stops being set, sign-in breaks in a way that looks like a routing bug.
   */
  it("asks Apple to post the callback when it will send a name", () => {
    const url = new URL(providers.apple(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("response_mode")).toBe("form_post");
  });

  it("leaves the response mode alone when Apple is asked for openid only", () => {
    const url = new URL(
      providers.apple(deps()).authorizationUrl({ ...credentials, scopes: ["openid"] }, request),
    );
    expect(url.searchParams.has("response_mode")).toBe(false);
  });

  it("asks GitHub for the address endpoint, since its public email is not verified", () => {
    const url = new URL(providers.github(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  /**
   * Facebook drops a Graph version roughly every two years, and an unpinned call starts
   * failing on their schedule rather than ours.
   */
  it("pins the Graph version Facebook is called on", () => {
    const url = new URL(providers.facebook(deps()).authorizationUrl(credentials, request));
    expect(url.pathname.startsWith("/v21.0/")).toBe(true);
  });

  it("asks Discord for the address and the flag that says whether it is confirmed", () => {
    const url = new URL(providers.discord(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("identify email");
  });

  it("asks Twitch for the scope its address lives behind", () => {
    const url = new URL(providers.twitch(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("user:read:email");
  });

  /** OIDC, so the profile is in the id_token and there is no userinfo call to make. */
  it("asks LinkedIn for an id_token", () => {
    const url = new URL(providers.linkedin(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("nonce")).toBe("n");
  });

  it("sends Microsoft to the directory the project configured", () => {
    const url = new URL(
      providers
        .microsoft(deps())
        .authorizationUrl({ ...credentials, config: { tenant: "contoso" } }, request),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/contoso/oauth2/v2.0/authorize",
    );
  });

  it("defaults Microsoft to the endpoint that accepts both account kinds", () => {
    const url = new URL(providers.microsoft(deps()).authorizationUrl(credentials, request));
    expect(url.pathname.startsWith("/common/")).toBe(true);
  });
});

/**
 * Drives a whole callback with scripted answers, which is the only way to reach a profile
 * mapping: `fetchProfile` runs inside the inherited ordering and no adapter exposes it.
 *
 * The mapping is worth the setup. `emailVerified` is the field that decides whether a social
 * sign-in may take over an existing account on the same address (PROJECT.md 4.6), so a
 * provider that reports true without the provider having said so is an account takeover.
 */
function completing(answers: readonly { status: number; data: unknown }[]): {
  deps: OAuthProviderDependencies;
  requests: {
    url: string;
    headers?: Record<string, string>;
    form?: Record<string, string>;
  }[];
  callbackFor: (provider: string) => {
    provider: string;
    state: string;
    code: string;
    callbackUri: string;
  };
} {
  let next = 0;
  const requests: {
    url: string;
    headers?: Record<string, string>;
    form?: Record<string, string>;
  }[] = [];
  const flow = {
    id: "flow-1",
    provider: "any",
    codeVerifier: "v".repeat(64),
    nonce: null,
    clientCodeChallenge: null,
    redirectUri: "https://app.test/finish",
    linkUserId: null,
    expiresAt: new Date("2026-01-01T00:10:00Z"),
  };
  return {
    requests,
    deps: {
      http: {
        json: (request: (typeof requests)[number]) => {
          requests.push(request);
          const answer = answers[next] ?? { status: 500, data: {} };
          next += 1;
          return Promise.resolve(answer);
        },
      } as never,
      clock: {
        now: () => new Date("2026-01-01T00:00:00Z"),
        nowMs: () => Date.parse("2026-01-01T00:00:00Z"),
        inSeconds: (seconds: number) =>
          new Date(Date.parse("2026-01-01T00:00:00Z") + seconds * 1000),
      } as never,
      flows: { start: () => Promise.resolve(""), consume: () => Promise.resolve(flow) },
      allowlist: { isAllowed: () => Promise.resolve(true) },
    },
    callbackFor: (provider) => ({
      provider,
      state: "state-value",
      code: "code-value",
      callbackUri: "https://auth.test/cb",
    }),
  };
}

const GRANT = { status: 200, data: { access_token: "provider-access-token" } };

describe("profile mapping", () => {
  it("reports a Discord address as confirmed only when Discord says it is", async () => {
    const user = { id: "9001", username: "ada", global_name: "Ada", email: "ada@example.test" };
    for (const [verified, expected] of [
      [true, true],
      [false, false],
      [undefined, false],
    ] as const) {
      const script = completing([GRANT, { status: 200, data: { ...user, verified } }]);
      const provider = providers.discord(script.deps);

      const { profile } = await provider.completeFlow(
        "project",
        credentials,
        script.callbackFor(provider.id),
      );

      expect(profile.emailVerified).toBe(expected);
      expect(profile.providerUserId).toBe("9001");
      expect(profile.displayName).toBe("Ada");
    }
  });

  /** A username is changeable and reusable; an account keyed on one can be taken over. */
  it("keys a Discord identity on the snowflake and not the username", async () => {
    const script = completing([
      GRANT,
      { status: 200, data: { id: "9001", username: "ada", verified: true } },
    ]);
    const provider = providers.discord(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.providerUserId).toBe("9001");
    expect(profile.emailVerified).toBe(false);
  });

  /**
   * X takes HTTP Basic client authentication and RFC 6749 forbids presenting credentials
   * two ways at once, so the secret has to leave the form when it enters the header.
   */
  it("authenticates to X in the header, and only in the header", async () => {
    const script = completing([
      GRANT,
      { status: 200, data: { data: { id: "5", name: "Ada", username: "ada" } } },
    ]);
    const provider = providers.x(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    const token = script.requests[0];
    expect(token?.headers?.["authorization"]).toBe(
      `Basic ${Buffer.from("client-id:secret").toString("base64")}`,
    );
    expect(token?.form?.["client_secret"]).toBeUndefined();
    expect(token?.form?.["code_verifier"]).toBe("v".repeat(64));
    // X releases no address, so nothing here can be linked to an existing account.
    expect(profile.email).toBeNull();
    expect(profile.providerUserId).toBe("5");
  });

  /** Helix answers with a one-element array, and wants the client id in a header of its own. */
  it("reads the Twitch profile out of the array Helix answers with", async () => {
    const script = completing([
      GRANT,
      {
        status: 200,
        data: {
          data: [{ id: "77", login: "ada", display_name: "Ada", email: "ada@example.test" }],
        },
      },
    ]);
    const provider = providers.twitch(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.providerUserId).toBe("77");
    expect(profile.displayName).toBe("Ada");
    expect(profile.emailVerified).toBe(false);
  });

  /**
   * Facebook confirms addresses in practice and asserts nothing about it in the payload.
   * An assumption is not an assertion, so this one links nothing.
   */
  it("never reports a Facebook address as confirmed", async () => {
    const script = completing([
      GRANT,
      { status: 200, data: { id: "42", name: "Ada", email: "ada@example.test" } },
    ]);
    const provider = providers.facebook(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.email).toBe("ada@example.test");
    expect(profile.emailVerified).toBe(false);
  });
});
