import { describe, expect, it } from "vitest";
import {
  callbackShape,
  callbackUri,
  draftFrom,
  isHttpsOrigin,
  issueFor,
  normaliseInstance,
  PROVIDERS,
  type ProviderConfig,
  type ProviderDraft,
  parseScopes,
  providerInfo,
  scopesOf,
  validateProvider,
} from "../../app/utils/providers";

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
      settings: {},
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
    });
    expect(opened.clientSecret).toBe("");
    expect(opened.customScopes).toBe(true);
    expect(opened.scopes).toBe("openid email");
    expect(opened.settings).toEqual({ teamId: "9QJ4TZ2P8L", keyId: "K7D2M4XR9V" });
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
