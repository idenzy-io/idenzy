import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { developmentDataKey } from "../src/encryption/development-key.js";
import { FieldEncryptor } from "../src/encryption/field-encryptor.js";
import { fieldEncryptorFor, generateWrappedFieldKey } from "../src/encryption/field-key.js";
import { LocalKeyEncryption } from "../src/kms/local-key-encryption.js";
import { generateSigningKey } from "../src/tokens/wrapped-es256-issuer.js";

const PROJECT = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";

describe("the deployment's field key", () => {
  it("is stored wrapped and opens into an encryptor that round-trips", async () => {
    const wrapping = new LocalKeyEncryption(randomBytes(32));
    const wrapped = await generateWrappedFieldKey(wrapping);
    expect(Buffer.from(wrapped, "base64").length).toBeGreaterThan(32);

    const encryptor = await fieldEncryptorFor("production", wrapped, wrapping);
    const sealed = encryptor.encrypt("ada@example.test", PROJECT);
    // A second boot opens the same key, so what one process wrote another reads.
    const again = await fieldEncryptorFor("production", wrapped, wrapping);
    expect(again.decrypt(sealed, PROJECT)).toBe("ada@example.test");
  });

  it("stops a deployed process that was not given one", async () => {
    const wrapping = new LocalKeyEncryption(randomBytes(32));
    await expect(fieldEncryptorFor("production", undefined, wrapping)).rejects.toThrowError();
  });

  /** The context is what keeps the two kinds of wrapped key from standing in for each other. */
  it("cannot be opened from a signing key's ciphertext", async () => {
    const wrapping = new LocalKeyEncryption(randomBytes(32));
    const signing = await generateSigningKey(PROJECT, wrapping);
    await expect(
      fieldEncryptorFor("production", signing.privateKeyWrapped, wrapping),
    ).rejects.toThrowError();
  });

  it("is the key development always derived, so a local database still reads", async () => {
    const sealed = new FieldEncryptor(developmentDataKey("development")).encrypt("x", PROJECT);
    const encryptor = await fieldEncryptorFor(
      "development",
      undefined,
      new LocalKeyEncryption(randomBytes(32)),
    );
    expect(encryptor.decrypt(sealed, PROJECT)).toBe("x");
  });
});
