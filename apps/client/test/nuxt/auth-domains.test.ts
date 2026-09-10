import { describe, expect, it } from "vitest";
import {
  AUTH_DOMAIN_CAPABILITIES,
  AUTH_DOMAIN_STATUS_LABELS,
  AUTH_RECORD_INFO,
  AUTH_RECORD_KINDS,
  type AuthDomain,
  CERT_AUTH_PREFIX,
  DOMAIN_ISSUE_LABELS,
  effectiveHost,
  LOAD_BALANCER_TARGET,
  liveDomain,
  normalizeDomain,
  recordsFor,
  SHARED_API_HOST,
  siteOf,
  validateDomain,
} from "../../app/utils/auth-domains";

function domain(change: Partial<AuthDomain> = {}): AuthDomain {
  return {
    id: "dom_1",
    domain: "auth.example.com",
    status: "verified",
    records: recordsFor("auth.example.com", "tok"),
    createdAt: "2026-09-01T00:00:00.000Z",
    checkedAt: null,
    ...change,
  };
}

describe("validateDomain", () => {
  it("accepts a subdomain in a zone the customer controls", () => {
    expect(validateDomain("auth.example.com", [])).toBeNull();
    expect(validateDomain("  Auth.Example.COM ", [])).toBeNull();
    expect(validateDomain("login.eu.example.co.uk", [])).toBeNull();
  });

  /* The rule worth enforcing rather than explaining afterwards: a zone's apex cannot hold
     a CNAME, so an apex auth domain can never verify however long anybody waits. */
  it("refuses an apex, because a CNAME cannot sit at one", () => {
    expect(validateDomain("example.com", [])).toBe("apex");
    expect(validateDomain("example.io", [])).toBe("apex");
  });

  /* A plain label count reads example.co.uk as a subdomain of co.uk, which would let an
     apex through and then report the site as "co.uk" in the dialog. */
  it("refuses an apex under a multi-label suffix, which a label count would miss", () => {
    expect(validateDomain("example.co.uk", [])).toBe("apex");
    expect(validateDomain("example.com.au", [])).toBe("apex");
    expect(validateDomain("example.com.tr", [])).toBe("apex");
  });

  it("still accepts a real subdomain under one of those suffixes", () => {
    expect(validateDomain("auth.example.co.uk", [])).toBeNull();
    expect(validateDomain("auth.example.com.au", [])).toBeNull();
  });

  it("refuses a URL, since a hostname is what DNS holds", () => {
    expect(validateDomain("https://auth.example.com", [])).toBe("has_scheme");
    expect(validateDomain("auth.example.com/callback", [])).toBe("has_scheme");
  });

  it("refuses something that is not a hostname at all", () => {
    expect(validateDomain("not a domain", [])).toBe("not_a_hostname");
    expect(validateDomain("auth..example.com", [])).toBe("not_a_hostname");
  });

  it("refuses one of ours, which nobody else can put a record in", () => {
    expect(validateDomain("auth.idenzy.io", [])).toBe("ours");
    expect(validateDomain("x.api.idenzy.dev", [])).toBe("ours");
  });

  it("refuses a hostname the project already added, whatever the casing", () => {
    expect(validateDomain("auth.example.com", ["auth.example.com"])).toBe("already_added");
    expect(validateDomain("AUTH.example.com", ["auth.example.com"])).toBe("already_added");
  });

  it("asks for something before it judges nothing", () => {
    expect(validateDomain("", [])).toBe("empty");
    expect(validateDomain("   ", [])).toBe("empty");
  });

  it("names every issue it can return", () => {
    for (const issue of Object.values(DOMAIN_ISSUE_LABELS)) {
      expect(issue.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeDomain", () => {
  it("lowercases, trims and drops a trailing dot a DNS console may add", () => {
    expect(normalizeDomain("  Auth.Example.COM. ")).toBe("auth.example.com");
  });
});

/*
 * The site is why cookie mode works at all: SameSite is a site rule, so an app under the
 * same site is same-site with the auth domain and everything else is not.
 */
describe("siteOf", () => {
  it("drops the label an auth domain always has", () => {
    expect(siteOf("auth.example.com")).toBe("example.com");
    expect(siteOf("auth.example.co.uk")).toBe("example.co.uk");
  });

  it("holds for a deeper name, which is still one label below its site", () => {
    expect(siteOf("login.eu.example.com")).toBe("eu.example.com");
  });

  it("leaves a bare pair alone rather than returning nothing", () => {
    expect(siteOf("example.com")).toBe("example.com");
  });
});

describe("recordsFor", () => {
  const records = recordsFor("auth.example.com", "9f2c41a8");

  it("asks for the two records a working domain needs and no others", () => {
    expect(records.map((record) => record.kind)).toEqual(["cname", "cert"]);
  });

  it("points the hostname itself at the load balancer", () => {
    expect(records[0]?.name).toBe("auth.example.com");
    expect(records[0]?.value).toBe(LOAD_BALANCER_TARGET);
  });

  it("hangs the authorisation record off the challenge label", () => {
    expect(records[1]?.name).toBe(`${CERT_AUTH_PREFIX}.auth.example.com`);
    expect(records[1]?.value).toContain("9f2c41a8");
  });

  it("starts both pending, since nothing has been looked for yet", () => {
    expect(records.every((record) => record.status === "pending")).toBe(true);
  });

  it("describes each kind, including what removing it later costs", () => {
    for (const info of AUTH_RECORD_KINDS) {
      expect(info.purpose.length).toBeGreaterThan(0);
      expect(info.afterwards.length).toBeGreaterThan(0);
      expect(AUTH_RECORD_INFO[info.kind]).toBe(info);
    }
  });
});

describe("liveDomain and effectiveHost", () => {
  it("uses the shared host until something is actually verified", () => {
    expect(effectiveHost([])).toBe(SHARED_API_HOST);
    expect(effectiveHost([domain({ status: "verifying" })])).toBe(SHARED_API_HOST);
    expect(effectiveHost([domain({ status: "failed" })])).toBe(SHARED_API_HOST);
  });

  it("uses a verified domain once there is one", () => {
    expect(effectiveHost([domain()])).toBe("auth.example.com");
  });

  it("passes over a pending domain to find the verified one", () => {
    const rows = [domain({ id: "a", domain: "new.example.com", status: "verifying" }), domain()];
    expect(liveDomain(rows)?.domain).toBe("auth.example.com");
  });

  it("answers null where nothing is live, rather than the first row", () => {
    expect(liveDomain([domain({ status: "verifying" })])).toBeNull();
  });
});

describe("AUTH_DOMAIN_CAPABILITIES", () => {
  it("says what happens without a domain rather than that a feature is off", () => {
    for (const capability of AUTH_DOMAIN_CAPABILITIES) {
      expect(capability.with.length).toBeGreaterThan(0);
      expect(capability.without.length).toBeGreaterThan(0);
    }
  });

  it("names each once, and covers the three things a domain decides", () => {
    const ids = AUTH_DOMAIN_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["cookies", "navigation", "preflight"]);
  });

  /* The preflight has no code because the refusal is the browser's: an unregistered origin
     gets an ordinary answer with no header, never a status that tells a prober anything. */
  it("carries a code for the two refusals a caller can actually read", () => {
    const withCode = AUTH_DOMAIN_CAPABILITIES.filter((one) => one.errorCode !== null);
    expect(withCode.map((one) => one.errorCode)).toEqual([
      "session_transport_unavailable",
      "unknown_project",
    ]);
  });
});

describe("the status vocabulary", () => {
  it("matches the sending-domains screen, since both are rows of one table", () => {
    expect(Object.keys(AUTH_DOMAIN_STATUS_LABELS).sort()).toEqual([
      "failed",
      "verified",
      "verifying",
    ]);
  });
});
