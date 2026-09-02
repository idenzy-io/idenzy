import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { InternalError } from "@idenzy/core/errors/errors";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

/**
 * Field-level envelope encryption (PROJECT.md 4.13.4).
 *
 * Sits above encryption at rest, for columns that need a smaller blast radius than the
 * whole disk: provider OAuth tokens, TOTP secrets, and anything a HIPAA-tier project
 * marks as PHI. The data key is per project, wrapped by the cell KMS key, so
 * compromising one project's key exposes exactly one tenant.
 *
 * AES-256-GCM, so a tampered ciphertext fails authentication rather than decrypting to
 * something attacker-influenced. The version byte exists so the algorithm can be
 * migrated without guessing at the format of old rows.
 */
export class FieldEncryptor {
  constructor(private readonly dataKey: Buffer) {
    if (dataKey.length !== 32) {
      throw new InternalError({ detail: { reason: "data key must be 32 bytes for aes-256-gcm" } });
    }
  }

  /**
   * `projectId` is bound as additional authenticated data, so ciphertext copied from one
   * tenant's row into another's fails to decrypt instead of silently succeeding.
   */
  encrypt(plaintext: string, projectId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.dataKey, iv);
    cipher.setAAD(Buffer.from(projectId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }

  decrypt(encoded: string, projectId: string): string {
    const raw = Buffer.from(encoded, "base64");
    const version = raw[0];
    if (version !== VERSION) {
      throw new InternalError({ detail: { reason: "unknown ciphertext version", version } });
    }
    const iv = raw.subarray(1, 1 + IV_BYTES);
    const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(1 + IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.dataKey, iv);
    decipher.setAAD(Buffer.from(projectId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
