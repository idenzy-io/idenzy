import { browserOriginSchema } from "@idenzy/protocol/schemas/management";
import { describe, expect, it } from "vitest";
import {
  ALLOW_ORIGIN_HEADER,
  ALLOWED_ORIGIN_ISSUE_LABELS,
  type AllowedOrigin,
  allowedOriginFrom,
  checkOrigin,
  corsSample,
  isOriginAllowed,
  OBSERVED_FIGURES,
  ORIGIN_SOURCE_FROM,
  ORIGIN_SOURCES,
  ORIGIN_TELEMETRY,
  originOf,
  SUGGESTION_GRANT,
  sortOrigins,
  suggestionsFrom,
  validateAllowedOrigin,
} from "../../app/utils/origins";

function stored(origin: string): AllowedOrigin {
  return { id: `orn_${origin.length}`, origin, addedAt: "2026-06-04T10:12:00.000Z", source: null };
}

/**
 * The panel refuses an origin while it is being typed and the API refuses it with a code, and
 * the panel's message is only better while the two agree about the rule. They share the
 * parser; this is the assertion that they also share the answer.
 */
describe("validateAllowedOrigin against the API's own schema", () => {
  const CASES = [
    "https://app.example.com",
    "https://app.example.com:8443",
    "https://app.example.com:443",
    "https://app.example.com/callback",
    "https://app.example.com?next=/x",
    "https://user:pass@app.example.com",
    "https://my_app.example.com",
    "https://*.example.com",
    "http://app.example.com",
    "https://localhost:3000",
    "http://127.0.0.1:5173",
    "myapp://callback",
    "app.example.com",
    "https://[2001:db8::1]:8443",
    "https://app.example.com:70000",
  ];

  it("accepts exactly what the management API accepts", () => {
    for (const value of CASES) {
      const bySchema = browserOriginSchema.safeParse(value).success;
      expect(validateAllowedOrigin(value, []) === null, value).toBe(bySchema);
    }
  });

  /* The panel stores what the dialog previewed, and the API canonicalises again on arrival.
     A disagreement here would put a row on the list under a spelling nobody chose. */
  it("previews the value the API would store", () => {
    for (const value of CASES) {
      const parsed = browserOriginSchema.safeParse(value);
      if (!parsed.success) continue;
      expect(isOriginAllowed(value, [parsed.data]), value).toBe(true);
    }
  });
});

