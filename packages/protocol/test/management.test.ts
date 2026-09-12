import { describe, expect, it } from "vitest";
import {
  addProjectDomainSchema,
  addProjectOriginSchema,
  browserOriginSchema,
} from "../src/schemas/management.js";

/**
 * The CORS allowlist's rules, which are the reason this schema is not just a string
 * (ADR-0006).
 *
 * Each refusal here is a value that would be stored happily and then match nothing a browser
 * ever sends, and a non-match fails invisibly: the API answers 200 without the allow header
 * and the browser discards the response. So an entry that cannot work has to be refused at
 * the point somebody types it, which is the only moment anyone is looking.
 */
function origin(value: string): string | null {
  const result = browserOriginSchema.safeParse(value);
  return result.success ? result.data : null;
}

describe("browserOriginSchema", () => {
  it("takes a scheme, a host and an optional port", () => {
    expect(origin("https://app.example.com")).toBe("https://app.example.com");
    expect(origin("https://app.example.com:8443")).toBe("https://app.example.com:8443");
  });

  /* `Origin` is sent lowercase and without a default port, and the check is a comparison, so
     two spellings of one origin are two rows that each look like a decision. */
  it("canonicalises what a browser would actually send", () => {
    expect(origin("HTTPS://App.Example.COM")).toBe("https://app.example.com");
    expect(origin("https://app.example.com:443")).toBe("https://app.example.com");
    expect(origin("  https://app.example.com/  ")).toBe("https://app.example.com");
  });

  it("refuses anything after the host, rather than quietly dropping it", () => {
    expect(origin("https://app.example.com/callback")).toBeNull();
    expect(origin("https://app.example.com/?next=/x")).toBeNull();
    expect(origin("https://app.example.com#top")).toBeNull();
    expect(origin("https://user:pass@app.example.com")).toBeNull();
  });

  /* A pattern parses as a URL perfectly well, which is exactly why it needs its own refusal. */
  it("refuses a wildcard", () => {
    expect(origin("https://*.example.com")).toBeNull();
    expect(origin("*")).toBeNull();
  });

  it("refuses http, because the response this unlocks is credentialed", () => {
    expect(origin("http://app.example.com")).toBeNull();
  });

  /* Loopback is allowed by the deployment outside production, in code and gated on the
     environment. A row for it would grant nothing in production and is not needed elsewhere. */
  it("refuses loopback, whichever spelling", () => {
    expect(origin("https://localhost")).toBeNull();
    expect(origin("https://localhost:3000")).toBeNull();
    expect(origin("https://127.0.0.1:3000")).toBeNull();
    expect(origin("https://[::1]:3000")).toBeNull();
  });

  it("refuses a scheme that can never appear in an Origin header", () => {
    expect(origin("myapp://callback")).toBeNull();
    expect(origin("app.example.com")).toBeNull();
    expect(origin("")).toBeNull();
  });

  /* The host is what a browser can put in the header and no more: an underscore is legal in a
     DNS name and never in a hostname, and an IPv6 literal is only an origin bracketed. */
  it("is exact about what a host may be", () => {
    expect(origin("https://my_app.example.com")).toBeNull();
    expect(origin("https://-example.com")).toBeNull();
    expect(origin("https://example-.com")).toBeNull();
    expect(origin("https://[2001:db8::1]:8443")).toBe("https://[2001:db8::1]:8443");
    expect(origin("https://2001:db8::1")).toBeNull();
  });

  it("refuses a port no socket could be listening on", () => {
    expect(origin("https://app.example.com:70000")).toBeNull();
    expect(origin("https://app.example.com:65535")).toBe("https://app.example.com:65535");
  });

  it("is what the add body carries, canonical form included", () => {
    const parsed = addProjectOriginSchema.parse({ origin: "https://App.Example.com:443/" });
    expect(parsed.origin).toBe("https://app.example.com");
    expect(addProjectOriginSchema.safeParse({ origin: "https://app.example.com/x" }).success).toBe(
      false,
    );
  });
});

/**
 * The hostname beside it, because the two are told apart by shape and a reader meeting both
 * schemas should see why: a domain is a name in DNS and an origin is a scheme, a host and a
 * port. Neither accepts what the other takes.
 */
describe("addProjectDomainSchema", () => {
  it("takes a hostname and lowercases it", () => {
    expect(addProjectDomainSchema.parse({ domain: " Auth.Example.COM " }).domain).toBe(
      "auth.example.com",
    );
  });

  it("refuses a URL, a scheme and a path", () => {
    for (const domain of ["https://auth.example.com", "auth.example.com/x", "auth"]) {
      expect(addProjectDomainSchema.safeParse({ domain }).success).toBe(false);
    }
  });
});
