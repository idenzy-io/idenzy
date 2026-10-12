import { describe, expect, it } from "vitest";
import {
  androidPasskeyOrigin,
  isAndroidPasskeyOrigin,
  relyingPartySchema,
} from "../src/schemas/management.js";

const ZERO_TO_31 =
  "00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F";

describe("an Android passkey origin", () => {
  it("is the fingerprint's bytes in base64url, as Credential Manager writes them", () => {
    expect(androidPasskeyOrigin(ZERO_TO_31)).toBe(
      "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    );
    // The two characters base64 and base64url disagree about.
    expect(androidPasskeyOrigin(Array(32).fill("FA").join(":"))).toBe(
      "android:apk-key-hash:-vr6-vr6-vr6-vr6-vr6-vr6-vr6-vr6-vr6-vr6-vo",
    );
  });

  it("is refused for anything that is not 32 bytes", () => {
    expect(androidPasskeyOrigin("AA:BB")).toBeNull();
    expect(androidPasskeyOrigin(ZERO_TO_31.replace("1F", "ZZ"))).toBeNull();
    expect(isAndroidPasskeyOrigin("android:apk-key-hash:short")).toBe(false);
  });
});

describe("a relying party", () => {
  const party = (origins: string[]) =>
    relyingPartySchema.safeParse({ rpId: "example.com", rpName: "Example", origins });

  it("takes pages on its domain and Android apps by certificate", () => {
    const parsed = party([
      "https://app.example.com/",
      "https://example.com:443",
      "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ]);
    expect(parsed.success && parsed.data.origins).toEqual([
      "https://app.example.com",
      "https://example.com",
      "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ]);
  });

  it("refuses a page on another domain, a page over http, and the same origin twice", () => {
    expect(party(["https://example.org"]).success).toBe(false);
    expect(party(["https://notexample.com"]).success).toBe(false);
    expect(party(["http://app.example.com"]).success).toBe(false);
    expect(party(["https://example.com", "https://example.com/"]).success).toBe(false);
  });

  it("lets loopback use http, which browsers treat as a secure context", () => {
    const local = relyingPartySchema.safeParse({
      rpId: "localhost",
      rpName: "Local",
      origins: ["http://localhost:3000"],
    });
    expect(local.success).toBe(true);
  });
});
