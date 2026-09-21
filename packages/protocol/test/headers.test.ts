import { describe, expect, it } from "vitest";
import { IDENZY_HEADERS, IdenzyCookie, IdenzyHeader } from "../src/http/headers.js";
import { isApiKey, isPublishableKey, isSecretKey, parseApiKey } from "../src/schemas/common.js";

/**
 * Structural tests, which is the only kind these constants can have.
 *
 * Each one catches a mistake whose runtime symptom is misleading: a mixed-case header never
 * matches a lookup, a header missing from the allow-list is stripped by the browser and looks
 * like a missing key, and a cookie name without the `__Host-` prefix silently loses the
 * browser guarantee the CSRF design depends on.
 */
describe("wire header names", () => {
  it("are lowercase, because Node lowercases what it receives", () => {
    for (const name of Object.values(IdenzyHeader)) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("are all offered to CORS, so none is stripped before it reaches us", () => {
    for (const name of Object.values(IdenzyHeader)) {
      expect(IDENZY_HEADERS).toContain(name);
    }
  });

  it("carry the idenzy prefix, so a customer's own headers cannot collide", () => {
    for (const name of Object.values(IdenzyHeader)) {
      expect(name.startsWith("x-idenzy-")).toBe(true);
    }
  });
});

describe("cookie names", () => {
  it("are all __Host- prefixed, which is what the CSRF design rests on", () => {
    for (const name of Object.values(IdenzyCookie)) {
      expect(name.startsWith("__Host-")).toBe(true);
    }
  });
});

describe("key prefixes", () => {
  it("tell a publishable key from a secret one, and never both", () => {
    expect(isPublishableKey("pk_live_abc")).toBe(true);
    expect(isSecretKey("pk_live_abc")).toBe(false);
    expect(isSecretKey("sk_live_abc")).toBe(true);
    expect(isPublishableKey("sk_live_abc")).toBe(false);
  });

  it("agree with isApiKey, so the guard cannot classify one way and route another", () => {
    for (const key of ["pk_live_abc", "sk_live_abc"]) {
      expect(isApiKey(key)).toBe(isPublishableKey(key) || isSecretKey(key));
    }
    expect(isApiKey("eyJhbGciOiJFUzI1NiJ9.payload.sig")).toBe(false);
  });
});

describe("parsing a key into its cell", () => {
  it("takes it apart into kind, cell and body", () => {
    expect(parseApiKey("pk_us1_3f9a2b8c")).toEqual({
      kind: "pk_",
      cell: "us1",
      body: "3f9a2b8c",
    });
    expect(parseApiKey("sk_eu1_abc")?.kind).toBe("sk_");
  });

  /**
   * The trap worth a test of its own. `generateOpaqueToken` is base64url, so `_` is a legal
   * character in the body and `split("_")[2]` would hand back a truncated secret that still
   * looked plausible — and would hash to nothing, so the symptom would be an unresolvable key
   * rather than an obvious bug.
   */
  it("keeps a body containing underscores whole", () => {
    expect(parseApiKey("pk_us1_3f9a_2b8c_xY")?.body).toBe("3f9a_2b8c_xY");
  });

  it("refuses anything that names no cell", () => {
    // A kind and a body and nothing between them: malformed, not misdirected.
    expect(parseApiKey("pk_abc")).toBeNull();
    // A cell and no body is not a key either.
    expect(parseApiKey("pk_us1_")).toBeNull();
    expect(parseApiKey("pk_")).toBeNull();
    // Not a key at all.
    expect(parseApiKey("eyJhbGciOiJFUzI1NiJ9.payload.sig")).toBeNull();
  });

  it("refuses a cell segment that could not be a cell code", () => {
    // Uppercase, punctuation and over-long segments are all out, which is what keeps the
    // segment unambiguous against a base64url body.
    expect(parseApiKey("pk_US1_abc")).toBeNull();
    expect(parseApiKey("pk_us-1_abc")).toBeNull();
    expect(parseApiKey("pk_1us_abc")).toBeNull();
    expect(parseApiKey("pk_verylongcell_abc")).toBeNull();
  });

  it("agrees with the prefix predicates, so nothing can classify one way and parse another", () => {
    for (const key of ["pk_us1_abc", "sk_us1_abc"]) {
      const parsed = parseApiKey(key);
      expect(parsed).not.toBeNull();
      expect(isPublishableKey(key)).toBe(parsed?.kind === "pk_");
      expect(isSecretKey(key)).toBe(parsed?.kind === "sk_");
    }
  });
});
