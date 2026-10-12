import { describe, expect, it } from "vitest";
import {
  callbackShape,
  callbackUri,
  draftFrom,
  evaluateProviderSetup,
  isHttpsOrigin,
  issueFor,
  linkingExamples,
  missingFor,
  normaliseInstance,
  PROVIDERS,
  type ProviderConfig,
  type ProviderDraft,
  parseScopes,
  providerBlockers,
  providerInfo,
  readinessOf,
  returnUriIssue,
  returnUrisMissingOrigin,
  scopesOf,
  validateProvider,
} from "../../app/utils/providers";
import type { SetupCheck } from "../../app/utils/setup-check";

const google = providerInfo("google");
const apple = providerInfo("apple");
const gitlab = providerInfo("gitlab");
const microsoft = providerInfo("microsoft");
const notion = providerInfo("notion");

function draft(over: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    mode: "custom",
    clientId: "client-id",
    clientSecret: "shhh",
    scopes: "",
    customScopes: false,
    settings: {},
    storeTokens: false,
    ...over,
  };
}

describe("the catalogue", () => {
  it("holds the eighteen adapters plus the connector that is not built", () => {
    expect(PROVIDERS).toHaveLength(19);
    expect(PROVIDERS.filter((provider) => provider.available)).toHaveLength(18);
    expect(providerInfo("oidc").available).toBe(false);
  });

  it("says which providers assert a verified address, because that is what joins accounts", () => {
    const asserts = PROVIDERS.filter(
      (provider) => provider.available && provider.email === "asserts",
    );
    // Ten state it and eight do not. The eight report unverified rather than assume.
    expect(asserts).toHaveLength(10);
    expect(asserts.map((provider) => provider.id)).toContain("google");
    expect(providerInfo("microsoft").email).toBe("silent");
    expect(providerInfo("spotify").email).toBe("denies");
    expect(providerInfo("x").email).toBe("none");
  });
});

describe("scopesOf", () => {
  const config: ProviderConfig = {
    enabled: true,
    mode: "custom",
    clientId: "id",
    secretSet: true,
    secretUpdatedAt: null,
    scopes: [],
    settings: {},
    storeTokens: false,
    testedAt: null,
  };

  it("falls back to the provider's own list where the project chose none", () => {
    expect(scopesOf(google, config)).toEqual(["openid", "email", "profile"]);
    expect(scopesOf(notion, config)).toEqual([]);
  });

  it("takes the project's list whole where it has one", () => {
    expect(scopesOf(google, { ...config, scopes: ["openid"] })).toEqual(["openid"]);
  });
});

describe("parseScopes", () => {
  it("splits on whitespace and commas and keeps each scope once", () => {
    expect(parseScopes("openid email  profile")).toEqual(["openid", "email", "profile"]);
    expect(parseScopes("openid, email,profile")).toEqual(["openid", "email", "profile"]);
    expect(parseScopes(" openid openid ")).toEqual(["openid"]);
    expect(parseScopes("")).toEqual([]);
  });
});

describe("isHttpsOrigin", () => {
  it("takes an https origin and nothing that could smuggle a second target past it", () => {
    expect(isHttpsOrigin("https://gitlab.example.com")).toBe(true);
    expect(isHttpsOrigin("http://gitlab.example.com")).toBe(false);
    expect(isHttpsOrigin("https://user:pass@gitlab.example.com")).toBe(false);
    expect(isHttpsOrigin("https://gitlab.example.com?next=https://evil.example")).toBe(false);
    expect(isHttpsOrigin("gitlab.example.com")).toBe(false);
  });

  it("normalises to origin and path without a trailing slash", () => {
    expect(normaliseInstance("https://gitlab.example.com/")).toBe("https://gitlab.example.com");
    expect(normaliseInstance("https://example.com/gitlab/")).toBe("https://example.com/gitlab");
  });
});

