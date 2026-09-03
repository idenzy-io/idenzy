import type { ProviderCredentials } from "@idenzy/domain/ports/oauth-provider";
import {
  OAuthProviderConformanceSuite,
  type OAuthProviderDependencies,
} from "@idenzy/testing/oauth-provider-conformance";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleProvider } from "../src/providers/apple-provider.js";
import { BitbucketProvider } from "../src/providers/bitbucket-provider.js";
import { DiscordProvider } from "../src/providers/discord-provider.js";
import { FacebookProvider } from "../src/providers/facebook-provider.js";
import { FigmaProvider } from "../src/providers/figma-provider.js";
import { GithubProvider } from "../src/providers/github-provider.js";
import { GitlabProvider } from "../src/providers/gitlab-provider.js";
import { GoogleProvider } from "../src/providers/google-provider.js";
import { KakaoProvider } from "../src/providers/kakao-provider.js";
import { LineProvider } from "../src/providers/line-provider.js";
import { LinkedinProvider } from "../src/providers/linkedin-provider.js";
import { MicrosoftProvider } from "../src/providers/microsoft-provider.js";
import { NotionProvider } from "../src/providers/notion-provider.js";
import { SlackProvider } from "../src/providers/slack-provider.js";
import { SpotifyProvider } from "../src/providers/spotify-provider.js";
import { TwitchProvider } from "../src/providers/twitch-provider.js";
import { XProvider } from "../src/providers/x-provider.js";
import { ZoomProvider } from "../src/providers/zoom-provider.js";

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
  gitlab: (d: OAuthProviderDependencies) =>
    new GitlabProvider(d.http, d.clock, d.flows, d.allowlist),
  bitbucket: (d: OAuthProviderDependencies) =>
    new BitbucketProvider(d.http, d.clock, d.flows, d.allowlist),
  slack: (d: OAuthProviderDependencies) => new SlackProvider(d.http, d.clock, d.flows, d.allowlist),
  spotify: (d: OAuthProviderDependencies) =>
    new SpotifyProvider(d.http, d.clock, d.flows, d.allowlist),
  figma: (d: OAuthProviderDependencies) => new FigmaProvider(d.http, d.clock, d.flows, d.allowlist),
  zoom: (d: OAuthProviderDependencies) => new ZoomProvider(d.http, d.clock, d.flows, d.allowlist),
  kakao: (d: OAuthProviderDependencies) => new KakaoProvider(d.http, d.clock, d.flows, d.allowlist),
  line: (d: OAuthProviderDependencies) => new LineProvider(d.http, d.clock, d.flows, d.allowlist),
  notion: (d: OAuthProviderDependencies) =>
    new NotionProvider(d.http, d.clock, d.flows, d.allowlist),
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

  it("sends GitLab to gitlab.com when a project configured no instance of its own", () => {
    const url = new URL(providers.gitlab(deps()).authorizationUrl(credentials, request));
    expect(url.origin + url.pathname).toBe("https://gitlab.com/oauth/authorize");
  });

  it("sends GitLab to the self-managed instance a project configured", () => {
    const url = new URL(
      providers
        .gitlab(deps())
        .authorizationUrl(
          { ...credentials, config: { instance: "https://git.contoso.test/" } },
          request,
        ),
    );
    expect(url.origin + url.pathname).toBe("https://git.contoso.test/oauth/authorize");
  });

  /**
   * The instance is the host a client secret is posted to. A value that is not plainly an
   * https origin is refused rather than called, which is the difference between a
   * misconfiguration and an outbound request somebody else chose the target of.
   */
  it("refuses a GitLab instance that is not an https url", () => {
    for (const instance of [
      "http://git.contoso.test",
      "https://a:b@git.contoso.test",
      "not-a-url",
    ]) {
      expect(() =>
        providers
          .gitlab(deps())
          .authorizationUrl({ ...credentials, config: { instance } }, request),
      ).toThrow();
    }
  });

  it("asks Bitbucket for the account and the address, which live behind separate scopes", () => {
    const url = new URL(providers.bitbucket(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("account email");
  });

  it("asks Slack for an id_token, and binds it to the flow with a nonce", () => {
    const url = new URL(providers.slack(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("nonce")).toBe("n");
  });

  /**
   * LINE sends the browser to one host and issues the token from another, so the issuer is
   * not the host we call. Getting that backwards rejects every real sign-in.
   */
  it("sends LINE's browser to the host that issues its assertions", () => {
    const url = new URL(providers.line(deps()).authorizationUrl(credentials, request));
    expect(url.origin).toBe("https://access.line.me");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
  });

  /**
   * Notion has no scopes: capabilities belong to the integration. An empty `scope` reads as
   * a request for none rather than as the absence of the parameter, so it is dropped, and
   * `owner=user` is what asks a person to authorize rather than a workspace.
   */
  it("asks Notion for a person's authorization, and sends it no scope at all", () => {
    const url = new URL(providers.notion(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  /** Signing somebody in should not ask them for their files. */
  it("asks Figma only for the scope its profile call needs", () => {
    const url = new URL(providers.figma(deps()).authorizationUrl(credentials, request));
    expect(url.searchParams.get("scope")).toBe("current_user:read");
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
    json?: Record<string, string>;
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
    json?: Record<string, string>;
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

  /** The user resource carries no address, so the confirmed one comes from a second call. */
  it("takes the Bitbucket address from the primary confirmed entry, and keys on the uuid", async () => {
    const script = completing([
      GRANT,
      {
        status: 200,
        data: {
          uuid: "{9a1b-uuid}",
          nickname: "ada",
          display_name: "Ada",
          links: { avatar: { href: "https://avatars.test/ada" } },
        },
      },
      {
        status: 200,
        data: {
          values: [
            { email: "old@example.test", is_primary: false, is_confirmed: true },
            { email: "ada@example.test", is_primary: true, is_confirmed: true },
          ],
        },
      },
    ]);
    const provider = providers.bitbucket(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    // Basic client authentication, which the base owns: the secret is in the header and
    // nowhere else, because RFC 6749 refuses both at once.
    expect(script.requests[0]?.headers?.["authorization"]).toBe(
      `Basic ${Buffer.from("client-id:secret").toString("base64")}`,
    );
    expect(script.requests[0]?.form?.["client_secret"]).toBeUndefined();
    expect(profile.providerUserId).toBe("{9a1b-uuid}");
    expect(profile.email).toBe("ada@example.test");
    expect(profile.emailVerified).toBe(true);
    expect(profile.displayName).toBe("Ada");
  });

  /**
   * Three providers take basic client authentication, and the base owns both halves of it:
   * the secret goes in the header and leaves the form, because RFC 6749 refuses both at
   * once and a provider that gets both may accept it or may not.
   */
  it.each(["spotify", "figma", "zoom"] as const)(
    "authenticates to %s in the header, and only in the header",
    async (name) => {
      const script = completing([GRANT, { status: 200, data: { id: "1" } }]);
      const provider = providers[name](script.deps);

      await provider.completeFlow("project", credentials, script.callbackFor(provider.id));

      expect(script.requests[0]?.headers?.["authorization"]).toBe(
        `Basic ${Buffer.from("client-id:secret").toString("base64")}`,
      );
      expect(script.requests[0]?.form?.["client_secret"]).toBeUndefined();
      expect(script.requests[0]?.form?.["code_verifier"]).toBe("v".repeat(64));
    },
  );

  /** Spotify's own reference says the address it hands over is unproven. */
  it("never reports a Spotify address as confirmed", async () => {
    const script = completing([
      GRANT,
      {
        status: 200,
        data: {
          id: "adalovelace",
          display_name: "Ada",
          email: "ada@example.test",
          images: [{ url: "https://avatars.test/ada" }],
        },
      },
    ]);
    const provider = providers.spotify(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.email).toBe("ada@example.test");
    expect(profile.emailVerified).toBe(false);
    expect(profile.avatarUrl).toBe("https://avatars.test/ada");
  });

  /** Zoom reports confirmation as 1 or 0, so anything truthy is not good enough. */
  it("reads Zoom's confirmation flag as the number it is", async () => {
    for (const [verified, expected] of [
      [1, true],
      [0, false],
      ["1", false],
      [undefined, false],
    ] as const) {
      const script = completing([
        GRANT,
        {
          status: 200,
          data: { id: "z-1", email: "ada@example.test", first_name: "Ada", verified },
        },
      ]);
      const provider = providers.zoom(script.deps);

      const { profile } = await provider.completeFlow(
        "project",
        credentials,
        script.callbackFor(provider.id),
      );

      expect(profile.emailVerified).toBe(expected);
      expect(profile.displayName).toBe("Ada");
    }
  });

  /**
   * Kakao states verification in two fields, and `is_email_valid` is the one that goes
   * false when the address has moved to another Kakao account. Reading only the other
   * would link an existing account on an address that now belongs to somebody else.
   */
  it("takes a Kakao address as confirmed only when both of its flags say so", async () => {
    for (const [valid, verified, expected] of [
      [true, true, true],
      [false, true, false],
      [true, false, false],
      [undefined, undefined, false],
    ] as const) {
      const script = completing([
        GRANT,
        {
          status: 200,
          data: {
            id: 4815162342,
            kakao_account: {
              email: "ada@example.test",
              is_email_valid: valid,
              is_email_verified: verified,
              profile: { nickname: "Ada" },
            },
          },
        },
      ]);
      const provider = providers.kakao(script.deps);

      const { profile } = await provider.completeFlow(
        "project",
        credentials,
        script.callbackFor(provider.id),
      );

      expect(profile.emailVerified).toBe(expected);
      expect(profile.providerUserId).toBe("4815162342");
      expect(profile.displayName).toBe("Ada");
    }
  });

  /** Every Kakao field is behind consent the user can decline. */
  it("signs a Kakao user in who consented to nothing but the sign-in", async () => {
    const script = completing([GRANT, { status: 200, data: { id: 7 } }]);
    const provider = providers.kakao(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.providerUserId).toBe("7");
    expect(profile.email).toBeNull();
    expect(profile.emailVerified).toBe(false);
  });

  /**
   * Notion's token endpoint takes JSON, and the profile arrives in its answer. `/v1/users/me`
   * would describe the integration's bot instead, which would key every user of one
   * integration on one subject and hand them all the same account.
   */
  it("reads the Notion profile out of the token response, which is posted as json", async () => {
    const script = completing([
      {
        status: 200,
        data: {
          access_token: "provider-access-token",
          workspace_id: "w-1",
          owner: {
            type: "user",
            user: {
              id: "u-9001",
              name: "Ada",
              avatar_url: "https://avatars.test/ada",
              person: { email: "ada@example.test" },
            },
          },
        },
      },
    ]);
    const provider = providers.notion(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(script.requests).toHaveLength(1);
    expect(script.requests[0]?.form).toBeUndefined();
    expect(script.requests[0]?.json?.["code_verifier"]).toBe("v".repeat(64));
    expect(script.requests[0]?.headers?.["authorization"]).toBe(
      `Basic ${Buffer.from("client-id:secret").toString("base64")}`,
    );
    expect(profile.providerUserId).toBe("u-9001");
    expect(profile.email).toBe("ada@example.test");
    expect(profile.emailVerified).toBe(false);
    expect(profile.displayName).toBe("Ada");
  });

  /** A workspace-owned grant names a bot, and there is nobody in it to sign in. */
  it("refuses a Notion grant whose owner is not a person", async () => {
    const script = completing([
      {
        status: 200,
        data: { access_token: "t", owner: { type: "workspace", workspace: true } },
      },
    ]);
    const provider = providers.notion(script.deps);

    await expect(
      provider.completeFlow("project", credentials, script.callbackFor(provider.id)),
    ).rejects.toMatchObject({ code: "oauth_provider_error" });
  });

  /** An unconfirmed address is the same as no address: nothing may be linked on one. */
  it("signs a Bitbucket user in with no address rather than an unconfirmed one", async () => {
    const script = completing([
      GRANT,
      { status: 200, data: { uuid: "{9a1b-uuid}", display_name: "Ada" } },
      {
        status: 200,
        data: { values: [{ email: "ada@example.test", is_primary: true, is_confirmed: false }] },
      },
    ]);
    const provider = providers.bitbucket(script.deps);

    const { profile } = await provider.completeFlow(
      "project",
      credentials,
      script.callbackFor(provider.id),
    );

    expect(profile.email).toBeNull();
    expect(profile.emailVerified).toBe(false);
  });
});

/**
 * A real signed id_token, verified through the real JWKS path.
 *
 * The OIDC providers map their profile out of claims the base has already verified, and
 * `fetchProfile` refuses claims it did not verify itself, so there is no way in but a
 * signature that checks out. That is the right price: the mapping under test is only
 * reachable in production behind the same four checks.
 */
async function signing(): Promise<(claims: Record<string, unknown>) => Promise<string>> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  return (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setAudience("client-id")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
}

describe("slack", () => {
  const TEAM = "https://slack.com/team_id";
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const complete = async (claims: Record<string, unknown>) => {
    const idToken = await signing();
    const script = completing([
      { status: 200, data: { ok: true, access_token: "at", id_token: await idToken(claims) } },
    ]);
    const provider = providers.slack(script.deps);
    return provider.completeFlow("project", credentials, script.callbackFor(provider.id));
  };

  /**
   * A Slack member id is unique inside one workspace and not across two, so an account
   * keyed on `sub` alone would be handed to whichever stranger in another workspace holds
   * the same id next.
   */
  it("keys a Slack identity on the workspace as well as the member", async () => {
    const { profile } = await complete({
      iss: "https://slack.com",
      sub: "U0123",
      [TEAM]: "T0777",
      name: "Ada",
      email: "ada@example.test",
      email_verified: true,
      picture: "https://avatars.test/ada",
    });

    expect(profile.providerUserId).toBe("T0777:U0123");
    expect(profile.email).toBe("ada@example.test");
    expect(profile.emailVerified).toBe(true);
  });

  it("refuses an assertion that names no workspace, rather than keying on the member alone", async () => {
    await expect(
      complete({ iss: "https://slack.com", sub: "U0123", email: "ada@example.test" }),
    ).rejects.toMatchObject({ code: "oauth_provider_error" });
  });

  it("refuses an assertion signed for another issuer", async () => {
    await expect(
      complete({ iss: "https://slack.example.test", sub: "U0123", [TEAM]: "T0777" }),
    ).rejects.toMatchObject({ code: "oauth_provider_error" });
  });

  /** Slack is a Web API method in OAuth clothing: it reports failure with a 200 body. */
  it("refuses a Slack token response that answers 200 with ok:false", async () => {
    const script = completing([{ status: 200, data: { ok: false, error: "invalid_code" } }]);
    const provider = providers.slack(script.deps);

    await expect(
      provider.completeFlow("project", credentials, script.callbackFor(provider.id)),
    ).rejects.toMatchObject({ code: "oauth_provider_error" });
  });
});
