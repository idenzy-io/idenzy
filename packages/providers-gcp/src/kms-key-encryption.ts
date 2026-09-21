import { InternalError } from "@idenzy/core/errors";
import { KeyEncryption } from "@idenzy/crypto/kms/key-encryption";
import { z } from "zod";
import { type AccessTokenSource, AdcTokenSource } from "./access-token-source.js";
import { crc32cString } from "./crc32c.js";

const encryptSchema = z.object({
  ciphertext: z.string().min(1),
  ciphertextCrc32c: z.string().optional(),
  verifiedPlaintextCrc32c: z.boolean().optional(),
});

const decryptSchema = z.object({
  plaintext: z.string(),
  plaintextCrc32c: z.string().optional(),
});

const API = "https://cloudkms.googleapis.com/v1";
const FETCH_TIMEOUT_MS = 5_000;

export interface KmsKeyEncryptionOptions {
  /** The API base, so a test can stand in for it. Never settable from the environment. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

/**
 * Key wrapping through Cloud KMS, over its REST API (PROJECT.md 4.13.4).
 *
 * One symmetric key per **cell**, not per project: the per-project keys are what this wraps, and
 * they live as ciphertext in the cell's own database. That is what keeps fixed cost per tenant at
 * zero, which §5.2 requires and a key-per-project cannot deliver.
 *
 * **The checksums are the reason this is more than two fetches.** KMS accepts a CRC32C of what you
 * send and returns one for what it sends back, and verifying both is how corruption in transit is
 * caught. It matters more here than almost anywhere else in the system: a silently corrupted
 * ciphertext is key material that cannot be unwrapped, discovered at the moment somebody's project
 * can no longer mint a token, with no way back. `verifiedPlaintextCrc32c` coming back false means
 * KMS itself saw the request as damaged, and that is a failure rather than a warning.
 *
 * Reached over REST with `fetch` rather than `@google-cloud/kms`, which would drag gax, grpc-js and
 * protobufjs onto the path holding every key we have — §7.6 prefers one audited library over three
 * convenient ones, and that one is `google-auth-library` for the credential.
 */
export class KmsKeyEncryption extends KeyEncryption {
  /**
   * @param keyName Full resource path: `projects/p/locations/l/keyRings/r/cryptoKeys/k`.
   */
  constructor(
    private readonly keyName: string,
    private readonly tokens: AccessTokenSource = new AdcTokenSource(),
    private readonly options: KmsKeyEncryptionOptions = {},
  ) {
    super();
  }

  override async wrap(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    const body = await this.call("encrypt", {
      plaintext: Buffer.from(plaintext).toString("base64"),
      plaintextCrc32c: crc32cString(plaintext),
      additionalAuthenticatedData: Buffer.from(context, "utf8").toString("base64"),
      additionalAuthenticatedDataCrc32c: crc32cString(Buffer.from(context, "utf8")),
    });

    const parsed = encryptSchema.safeParse(body);
    if (!parsed.success) throw this.malformed("encrypt");

    // KMS telling us it could not verify what it received. The request was damaged in flight, and
    // proceeding would store a ciphertext derived from bytes we did not send.
    if (parsed.data.verifiedPlaintextCrc32c === false) {
      throw new InternalError({
        detail: {
          operation: "encrypt",
          key: this.keyName,
          reason: "KMS did not verify the plaintext checksum: the request was corrupted in transit",
        },
      });
    }

    const ciphertext = Buffer.from(parsed.data.ciphertext, "base64");
    this.assertChecksum("encrypt", ciphertext, parsed.data.ciphertextCrc32c);
    return ciphertext;
  }

  override async unwrap(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    const body = await this.call("decrypt", {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      ciphertextCrc32c: crc32cString(ciphertext),
      additionalAuthenticatedData: Buffer.from(context, "utf8").toString("base64"),
      additionalAuthenticatedDataCrc32c: crc32cString(Buffer.from(context, "utf8")),
    });

    const parsed = decryptSchema.safeParse(body);
    if (!parsed.success) throw this.malformed("decrypt");

    const plaintext = Buffer.from(parsed.data.plaintext, "base64");
    this.assertChecksum("decrypt", plaintext, parsed.data.plaintextCrc32c);
    return plaintext;
  }

  private async call(
    operation: "encrypt" | "decrypt",
    payload: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const base = this.options.endpoint ?? API;
    const response = await fetch(`${base}/${this.keyName}:${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.tokens.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new InternalError({
        // The status and the key, never the body: a failed KMS call is the last place to relax
        // about what is echoed into a log line.
        detail: { operation, key: this.keyName, status: response.status, reason: "KMS refused" },
      });
    }
    return response.json();
  }

  /**
   * Checks what came back against what KMS said it sent.
   *
   * A missing checksum is treated as a failure rather than skipped. KMS always returns one, so its
   * absence means the response is not the shape we think — and "verify when present" is how a
   * corruption check quietly becomes optional.
   */
  private assertChecksum(
    operation: "encrypt" | "decrypt",
    bytes: Uint8Array,
    expected: string | undefined,
  ): void {
    const actual = crc32cString(bytes);
    if (expected === actual) return;
    throw new InternalError({
      detail: {
        operation,
        key: this.keyName,
        expected: expected ?? "absent",
        actual,
        reason: "the KMS response failed its checksum: key material was corrupted in transit",
      },
    });
  }

  private malformed(operation: string): InternalError {
    return new InternalError({
      detail: {
        operation,
        key: this.keyName,
        reason: "the KMS response was not the shape we expect",
      },
    });
  }
}