describe("validateProvider", () => {
  it("wants a client id and a secret where neither is stored", () => {
    const issues = validateProvider(google, draft({ clientId: "", clientSecret: "" }), false);
    expect(issues.map((issue) => issue.field)).toEqual(["clientId", "clientSecret"]);
  });

  it("takes a blank secret as keeping the stored one", () => {
    expect(validateProvider(google, draft({ clientSecret: "" }), true)).toEqual([]);
    expect(validateProvider(google, draft({ clientSecret: "" }), false)).toHaveLength(1);
  });

  it("checks nothing in instant mode, where the credentials are ours", () => {
    const empty = draft({ mode: "instant", clientId: "", clientSecret: "" });
    expect(validateProvider(apple, empty, false)).toEqual([]);
  });

  it("demands Apple's team and key ids, and a key that looks like one", () => {
    const missing = validateProvider(apple, draft({ clientSecret: "" }), true);
    expect(missing.map((issue) => issue.field)).toEqual(["teamId", "keyId"]);

    const badKey = validateProvider(
      apple,
      draft({ clientSecret: "not-a-key", settings: { teamId: "A", keyId: "B" } }),
      true,
    );
    expect(badKey).toEqual([{ field: "clientSecret", code: "signing_key_invalid" }]);
  });

  it("refuses a GitLab instance that is not plainly an https origin", () => {
    const issues = validateProvider(
      gitlab,
      draft({ settings: { instance: "http://gitlab.example.com" } }),
      true,
    );
    expect(issues).toEqual([{ field: "instance", code: "instance_invalid" }]);
    expect(validateProvider(gitlab, draft({ settings: { instance: "" } }), true)).toEqual([]);
  });

  it("takes Microsoft's three keywords and a directory id, and nothing else", () => {
    for (const tenant of ["common", "organizations", "consumers", "contoso.onmicrosoft.com"]) {
      expect(validateProvider(microsoft, draft({ settings: { tenant } }), true)).toEqual([]);
    }
    expect(
      validateProvider(microsoft, draft({ settings: { tenant: "not a tenant" } }), true),
    ).toEqual([{ field: "tenant", code: "tenant_invalid" }]);
  });

  it("names the field's own reason where it has one", () => {
    const issues = validateProvider(apple, draft({ clientSecret: "" }), true);
    expect(issueFor(apple, issues, "teamId")).toBe("Apple's ten-character Team ID.");
    expect(issueFor(apple, issues, "clientId")).toBe("");
  });
});

describe("draftFrom", () => {
  it("opens empty for a provider with no configuration", () => {
    expect(draftFrom(google, null)).toEqual({
      mode: "custom",
      clientId: "",
      clientSecret: "",
      scopes: "",
      customScopes: false,
      settings: { nativeAudiences: "" },
      storeTokens: false,
    });
  });

  it("carries the saved record over, with the secret left out of it", () => {
    const opened = draftFrom(apple, {
      enabled: true,
      mode: "custom",
      clientId: "com.example.web",
      secretSet: true,
      secretUpdatedAt: "2026-08-28T11:05:00.000Z",
      scopes: ["openid", "email"],
      settings: { teamId: "9QJ4TZ2P8L", keyId: "K7D2M4XR9V" },
      storeTokens: true,
      testedAt: null,
    });
    expect(opened.clientSecret).toBe("");
    expect(opened.customScopes).toBe(true);
    expect(opened.scopes).toBe("openid email");
    expect(opened.settings).toEqual({
      teamId: "9QJ4TZ2P8L",
      keyId: "K7D2M4XR9V",
      nativeAudiences: "",
    });
  });
});

describe("callbackUri", () => {
  it("is ours, per provider, and survives a base with a trailing slash", () => {
    expect(callbackUri("https://api.idenzy.io", "google")).toBe(
      "https://api.idenzy.io/v1/auth/oauth/google/callback",
    );
    expect(callbackUri("https://auth.customer.com/", "apple")).toBe(
      "https://auth.customer.com/v1/auth/oauth/apple/callback",
    );
    expect(callbackShape("https://api.idenzy.io")).toBe(
      "https://api.idenzy.io/v1/auth/oauth/{provider}/callback",
    );
  });
});

