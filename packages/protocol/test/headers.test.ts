import { describe, expect, it } from "vitest";
import { IDENZY_HEADERS, IdenzyCookie, IdenzyHeader } from "../src/http/headers.js";
import { isApiKey, isPublishableKey, isSecretKey } from "../src/schemas/common.js";

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
