import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import { KeyEncryption } from "./key-encryption.js";

/**
 * AES-256-GCM under a key this process holds, with the context as authenticated data.
 *
 * Development and tests only: what makes the production envelope worth having is that the
 * wrapping key never leaves KMS, and this one is in memory by definition. It has the same
 * contract as `KmsKeyEncryption` — a wrong context fails to open — so the code above it runs
 * the production path everywhere, and only the key's home differs.
 *
 * The layout is `iv (12) | tag (16) | ciphertext`.
 */
export class LocalKeyEncryption extends KeyEncryption {
  constructor(private readonly kek: Buffer) {
    super();
    if (kek.length !== 32) {
      throw new InternalError({ detail: { reason: "the wrapping key must be 32 bytes" } });
    }
  }

  override wrap(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  override unwrap(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    const raw = Buffer.from(ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", this.kek, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Promise.resolve(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]));
  }
}