describe("readinessOf", () => {
  const complete: ProviderConfig = {
    enabled: true,
    mode: "custom",
    clientId: "id",
    secretSet: true,
    secretUpdatedAt: null,
    scopes: [],
    settings: {},
    storeTokens: false,
    testedAt: null,
  };

  it("leads with a gap, because turning on a provider that cannot exchange changes nothing", () => {
    expect(readinessOf(google, { ...complete, secretSet: false })).toBe("incomplete");
    // Off as well as incomplete: the gap still leads, because switching it on does not help.
    expect(readinessOf(google, { ...complete, secretSet: false, enabled: false })).toBe(
      "incomplete",
    );
  });

  it("puts a deliberate off before a restricted on", () => {
    expect(readinessOf(google, { ...complete, enabled: false })).toBe("off");
    expect(readinessOf(google, { ...complete, enabled: false, mode: "instant" })).toBe("off");
  });

  it("calls our shared app development only, whatever else is right", () => {
    const instant = { ...complete, mode: "instant" as const, clientId: "", secretSet: false };
    expect(readinessOf(google, instant)).toBe("development");
  });

  it("does not call a provider ready until a sign-in has been through it", () => {
    expect(readinessOf(google, complete)).toBe("untested");
    expect(readinessOf(google, { ...complete, testedAt: "2026-09-08T08:41:00.000Z" })).toBe(
      "ready",
    );
  });

  it("counts a required provider field as missing and an optional one as not", () => {
    // Apple needs its team and key ids; Microsoft's directory falls back to a default.
    expect(missingFor(apple, complete)).toEqual(["Team ID", "Key ID"]);
    expect(missingFor(microsoft, complete)).toEqual([]);
    // Instant mode carries our credentials, so there is nothing for a project to miss.
    expect(missingFor(apple, { ...complete, mode: "instant", secretSet: false })).toEqual([]);
  });
});

describe("returnUriIssue", () => {
  it("takes the whole URL and refuses what a redirect cannot be", () => {
    expect(returnUriIssue("https://app.example.com/auth/callback", [])).toBe("");
    expect(returnUriIssue("myapp://auth", [])).toBe("");
    expect(returnUriIssue("http://app.example.com/auth", [])).not.toBe("");
    expect(returnUriIssue("https://app.example.com/auth#done", [])).not.toBe("");
    expect(returnUriIssue("https://app.example.com/auth?code=1", [])).not.toBe("");
  });

  it("says nothing about a blank field nobody has filled in yet", () => {
    expect(returnUriIssue("", [])).toBe("");
  });

  it("names a duplicate as one rather than adding a second row", () => {
    const held = ["https://app.example.com/auth/callback"];
    expect(returnUriIssue("https://app.example.com/auth/callback", held)).toBe(
      "Already registered on this project.",
    );
  });
});

describe("returnUrisMissingOrigin", () => {
  it("counts only origins the CORS allowlist could hold and does not already", () => {
    const uris = [
      "https://app.example.com/auth/callback",
      "https://app.example.com/auth/other",
      "https://portal.example.com/back",
      // A native scheme has no origin, and a loopback one the list refuses anyway.
      "myapp://auth",
      "http://localhost:3000/auth",
    ];
    expect(returnUrisMissingOrigin(uris, ["https://app.example.com"])).toEqual([
      "https://portal.example.com",
    ]);
  });
});

