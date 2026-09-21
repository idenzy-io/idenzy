/**
 * Wrapping and unwrapping key material with a key we never hold (PROJECT.md 4.13.4).
 *
 * The envelope. A per-project signing key and a per-project data encryption key are both generated
 * here, encrypted under a **per-cell** key that lives in KMS, and stored as ciphertext in the
 * cell's own database. Opening one is a KMS call; using it afterwards is local.
 *
 * **Why an envelope rather than signing in KMS**, since §4.2 originally said the latter. Two
 * things broke at once. A key per project is a per-tenant fixed cost, and §5.2 requires fixed cost
 * per tenant to be approximately zero — those cannot both hold. And a KMS call per token, at ~158
 * mints per monthly active user, is a network round trip on the hottest path in the product,
 * which from a VPS is an internet round trip.
 *
 * What it costs is honest to state: the unwrapped key does exist in process memory. That is a
 * weaker posture than a non-exportable HSM key and it is not a weaker *control* — SOC 2, ISO 27001
 * and HIPAA ask for key material encrypted at rest, access controlled, rotated and audited, all of
 * which this satisfies. None of them require a key that cannot be exported.
 *
 * So the properties that matter are here rather than in an implementation:
 *
 *   - Ciphertext is opaque and self-describing enough for the implementation to open it. Nothing
 *     above this port parses it, so a change of provider is a change of adapter.
 *   - Wrapping is **not** required to be deterministic. Two wraps of one key differ, which is
 *     correct for any authenticated encryption and means ciphertext is never an equality key.
 */
export abstract class KeyEncryption {
  /**
   * Encrypts key material under the cell's key encryption key.
   *
   * `context` is additional authenticated data, and passing the project id is what stops a
   * ciphertext lifted from one project's row being unwrapped in another's: the bytes decrypt only
   * when the same context is supplied again, so a swapped row fails rather than silently issuing
   * one tenant's tokens under another tenant's key.
   */
  abstract wrap(plaintext: Uint8Array, context: string): Promise<Uint8Array>;

  /** Decrypts what `wrap` produced, under the same context. Throws if either has changed. */
  abstract unwrap(ciphertext: Uint8Array, context: string): Promise<Uint8Array>;
}
