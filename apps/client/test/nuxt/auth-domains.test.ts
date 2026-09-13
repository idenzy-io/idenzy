import type { ProjectDomain } from "@idenzy/protocol/schemas/management";
import { describe, expect, it } from "vitest";
import {
  AUTH_DOMAIN_CAPABILITIES,
  AUTH_DOMAIN_STATUS_LABELS,
  AUTH_RECORD_INFO,
  AUTH_RECORD_KINDS,
  type AuthDnsRecord,
  type AuthDomain,
  apiBaseUrl,
  authDomainFrom,
  authNextStep,
  authSetupStage,
  cookieModeState,
  DOMAIN_ISSUE_LABELS,
  effectiveHost,
  headerModeState,
  liveDomain,
  normalizeDomain,
  SHARED_API_HOST,
  setupProbe,
  siteOf,
  validateDomain,
} from "../../app/utils/auth-domains";

/**
 * The two records as the server mints them, written out rather than computed.
 *
 * The values are the management API's to choose and the panel's only to display, so a
 * fixture here spells them the way a response does. A helper that built them would be the
 * panel deciding what our own load balancer is called, which is the duplication that went
 * when these screens stopped inventing rows.
 */
function records(): AuthDnsRecord[] {
  return [
    { kind: "cname", name: "auth.example.com", value: "edge.idenzy.io", status: "pending" },
    {
      kind: "cert",
      name: "_acme-challenge.auth.example.com",
      value: "9f2c41a8.authorize.certificatemanager.goog",
      status: "pending",
    },
  ];
}

function domain(change: Partial<AuthDomain> = {}): AuthDomain {
  return {
    id: "dom_1",
    domain: "auth.example.com",
    status: "verified",
    records: records(),
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
    expect(validateDomain("x.api.idenzy.io", [])).toBe("ours");
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

describe("the records", () => {
  it("describes each kind, including what removing it later costs", () => {
    for (const info of AUTH_RECORD_KINDS) {
      expect(info.purpose.length).toBeGreaterThan(0);
      expect(info.afterwards.length).toBeGreaterThan(0);
      expect(AUTH_RECORD_INFO[info.kind]).toBe(info);
    }
  });
});

/*
 * The boundary between the API's vocabulary and this screen's, which is one word wide.
 */
describe("authDomainFrom", () => {
  const row: ProjectDomain = {
    id: "dom_9",
    domain: "auth.example.com",
    type: "auth",
    status: "pending",
    records: records(),
    checkedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("calls a pending domain verifying, which is the word both domain screens use", () => {
    expect(authDomainFrom(row).status).toBe("verifying");
  });

  it("leaves the other two alone, since they are the same word either side", () => {
    expect(authDomainFrom({ ...row, status: "verified" }).status).toBe("verified");
    expect(authDomainFrom({ ...row, status: "failed" }).status).toBe("failed");
  });

  it("carries the server's records across rather than minting any of its own", () => {
    expect(authDomainFrom(row).records).toEqual(records());
  });

  it("keeps the id and the timestamps the row arrived with", () => {
    const checked = authDomainFrom({ ...row, checkedAt: "2026-09-02T08:00:00.000Z" });
    expect(checked.id).toBe("dom_9");
    expect(checked.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(checked.checkedAt).toBe("2026-09-02T08:00:00.000Z");
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

function found(change: Partial<AuthDomain> = {}): AuthDomain {
  const base = domain(change);
  return { ...base, records: base.records.map((record) => ({ ...record, status: "found" })) };
}

describe("apiBaseUrl", () => {
  it("is the one derivation every copyable endpoint is built from", () => {
    expect(apiBaseUrl(SHARED_API_HOST)).toBe(`https://${SHARED_API_HOST}`);
    expect(apiBaseUrl("auth.example.com")).toBe("https://auth.example.com");
  });
});

describe("cookieModeState", () => {
  it("calls the shared host a setup rather than a refusal, and offers the way in", () => {
    const state = cookieModeState([]);
    expect(state.state).toBe("setup");
    expect(state.label).toBe("Requires a custom domain");
    expect(state.action).toBe("Add a domain");
    expect(state.detail).not.toMatch(/refused/i);
  });

  it("reserves the unhappy words for a domain that was added and did not verify", () => {
    expect(cookieModeState([domain({ status: "failed" })]).state).toBe("failed");
    expect(cookieModeState([domain({ status: "verifying" })]).state).toBe("pending");
  });

  it("is ready on a verified domain, and names the site the cookie works across", () => {
    const state = cookieModeState([domain()]);
    expect(state.state).toBe("ready");
    expect(state.action).toBeNull();
    expect(state.detail).toContain("example.com");
  });

  it("never says header mode is off, because it is not", () => {
    expect(headerModeState().state).toBe("available");
    expect(headerModeState().action).toBeNull();
  });
});

describe("authSetupStage", () => {
  it("waits on the CNAME before anything else", () => {
    expect(authSetupStage(domain({ status: "verifying" }), false)).toBe("dns");
  });

  it("waits on the certificate once the name resolves", () => {
    const half = domain({ status: "verifying" });
    half.records = half.records.map((record) =>
      record.kind === "cname" ? { ...record, status: "found" as const } : record,
    );
    expect(authSetupStage(half, false)).toBe("certificate");
  });

  it("stops at the SDK on a verified domain, because a deployment is not ours to see", () => {
    expect(authSetupStage(found(), false)).toBe("sdk");
  });

  it("reaches the test only once one has been run", () => {
    expect(authSetupStage(found(), true)).toBe("test");
  });

  it("never promises a deployed client, whatever step it is on", () => {
    expect(authNextStep(found(), false)).toMatch(/nothing about a deployed application/i);
    expect(authNextStep(found(), true)).toMatch(/cannot see is your own build/i);
  });
});

describe("setupProbe", () => {
  it("reports the three things it can see and the one it cannot finish", () => {
    const probe = setupProbe(found(), "https://app.example.com", true);
    expect(probe.ok).toBe(true);
    expect(probe.lines.map((line) => line.ok)).toEqual([true, true, true, true]);
    expect(probe.lines[3]?.detail).toMatch(/not something this check can see/i);
  });

  it("fails the origin line where the origin is not on the CORS allowlist", () => {
    const probe = setupProbe(found(), "https://elsewhere.example", false);
    expect(probe.ok).toBe(false);
    expect(probe.lines[3]?.ok).toBe(false);
  });

  it("asks for an origin rather than passing without one", () => {
    const probe = setupProbe(found(), "", false);
    expect(probe.ok).toBe(false);
    expect(probe.lines[3]?.label).toBe("An application origin to test");
  });

  it("says a pending host is refused as an unknown project, not as nearly ready", () => {
    const probe = setupProbe(domain({ status: "verifying" }), "", false);
    expect(probe.lines[0]?.ok).toBe(false);
    expect(probe.lines[2]?.detail).toMatch(/unknown project/i);
  });

  it("answers for no domain at all rather than throwing", () => {
    expect(setupProbe(null, "", false).ok).toBe(false);
  });

  /* A resolved authorisation record is not an issued certificate: Certificate Manager issues
     off that record and nothing here watches it do so. A line claiming a served certificate
     would be the screen promising something no DNS check establishes. */
  it("claims an authorised certificate and never a served one", () => {
    const line = setupProbe(found(), "https://app.example.com", true).lines[1];
    expect(line?.label).toBe("The certificate is authorised");
    expect(line?.detail).toMatch(/authorisation record resolves/i);
    expect(line?.detail).not.toMatch(/handshake|is answered rather than refused/i);
  });
});