describe("providerBlockers", () => {
  const live = {
    info: google,
    config: {
      enabled: true,
      mode: "custom" as const,
      clientId: "id",
      secretSet: true,
      secretUpdatedAt: null,
      scopes: [],
      settings: {},
      storeTokens: false,
      testedAt: null,
    },
  };
  const returnUris = ["https://app.example.com/auth/callback"];

  it("is empty for a project with a live provider and somewhere to come back to", () => {
    expect(providerBlockers({ providers: [live], returnUris, allowedOrigins: [] })).toEqual([]);
  });

  it("names an empty project and one whose providers are all off or incomplete", () => {
    const empty = providerBlockers({ providers: [], returnUris, allowedOrigins: [] });
    expect(empty.map((blocker) => blocker.id)).toEqual(["none"]);

    const off = providerBlockers({
      providers: [{ ...live, config: { ...live.config, enabled: false } }],
      returnUris,
      allowedOrigins: [],
    });
    expect(off.map((blocker) => blocker.id)).toEqual(["nothing-live"]);
  });

  it("raises a provider that is on and incomplete, because that one fails after consent", () => {
    const broken = providerBlockers({
      providers: [{ ...live, config: { ...live.config, secretSet: false } }],
      returnUris,
      allowedOrigins: [],
    });
    // Nothing is live either, so both are said: neither replaces the other.
    expect(broken.map((blocker) => blocker.id)).toEqual(["nothing-live", "broken-google"]);
    expect(broken[1]?.detail).toContain("Client secret");
  });

  it("raises a project with nowhere to come back to, whatever its providers hold", () => {
    const blockers = providerBlockers({
      providers: [live],
      returnUris: [],
      allowedOrigins: [],
    });
    expect(blockers.map((blocker) => blocker.id)).toEqual(["return"]);
  });
});

describe("evaluateProviderSetup", () => {
  const config: ProviderConfig = {
    enabled: true,
    mode: "custom",
    clientId: "id",
    secretSet: true,
    secretUpdatedAt: null,
    scopes: [],
    settings: {},
    storeTokens: false,
    testedAt: null,
  };

  const setup = (over: Partial<Parameters<typeof evaluateProviderSetup>[0]> = {}) =>
    evaluateProviderSetup({
      providers: [{ info: google, config }],
      returnUris: ["https://app.example.com/auth/callback"],
      allowedOrigins: ["https://app.example.com"],
      ...over,
    });

  const stateOf = (checks: SetupCheck[], id: string) =>
    checks.find((check) => check.id === id)?.state;

  it("passes on a project with a live provider, a return URL and its origin allowed", () => {
    expect(setup().every((check) => check.state === "pass")).toBe(true);
  });

  it("fails, rather than warns, where nobody could start or finish a sign-in", () => {
    expect(stateOf(setup({ providers: [] }), "provider")).toBe("fail");
    expect(stateOf(setup({ returnUris: [] }), "return")).toBe("fail");
  });

  it("warns where the redirect lands and the browser then refuses the exchange", () => {
    const checks = setup({ allowedOrigins: [] });
    expect(stateOf(checks, "cors")).toBe("warn");
    expect(checks.find((check) => check.id === "cors")?.fix?.to).toBe("/domains/origins");
  });

  it("warns about our shared app, which is refused anywhere but localhost", () => {
    const checks = setup({
      providers: [{ info: google, config: { ...config, mode: "instant" } }],
    });
    expect(stateOf(checks, "instant")).toBe("warn");
  });
});

describe("linkingExamples", () => {
  it("moves only the proved address with the rule, because the other two never move", () => {
    const on = linkingExamples(true);
    const off = linkingExamples(false);
    expect(on[0]?.tone).toBe("join");
    expect(off[0]?.tone).toBe("verify");
    // An address nobody proved is never joined, and no address has nothing to join to.
    expect(on[1]?.tone).toBe("verify");
    expect(off[1]?.tone).toBe("verify");
    expect(on[2]?.tone).toBe("new");
    expect(off[2]?.tone).toBe("new");
  });

  it("names the code the SDK is given, because a customer builds their message from it", () => {
    expect(linkingExamples(true)[1]?.detail).toContain("linking_requires_verification");
  });
});
