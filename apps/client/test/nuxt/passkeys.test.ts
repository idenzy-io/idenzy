import { describe, expect, it } from "vitest";
import {
  authenticatorOf,
  isRpId,
  normaliseOrigin,
  parseOrigin,
  validateOrigin,
  validateRelyingParty,
} from "../../app/utils/passkeys";

describe("isRpId", () => {
  it("takes a registrable domain and localhost, and nothing with a scheme or port", () => {
    expect(isRpId("example.com")).toBe(true);
    expect(isRpId("Auth.Example.co.uk")).toBe(true);
    expect(isRpId("localhost")).toBe(true);
    expect(isRpId("https://example.com")).toBe(false);
    expect(isRpId("example.com:443")).toBe(false);
    expect(isRpId("example")).toBe(false);
    expect(isRpId("-bad.example.com")).toBe(false);
  });
});

describe("parseOrigin", () => {
  it("accepts scheme, host and port and refuses anything more", () => {
    expect(parseOrigin("https://app.example.com")?.host).toBe("app.example.com");
    expect(parseOrigin("https://app.example.com/")?.host).toBe("app.example.com");
    expect(parseOrigin("http://localhost:3000")?.host).toBe("localhost:3000");
    expect(parseOrigin("https://app.example.com/login")).toBeNull();
    expect(parseOrigin("https://app.example.com?x=1")).toBeNull();
    expect(parseOrigin("app.example.com")).toBeNull();
  });

  it("normalises to lower case without a trailing slash", () => {
    expect(normaliseOrigin("HTTPS://App.Example.com/")).toBe("https://app.example.com");
    expect(normaliseOrigin("nonsense")).toBe("nonsense");
  });
});

describe("validateOrigin", () => {
  it("wants https away from localhost", () => {
    expect(validateOrigin("http://app.example.com", "example.com")).toBe("origin_insecure");
    expect(validateOrigin("http://localhost:3000", "localhost")).toBeNull();
  });

  it("keeps the host on the RP ID's domain", () => {
    expect(validateOrigin("https://example.com", "example.com")).toBeNull();
    expect(validateOrigin("https://app.example.com", "example.com")).toBeNull();
    expect(validateOrigin("https://notexample.com", "example.com")).toBe("origin_outside_rp");
    expect(validateOrigin("https://example.com", "app.example.com")).toBe("origin_outside_rp");
  });

  it("names a malformed origin first", () => {
    expect(validateOrigin("app.example.com", "example.com")).toBe("origin_invalid");
  });
});

describe("validateRelyingParty", () => {
  it("accepts a whole party and lists what is wrong with a broken one", () => {
    expect(
      validateRelyingParty({
        rpId: "example.com",
        rpName: "Acme",
        origins: ["https://example.com", "https://app.example.com"],
      }),
    ).toEqual([]);
    expect(validateRelyingParty({ rpId: "https://x", rpName: " ", origins: [] })).toEqual([
      "rp_id_invalid",
      "rp_name_missing",
      "origins_empty",
    ]);
    expect(
      validateRelyingParty({ rpId: "example.com", rpName: "Acme", origins: ["https://other.io"] }),
    ).toEqual(["origin_outside_rp"]);
  });
});

describe("authenticatorOf", () => {
  it("names the ones it knows and never guesses at the rest", () => {
    expect(authenticatorOf("FBFC3007-154E-4ECC-8C0B-6E020557D7BD").name).toBe("iCloud Keychain");
    expect(authenticatorOf("00000000-0000-0000-0000-000000000000").name).toBe(
      "Another authenticator",
    );
    expect(authenticatorOf(null).name).toBe("Another authenticator");
  });
});
