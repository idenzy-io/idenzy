import { randomBytes } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import type { KeyEncryption } from "../kms/key-encryption.js";
import { developmentDataKey } from "./development-key.js";
import { FieldEncryptor } from "./field-encryptor.js";

/** What the field key is wrapped under, so a wrapped signing key can never be opened as one. */
export const FIELD_KEY_CONTEXT = "idenzy:field-encryption";

/**
 * A new data key for field encryption, wrapped and ready to store as `FIELD_KEY_WRAPPED`.
 *
 * Made once per deployment by the bootstrap command. The plaintext exists only in this function.
 */
export async function generateWrappedFieldKey(wrapping: KeyEncryption): Promise<string> {
  const key = randomBytes(32);
  try {
    return Buffer.from(await wrapping.wrap(key, FIELD_KEY_CONTEXT)).toString("base64");
  } finally {
    key.fill(0);
  }
}

/**
 * The deployment's field encryptor (PROJECT.md 4.13.4, ADR-0021).
 *
 * One data key for the deployment, stored only wrapped by KMS and unwrapped once at boot, so
 * `encrypt` and `decrypt` stay synchronous and cost no network call. Every value is bound to its
 * project as authenticated data already, so a ciphertext moved to another project's row does not
 * open.
 *
 * Development keeps the key it always derived, so a local database written before this still
 * reads. Anywhere else a missing `FIELD_KEY_WRAPPED` stops the process: a deployment encrypting
 * personal data under a key printed in the source would be worse than one that does not start.
 */
export async function fieldEncryptorFor(
  environment: string,
  wrapped: string | undefined,
  wrapping: KeyEncryption,
): Promise<FieldEncryptor> {
  if (environment === "development") return new FieldEncryptor(developmentDataKey(environment));
  if (wrapped === undefined) {
    throw new InternalError({
      detail: {
        reason: "FIELD_KEY_WRAPPED is not set",
        rule: "field encryption uses a KMS-wrapped key outside development (PROJECT.md 4.13.4)",
      },
    });
  }
  const key = await wrapping.unwrap(Buffer.from(wrapped, "base64"), FIELD_KEY_CONTEXT);
  return new FieldEncryptor(Buffer.from(key));
}
