import { InternalError } from "@idenzy/core/errors/errors";
import argon2 from "argon2";

export interface HashResult {
  readonly hash: string;
  readonly algorithmVersion: number;
}

/**
 * Password hashing (PROJECT.md 4.5).
 *
 * `needsRehash` is what makes an imported bcrypt or scrypt hash upgradeable in place:
 * verify with the legacy algorithm, then rehash with Argon2id on the next successful
 * login, so a migration never asks users to reset their password.
 */
export abstract class PasswordHasher {
  abstract readonly algorithmVersion: number;
  abstract hash(plaintext: string): Promise<HashResult>;
  abstract verify(hash: string, plaintext: string): Promise<boolean>;
  abstract needsRehash(hash: string): boolean;
}

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Argon2id at 64 MB, t=3, p=1.
 *
 * Parameters are recorded inside the hash string, so raising them later upgrades
 * existing users transparently through needsRehash rather than invalidating them.
 */
export class Argon2idHasher extends PasswordHasher {
  override readonly algorithmVersion = 1;

  constructor(private readonly pepper: Buffer | undefined = undefined) {
    super();
  }

  override async hash(plaintext: string): Promise<HashResult> {
    const hash = await argon2.hash(plaintext.normalize("NFKC"), {
      ...ARGON2_OPTIONS,
      ...(this.pepper === undefined ? {} : { secret: this.pepper }),
    });
    return { hash, algorithmVersion: this.algorithmVersion };
  }

  override async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext.normalize("NFKC"), {
        ...(this.pepper === undefined ? {} : { secret: this.pepper }),
      });
    } catch {
      // A malformed stored hash is a verification failure, never a 500 that tells an
      // attacker their input reached something unusual.
      return false;
    }
  }

  override needsRehash(hash: string): boolean {
    return !hash.startsWith("$argon2id$v=19$m=65536,t=3,p=1");
  }
}

/**
 * Verify-only hashers for imported credentials (PROJECT.md 9.5).
 *
 * They cannot hash, only verify, so an import path can never create new credentials in
 * a legacy format. needsRehash always returns true, which upgrades the user to Argon2id
 * on their next successful login.
 */
export abstract class LegacyVerifyOnlyHasher extends PasswordHasher {
  override hash(_plaintext: string): Promise<HashResult> {
    return Promise.reject(
      new InternalError({
        detail: { reason: "legacy hashers verify imported credentials only" },
      }),
    );
  }

  override needsRehash(_hash: string): boolean {
    return true;
  }
}
