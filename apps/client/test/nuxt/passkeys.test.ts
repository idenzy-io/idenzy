import { describe, expect, it } from "vitest";
import {
  androidOrigin,
  authenticatorOf,
  backupLine,
  creationOptions,
  evaluatePasskeySetup,
  isRpId,
  normaliseOrigin,
  parseOrigin,
  passkeyBlockers,
  type RelyingParty,
  validateOrigin,
  validateRelyingParty,
} from "../../app/utils/passkeys";
import type { SetupCheck } from "../../app/utils/setup-check";

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

describe("an Android app's origin", () => {
  const FINGERPRINT = Array.from({ length: 32 }, (_, byte) =>
    byte.toString(16).padStart(2, "0").toUpperCase(),
  ).join(":");
  const ORIGIN = "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

  it("is stored from the fingerprint keytool prints, or as itself", () => {
    expect(androidOrigin(FINGERPRINT)).toBe(ORIGIN);
    expect(normaliseOrigin(FINGERPRINT)).toBe(ORIGIN);
    expect(normaliseOrigin(ORIGIN)).toBe(ORIGIN);
  });

  it("passes whatever the passkey domain, which an app is not on", () => {
    expect(validateOrigin(FINGERPRINT, "example.com")).toBeNull();
    expect(validateRelyingParty({ rpId: "example.com", rpName: "E", origins: [ORIGIN] })).toEqual(
      [],
    );
  });

  it("is left out of the CORS check, which native code does not meet", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: { rpId: "example.com", rpName: "E", origins: ["https://example.com", ORIGIN] },
      allowedOrigins: ["https://example.com"],
      ceremonies: 1,
    });
    expect(checks.find((check) => check.id === "cors")?.state).toBe("pass");
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

const PARTY: RelyingParty = {
  rpId: "example.com",
  rpName: "Acme",
  origins: ["https://example.com", "https://app.example.com"],
};

const stateOf = (checks: SetupCheck[], id: SetupCheck["id"]) =>
  checks.find((check) => check.id === id)?.state;

describe("creationOptions", () => {
  it("reads the domain and the name off the party and the rest off the fixed rules", () => {
    const options = creationOptions(PARTY);
    expect(options.map((option) => option.name)).toEqual([
      "rp",
      "authenticatorSelection",
      "attestation",
      "pubKeyCredParams",
    ]);
    expect(options[0]?.value).toContain('"example.com"');
    expect(options[0]?.value).toContain('"Acme"');
    /* Discoverable and verified are what the usernameless flow rests on, so the sample
       must not be able to say otherwise while the rows say it does. */
    expect(options[1]?.value).toContain('"residentKey": "required"');
    expect(options[1]?.value).toContain('"userVerification": "required"');
    expect(options[3]?.value).toBe('[{ "alg": -8 }, { "alg": -7 }, { "alg": -257 }]');
  });
});

describe("evaluateSetup", () => {
  it("passes everything for a project that is wired up", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: PARTY,
      allowedOrigins: PARTY.origins,
      ceremonies: 12,
    });
    expect(checks.map((check) => check.state)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("fails the domain and the URLs for a project with no party", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: null,
      allowedOrigins: [],
      ceremonies: 0,
    });
    expect(stateOf(checks, "domain")).toBe("fail");
    expect(stateOf(checks, "urls")).toBe("fail");
  });

  it("warns on a URL the CORS allowlist does not hold, and points at the screen that fixes it", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: PARTY,
      allowedOrigins: ["https://example.com"],
      ceremonies: 12,
    });
    const cors = checks.find((check) => check.id === "cors");
    expect(cors?.state).toBe("warn");
    expect(cors?.finding).toContain("1 URL is missing");
    expect(cors?.fix?.to).toBe("/domains/origins");
  });

  it("takes a URL as covered whatever case or trailing slash the allowlist holds it in", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: PARTY,
      allowedOrigins: ["HTTPS://Example.com/", "https://app.example.com"],
      ceremonies: 1,
    });
    expect(stateOf(checks, "cors")).toBe("pass");
  });

  it("fails a URL that is not on the passkey domain, because a ceremony there is refused", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: { ...PARTY, origins: ["https://app.example.com", "https://other.io"] },
      allowedOrigins: [],
      ceremonies: 0,
    });
    expect(stateOf(checks, "urls")).toBe("fail");
  });

  it("warns rather than fails when nothing has reached us, which is quiet and not broken", () => {
    const checks = evaluatePasskeySetup({
      enabled: true,
      party: PARTY,
      allowedOrigins: PARTY.origins,
      ceremonies: 0,
    });
    expect(stateOf(checks, "integration")).toBe("warn");
  });
});

describe("setupBlockers", () => {
  it("is empty for a project that is on and configured", () => {
    expect(
      passkeyBlockers({ enabled: true, party: PARTY, allowedOrigins: [], ceremonies: 0 }),
    ).toEqual([]);
  });

  it("names the missing domain and the switch, in the order they have to be settled", () => {
    const blockers = passkeyBlockers({
      enabled: false,
      party: null,
      allowedOrigins: [],
      ceremonies: 0,
    });
    expect(blockers.map((blocker) => blocker.id)).toEqual(["party", "disabled"]);
  });

  it("counts a switched-off method as blocking however well it is configured", () => {
    const blockers = passkeyBlockers({
      enabled: false,
      party: PARTY,
      allowedOrigins: PARTY.origins,
      ceremonies: 40,
    });
    expect(blockers.map((blocker) => blocker.id)).toEqual(["disabled"]);
  });
});

describe("backupLine", () => {
  it("says where an authenticator's passkeys live, and never in figures alone", () => {
    expect(backupLine(27, 27)).toBe("All synced to a cloud.");
    expect(backupLine(1, 1)).toBe("Synced to a cloud.");
    expect(backupLine(3, 0)).toBe("All bound to their device.");
    expect(backupLine(1, 0)).toBe("Bound to its device.");
    expect(backupLine(8, 4)).toBe("4 synced, 4 on the device.");
    expect(backupLine(0, 0)).toBe("Nothing enrolled.");
  });
});
