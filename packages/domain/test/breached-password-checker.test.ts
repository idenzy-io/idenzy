import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BreachedPasswordChecker } from "../src/ports/breached-password-checker.js";

/** Records what the base actually sent outward, which is the property under test. */
class RecordingChecker extends BreachedPasswordChecker {
  readonly requested: string[] = [];

  constructor(private readonly corpus: readonly string[] = []) {
    super();
  }

  protected override fetchRange(prefix: string): Promise<readonly string[]> {
    this.requested.push(prefix);
    return Promise.resolve(this.corpus);
  }
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex").toUpperCase();
}

describe("k-anonymity", () => {
  // PROJECT.md 4.5: only five hex characters ever leave our system. The split is in the
  // base so no subclass can widen it.
  it("sends only the five-character prefix outward", async () => {
    const checker = new RecordingChecker();
    await checker.isBreached("correct horse battery staple");

    const digest = sha1("correct horse battery staple");
    expect(checker.requested).toEqual([digest.slice(0, 5)]);
    expect(checker.requested.join()).not.toContain(digest.slice(5));
  });

  it("never passes the password itself to the subclass", async () => {
    const checker = new RecordingChecker();
    await checker.isBreached("hunter2");
    expect(checker.requested.join()).not.toContain("hunter2");
  });
});

describe("matching", () => {
  it("reports a password whose suffix is in the range", async () => {
    const suffix = sha1("password").slice(5);
    const checker = new RecordingChecker(["0".repeat(35), suffix]);
    expect(await checker.isBreached("password")).toBe(true);
  });

  it("reports a password whose suffix is absent", async () => {
    const checker = new RecordingChecker(["0".repeat(35)]);
    expect(await checker.isBreached("password")).toBe(false);
  });

  it("compares case-insensitively, since providers differ on it", async () => {
    const suffix = sha1("password").slice(5).toLowerCase();
    const checker = new RecordingChecker([suffix]);
    expect(await checker.isBreached("password")).toBe(true);
  });

  // Argon2idHasher normalizes to NFKC too. If these two disagreed, a password could pass
  // the breach check in one encoding and be stored hashed in the other.
  it("normalizes the password the same way the hasher does", async () => {
    const decomposed = "cafe\u0301";
    const checker = new RecordingChecker([sha1(decomposed.normalize("NFKC")).slice(5)]);
    expect(decomposed).not.toBe(decomposed.normalize("NFKC"));
    expect(await checker.isBreached(decomposed)).toBe(true);
  });
});
