/**
 * CRC32C (Castagnoli), which is the checksum Cloud KMS speaks.
 *
 * **Not the same polynomial as `zlib.crc32`.** Node's built-in is CRC-32 with the IEEE polynomial;
 * KMS uses Castagnoli (0x1EDC6F41, reflected 0x82F63B78). Handing one where the other is expected
 * produces a number that is the right shape and always wrong, and KMS answers by rejecting every
 * request — which reads as an authentication problem rather than a checksum one.
 *
 * Thirty lines rather than a dependency, for the reason §7.6 gives about the token-signing path.
 * The known-answer tests beside it are what make that defensible.
 */
const POLYNOMIAL = 0x82f63b78;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ POLYNOMIAL : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** The CRC32C of `bytes`, as an unsigned 32-bit number. */
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    // Safe: the index is masked to a byte, so the table entry always exists.
    crc = (crc >>> 8) ^ (TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The same value as a decimal string, which is how KMS carries it.
 *
 * The API types these fields as `Int64Value`, and JSON has no 64-bit integer — so Google's REST
 * mapping sends them as strings. Comparing a number to that string succeeds never, and the symptom
 * is every response looking corrupt.
 */
export function crc32cString(bytes: Uint8Array): string {
  return crc32c(bytes).toString(10);
}
