import { randomBytes } from "node:crypto";
import { SystemClock } from "@idenzy/core/time/clock";
import { importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { FieldEncryptor } from "../src/encryption/field-encryptor.js";
import { Argon2idHasher } from "../src/hashing/password-hasher.js";
import { LocalEs256Issuer } from "../src/tokens/local-es256-issuer.js";
import {
  generateNumericOtp,
  generateOpaqueToken,
  hashToken,
  safeCompareHex,
} from "../src/tokens/random.js";

describe("token issuance", () => {
  it("issues a verifiable ES256 token with the required claims", async () => {
    const issuer = await LocalEs256Issuer.create(new SystemClock(), "https://auth.test", 300);
    const issued = await issuer.issue({
      sub: "usr_1",
      sid: "ses_1",
      aud: "prj_1",
      amr: ["pwd"],
    });

    const [jwk] = await issuer.publicKeys();
    const key = await importJWK({ ...jwk }, "ES256");
    const { payload, protectedHeader } = await jwtVerify(issued.token, key);

    expect(protectedHeader.alg).toBe("ES256");
    expect(payload["sid"]).toBe("ses_1");
    expect(payload["amr"]).toEqual(["pwd"]);
    expect(payload["iss"]).toBe("https://auth.test");
    expect(payload["exp"]).toBeDefined();
  });

  it("bounds the lifetime to the configured ttl", async () => {
    const issuer = await LocalEs256Issuer.create(new SystemClock(), "https://auth.test", 60);
    const issued = await issuer.issue({ sub: "u", sid: "s", aud: "p", amr: [] });
    const seconds = (issued.expiresAt.getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThanOrEqual(61);
  });
});

describe("FieldEncryptor", () => {
  const key = randomBytes(32);

  it("round-trips within the same tenant", () => {
    const enc = new FieldEncryptor(key);
    expect(enc.decrypt(enc.encrypt("totp-secret", "prj_1"), "prj_1")).toBe("totp-secret");
  });

  it("refuses ciphertext moved between tenants", () => {
    const enc = new FieldEncryptor(key);
    const stolen = enc.encrypt("totp-secret", "prj_1");
    expect(() => enc.decrypt(stolen, "prj_2")).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const enc = new FieldEncryptor(key);
    const raw = Buffer.from(enc.encrypt("secret", "prj_1"), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => enc.decrypt(raw.toString("base64"), "prj_1")).toThrow();
  });

  it("rejects a key of the wrong size", () => {
    expect(() => new FieldEncryptor(randomBytes(16))).toThrow();
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hasher = new Argon2idHasher();
    const { hash } = await hasher.hash("correct horse battery staple");
    expect(await hasher.verify(hash, "correct horse battery staple")).toBe(true);
    expect(await hasher.verify(hash, "wrong")).toBe(false);
  }, 20_000);

  it("treats a malformed stored hash as a failure, not an error", async () => {
    expect(await new Argon2idHasher().verify("not-a-hash", "anything")).toBe(false);
  });

  it("normalizes unicode so an equivalent password still verifies", async () => {
    const hasher = new Argon2idHasher();
    const { hash } = await hasher.hash("paßwortÅ");
    expect(await hasher.verify(hash, "paßwortÅ")).toBe(true);
  }, 20_000);
});

describe("random tokens", () => {
  it("produces distinct opaque tokens", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));
    expect(seen.size).toBe(500);
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("generates uniformly distributed otp digits", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i += 1) {
      for (const digit of generateNumericOtp(6)) {
        counts.set(digit, (counts.get(digit) ?? 0) + 1);
      }
    }
    // 36000 digits over 10 buckets. Modulo bias would skew low digits well past this.
    for (const digit of "0123456789") {
      expect(counts.get(digit) ?? 0).toBeGreaterThan(3000);
    }
  });

  it("compares hex digests without leaking length mismatches as throws", () => {
    expect(safeCompareHex("abcd", "abcd")).toBe(true);
    expect(safeCompareHex("abcd", "abce")).toBe(false);
    expect(safeCompareHex("abcd", "ab")).toBe(false);
    expect(safeCompareHex("", "")).toBe(false);
  });
});