describe("allowedOriginFrom", () => {
  it("reads a row as the screen's model, and claims no source for it", () => {
    const mapped = allowedOriginFrom({
      id: "orn_1",
      origin: "https://app.example.com",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect(mapped).toEqual({
      id: "orn_1",
      origin: "https://app.example.com",
      addedAt: "2026-09-01T00:00:00.000Z",
      source: null,
    });
  });
});

describe("validateAllowedOrigin", () => {
  it("takes a scheme, a host and an optional port", () => {
    expect(validateAllowedOrigin("https://app.example.com", [])).toBeNull();
    expect(validateAllowedOrigin("https://app.example.com:8443", [])).toBeNull();
  });

  it("refuses anything after the host, because the match is an exact string", () => {
    for (const value of [
      "https://app.example.com/auth",
      "https://app.example.com?a=1",
      "https://app.example.com#x",
      "app.example.com",
      "",
    ]) {
      expect(validateAllowedOrigin(value, [])).toBe("origin_invalid");
    }
  });

  it("refuses a wildcard by name rather than as a parse failure", () => {
    expect(validateAllowedOrigin("https://*.example.com", [])).toBe("origin_wildcard");
    expect(validateAllowedOrigin("*", [])).toBe("origin_wildcard");
  });

  it("refuses http, where a credentialed response is readable on the wire", () => {
    expect(validateAllowedOrigin("http://app.example.com", [])).toBe("origin_insecure");
  });

  it("refuses loopback, which the deployment allows and this list does not", () => {
    for (const value of ["http://localhost:3000", "https://localhost", "http://127.0.0.1:5173"]) {
      expect(validateAllowedOrigin(value, [])).toBe("origin_loopback");
    }
  });

  it("refuses one already on the list, however it was typed", () => {
    expect(validateAllowedOrigin("HTTPS://App.Example.com", ["https://app.example.com"])).toBe(
      "origin_duplicate",
    );
  });

  it("has a sentence for every issue it can report", () => {
    for (const issue of [
      "origin_invalid",
      "origin_wildcard",
      "origin_insecure",
      "origin_loopback",
      "origin_duplicate",
    ] as const) {
      expect(ALLOWED_ORIGIN_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("originOf", () => {
  it("keeps the first three parts of a URL and drops the rest", () => {
    expect(originOf("https://app.acme.com/auth/link?token=1")).toBe("https://app.acme.com");
    expect(originOf("https://APP.acme.com:443/x")).toBe("https://app.acme.com");
    expect(originOf("https://app.acme.com:8443/x")).toBe("https://app.acme.com:8443");
  });

  it("has no answer for a scheme a browser never sends an Origin for", () => {
    expect(originOf("myapp://callback")).toBeNull();
    expect(originOf("not a url")).toBeNull();
  });
});

describe("suggestionsFrom", () => {
  const redirects = [
    "https://app.acme.com/auth/link",
    "https://app.acme.com/auth/other",
    "https://staging.acme.com/auth/link",
    "myapp://callback",
  ];
  const passkeyOrigins = ["https://app.acme.com", "https://www.acme.com"];

  const oauthReturns = ["https://app.acme.com/auth/callback", "https://portal.acme.com/back"];

  it("offers an origin per redirect target and never the same one twice", () => {
    const offered = suggestionsFrom({ magic_link: redirects }, []).map((entry) => entry.origin);
    expect(offered).toEqual(["https://app.acme.com", "https://staging.acme.com"]);
  });

  it("drops a redirect target that can never appear in an Origin header", () => {
    expect(suggestionsFrom({ magic_link: ["myapp://callback"] }, [])).toEqual([]);
  });

  it("offers passkey and OAuth origins too, and says which list each came from", () => {
    const offered = suggestionsFrom(
      { magic_link: redirects, oauth: oauthReturns, passkey: passkeyOrigins },
      [],
    );
    const sources = new Map(offered.map((entry) => [entry.origin, entry.source]));
    expect(sources.get("https://app.acme.com")).toBe("magic_link");
    expect(sources.get("https://portal.acme.com")).toBe("oauth");
    expect(sources.get("https://www.acme.com")).toBe("passkey");
  });

  it("takes a source nobody passed as nothing to offer", () => {
    const offered = suggestionsFrom({ oauth: oauthReturns }, []);
    expect(offered.map((entry) => entry.source)).toEqual(["oauth", "oauth"]);
  });

  it("never offers what is already allowed", () => {
    const offered = suggestionsFrom({ magic_link: redirects, passkey: passkeyOrigins }, [
      "https://app.acme.com",
    ]);
    expect(offered.map((entry) => entry.origin)).not.toContain("https://app.acme.com");
  });

  it("never offers what the list would refuse anyway", () => {
    expect(suggestionsFrom({ magic_link: ["http://localhost:3000/auth"] }, [])).toEqual([]);
    expect(suggestionsFrom({ magic_link: ["http://app.example.com/auth"] }, [])).toEqual([]);
  });

  it("says where each kind of suggestion comes from and why it is still a choice", () => {
    for (const source of ["magic_link", "oauth", "passkey"] as const) {
      expect(ORIGIN_SOURCES[source].note.length).toBeGreaterThan(0);
    }
  });
});

describe("the list itself", () => {
  it("sorts by the origin, so a list of a dozen is scannable", () => {
    const list = [stored("https://www.acme.com"), stored("https://app.acme.com")];
    expect(sortOrigins(list).map((entry) => entry.origin)).toEqual([
      "https://app.acme.com",
      "https://www.acme.com",
    ]);
  });

  it("matches however either side was cased", () => {
    expect(isOriginAllowed("HTTPS://App.Acme.com", ["https://app.acme.com"])).toBe(true);
    expect(isOriginAllowed("https://other.acme.com", ["https://app.acme.com"])).toBe(false);
  });

  it("allows nothing when nothing is on the list", () => {
    expect(isOriginAllowed("https://app.acme.com", [])).toBe(false);
  });
});

describe("what a browser gets", () => {
  it("answers both the same way and differs by one header", () => {
    const yes = corsSample("https://app.acme.com", true);
    const no = corsSample("https://elsewhere.example", false);
    expect(yes.status).toBe(no.status);
    expect(yes.headers.map((header) => header.name)).toContain(ALLOW_ORIGIN_HEADER);
    expect(no.headers.map((header) => header.name)).not.toContain(ALLOW_ORIGIN_HEADER);
  });

  it("varies on Origin either way, or a cache would serve one answer to both", () => {
    for (const sample of [
      corsSample("https://a.example", true),
      corsSample("https://b.example", false),
    ]) {
      expect(sample.headers[0]).toEqual({ name: "Vary", value: "Origin" });
    }
  });

  it("names the allowed origin rather than a star, since credentials forbid one", () => {
    const yes = corsSample("https://app.acme.com", true);
    expect(yes.headers.find((header) => header.name === ALLOW_ORIGIN_HEADER)?.value).toBe(
      "https://app.acme.com",
    );
  });
});

describe("checkOrigin", () => {
  const allowed = ["https://app.example.com"];

  it("answers nothing for an empty field rather than an error", () => {
    expect(checkOrigin("", allowed)).toBeNull();
    expect(checkOrigin("   ", allowed)).toBeNull();
  });

  it("reduces a whole application URL to the origin a browser would send", () => {
    const answer = checkOrigin("https://app.example.com/sign-in?next=/x#top", allowed);
    expect(answer?.origin).toBe("https://app.example.com");
    expect(answer?.verdict).toBe("allowed");
    expect(answer?.addable).toBe(false);
  });

  it("names a blocked origin and offers to add it", () => {
    const answer = checkOrigin("https://staging.example.com/app", allowed);
    expect(answer?.verdict).toBe("blocked");
    expect(answer?.origin).toBe("https://staging.example.com");
    expect(answer?.addable).toBe(true);
    expect(answer?.detail).toMatch(/nothing in a server log says why/i);
  });

  it("refuses to offer what this list could never hold, and says which rule", () => {
    const insecure = checkOrigin("http://app.example.com", allowed);
    expect(insecure?.verdict).toBe("refusable");
    expect(insecure?.addable).toBe(false);
    expect(insecure?.detail).toBe(ALLOWED_ORIGIN_ISSUE_LABELS.origin_insecure);

    const loopback = checkOrigin("http://localhost:3000/sign-in", allowed);
    expect(loopback?.verdict).toBe("refusable");
    expect(loopback?.detail).toBe(ALLOWED_ORIGIN_ISSUE_LABELS.origin_loopback);
  });

  it("says a custom scheme has no origin at all rather than calling it blocked", () => {
    const answer = checkOrigin("myapp://callback", allowed);
    expect(answer?.verdict).toBe("unusable");
    expect(answer?.origin).toBe("");
    expect(answer?.addable).toBe(false);
  });

  it("matches exactly, so a port or a scheme makes it a different origin", () => {
    expect(checkOrigin("https://app.example.com:8443", allowed)?.verdict).toBe("blocked");
  });
});

describe("what the panel admits it has not observed", () => {
  it("records nothing per origin yet, which the screen has to say out loud", () => {
    expect(ORIGIN_TELEMETRY).toBe(false);
  });

  it("names the four figures it would show, each saying what it counts", () => {
    expect(OBSERVED_FIGURES).toHaveLength(4);
    for (const figure of OBSERVED_FIGURES) {
      expect(figure.info.length).toBeGreaterThan(0);
    }
  });

  it("phrases a suggestion's source as the screen it came from", () => {
    expect(ORIGIN_SOURCE_FROM.passkey).toBe("From passkey settings");
    expect(ORIGIN_SOURCE_FROM.oauth).toBe("From a provider return URL");
    expect(ORIGIN_SOURCE_FROM.magic_link).toBe("From magic-link settings");
  });

  it("states what accepting a suggestion grants, and that it grants nothing else", () => {
    expect(SUGGESTION_GRANT).toMatch(/grants nothing else/i);
  });
});
