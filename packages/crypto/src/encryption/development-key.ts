import { createHash } from "node:crypto";

/**
 * A data key for local development, and nothing else (PROJECT.md 4.13.4).
 *
 * The real key is per project, generated in KMS and stored wrapped in
 * `projects.dek_wrapped`; this one is derived from a seed anyone can read. It exists
 * because `FieldEncryptor` needs 32 bytes to construct and a developer without a KMS
 * project still has to be able to sign in.
 *
 * Deterministic rather than random per process on purpose: a restart must not orphan the
 * one-time codes issued a minute earlier, which is a confusing failure to debug for no
 * benefit in a setting where the key is not a secret anyway.
 *
 * Callers guard this behind an environment check. It is named the way it is so that a
 * grep for "development" finds every place that would have to change.
 */
export function developmentDataKey(seed: string): Buffer {
  return createHash("sha256").update(`idenzy-development-data-key:${seed}`).digest();
}
