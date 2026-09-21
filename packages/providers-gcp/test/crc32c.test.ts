import { describe, expect, it } from "vitest";
import { crc32c, crc32cString } from "../src/crc32c.js";

/**
 * Known-answer tests for the Castagnoli checksum.
 *
 * Hand-written code on the key path needs vectors from outside itself, or it only proves it agrees
 * with itself. These are the standard CRC32C check values (RFC 3720 appendix B and the widely
 * published test set), so a table generated wrongly fails here rather than at the moment KMS
 * rejects every request.
 */
describe("CRC32C", () => {
  it("matches the published check values", () => {
    const cases: [string, number][] = [
      ["", 0x00000000],
      ["a", 0xc1d04330],
      ["abc", 0x364b3fb7],
      ["message digest", 0x02bd79d0],
      ["abcdefghijklmnopqrstuvwxyz", 0x9ee6ef25],
      ["123456789", 0xe3069283],
    ];
    for (const [input, expected] of cases) {
      expect(crc32c(new TextEncoder().encode(input)), input).toBe(expected);
    }
  });

  /**
   * The polynomial trap. Node's `zlib.crc32` is CRC-32 with the IEEE polynomial and KMS speaks
   * Castagnoli; using one where the other belongs gives a number of the right shape that is always
   * wrong, and the symptom is KMS rejecting everything.
   */
  it("is not the IEEE CRC-32 that zlib computes", async () => {
    const { crc32 } = await import("node:zlib");
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(Buffer.from(bytes))).not.toBe(crc32c(bytes));
  });

  it("is unsigned, because the wire format has no negative numbers", () => {
    // A naive implementation returns a negative int32 for inputs whose high bit is set.
    for (const input of ["a", "abc", "ÿÿÿÿ"]) {
      expect(crc32c(new TextEncoder().encode(input))).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * KMS types these as `Int64Value`, and JSON has no 64-bit integer, so the REST mapping carries
   * them as decimal strings. Comparing a number against that string never matches, and every
   * response then looks corrupt.
   */
  it("renders as a decimal string for the wire", () => {
    expect(crc32cString(new TextEncoder().encode("123456789"))).toBe("3808858755");
  });
});
