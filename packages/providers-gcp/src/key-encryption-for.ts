import { InternalError } from "@idenzy/core/errors";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import type { KeyEncryption } from "@idenzy/crypto/kms/key-encryption";
import { LocalKeyEncryption } from "@idenzy/crypto/kms/local-key-encryption";
import { KmsKeyEncryption } from "./kms-key-encryption.js";

/**
 * The wrapping every key in a deployment is opened with (ADR-0021).
 *
 * Cloud KMS anywhere but development, where it is a key derived in the process so the code above
 * runs the same path without a cloud account. Outside development a missing `KMS_KEY_NAME` stops
 * the process rather than falling back: a key derived from a constant would let anybody with the
 * source open what it wraps.
 */
export function keyEncryptionFor(
  environment: string,
  kmsKeyName: string | undefined,
): KeyEncryption {
  if (environment === "development") {
    return new LocalKeyEncryption(developmentDataKey(`${environment}:key-wrapping`));
  }
  if (kmsKeyName === undefined) {
    throw new InternalError({
      detail: {
        reason: "KMS_KEY_NAME is not set",
        rule: "keys are wrapped by Cloud KMS outside development (ADR-0021)",
      },
    });
  }
  return new KmsKeyEncryption(kmsKeyName);
}
