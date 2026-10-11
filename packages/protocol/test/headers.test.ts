import { describe, expect, it } from "vitest";
import { IDENZY_HEADERS, IdenzyCookie, IdenzyHeader } from "../src/http/headers.js";
import {
  displayableKey,
  isApiKey,
  isPublishableKey,
  isSecretKey,
  KEY_DISPLAY_LENGTH,
} from "../src/schemas/common.js";

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
  it("are all __Host- prefixed, so no sibling subdomain can plant one", () => {
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

describe("what a key shows of itself", () => {
  it("shows the kind and eight characters of the body, and no more", () => {
    expect(displayableKey("pk_3f9a2b8cDEADBEEF")).toBe("pk_3f9a2b8c");
    expect(displayableKey("sk_3f9a2b8cDEADBEEF")).toBe("sk_3f9a2b8c");
  });

  /**
   * The figure is a promise, not a convenience. `api_keys.prefix` stores the same eleven
   * characters, so what a refusal quotes back is what the dashboard lists beside the key —
   * and shortening either without the other would leave a customer comparing two strings
   * that name the same key and do not match.
   */
  it("is the length api-keys-service stores in the prefix column", () => {
    expect(KEY_DISPLAY_LENGTH).toBe(11);
    expect(displayableKey("pk_3f9a2b8cDEADBEEF")).toHaveLength(KEY_DISPLAY_LENGTH);
  });

  it("truncates rather than throwing on something that is not a key", () => {
    expect(displayableKey("eyJhbGciOiJFUzI1NiJ9.payload.sig")).toBe("eyJhbGciOiJ");
    expect(displayableKey("")).toBe("");
  });

  /**
   * A key carries its kind in the clear and nothing else. It used to carry a region cell
   * between the two — `pk_us1_3f9a…` — which a guard refused on before any lookup. With one
   * deployment there is no cell to name, so the prefix predicates are the whole of what can
   * be told from a key's text.
   */
  it("agrees with the prefix predicates", () => {
    expect(isPublishableKey("pk_3f9a2b8c")).toBe(true);
    expect(isSecretKey("pk_3f9a2b8c")).toBe(false);
    expect(isSecretKey("sk_3f9a2b8c")).toBe(true);
    expect(isPublishableKey("sk_3f9a2b8c")).toBe(false);
    expect(isApiKey("pk_3f9a2b8c")).toBe(true);
    expect(isApiKey("whsec_3f9a2b8c")).toBe(false);
  });
});
