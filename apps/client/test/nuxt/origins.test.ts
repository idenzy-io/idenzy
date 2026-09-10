import { describe, expect, it } from "vitest";
import {
  ALLOW_ORIGIN_HEADER,
  ALLOWED_ORIGIN_ISSUE_LABELS,
  type AllowedOrigin,
  corsSample,
  isOriginAllowed,
  ORIGIN_SOURCES,
  originOf,
  sortOrigins,
  suggestionsFrom,
  validateAllowedOrigin,
} from "../../app/utils/origins";

function stored(origin: string): AllowedOrigin {
  return { origin, addedAt: "2026-06-04T10:12:00.000Z", source: null };
}

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

  it("offers an origin per redirect target and never the same one twice", () => {
    const offered = suggestionsFrom(redirects, [], []).map((entry) => entry.origin);
    expect(offered).toEqual(["https://app.acme.com", "https://staging.acme.com"]);
  });

  it("drops a redirect target that can never appear in an Origin header", () => {
    const offered = suggestionsFrom(["myapp://callback"], [], []);
    expect(offered).toEqual([]);
  });

  it("offers passkey origins too, and says which list each came from", () => {
    const offered = suggestionsFrom(redirects, passkeyOrigins, []);
    const sources = new Map(offered.map((entry) => [entry.origin, entry.source]));
    expect(sources.get("https://app.acme.com")).toBe("magic_link");
    expect(sources.get("https://www.acme.com")).toBe("passkey");
  });

  it("never offers what is already allowed", () => {
    const offered = suggestionsFrom(redirects, passkeyOrigins, ["https://app.acme.com"]);
    expect(offered.map((entry) => entry.origin)).not.toContain("https://app.acme.com");
  });

  it("never offers what the list would refuse anyway", () => {
    expect(suggestionsFrom(["http://localhost:3000/auth"], [], [])).toEqual([]);
    expect(suggestionsFrom(["http://app.example.com/auth"], [], [])).toEqual([]);
  });

  it("says where each kind of suggestion comes from and why it is still a choice", () => {
    for (const source of ["magic_link", "passkey"] as const) {
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
