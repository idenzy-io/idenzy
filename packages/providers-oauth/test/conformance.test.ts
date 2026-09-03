import type { ProviderCredentials } from "@idenzy/domain/ports/oauth-provider";
import {
  OAuthProviderConformanceSuite,
  type OAuthProviderDependencies,
} from "@idenzy/testing/oauth-provider-conformance";
import { describe, expect, it } from "vitest";
import { AppleProvider } from "../src/providers/apple-provider.js";
import { GithubProvider } from "../src/providers/github-provider.js";
import { GoogleProvider } from "../src/providers/google-provider.js";
import { MicrosoftProvider } from "../src/providers/microsoft-provider.js";

const providers = {
  google: (d: OAuthProviderDependencies) =>
    new GoogleProvider(d.http, d.clock, d.flows, d.allowlist),
  microsoft: (d: OAuthProviderDependencies) =>
    new MicrosoftProvider(d.http, d.clock, d.flows, d.allowlist),
  github: (d: OAuthProviderDependencies) =>
    new GithubProvider(d.http, d.clock, d.flows, d.allowlist),
  apple: (d: OAuthProviderDependencies) => new AppleProvider(d.http, d.clock, d.flows, d.allowlist),
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
