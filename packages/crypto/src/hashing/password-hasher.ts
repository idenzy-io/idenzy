import { InternalError } from "@idenzy/core/errors";
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

  /**
   * Compares the parameters recorded inside the hash with the current ones.
   *
   * Parsed rather than prefix-matched, because the encoded parameter order is the
   * library's choice and not ours: argon2 emits `m,p,t`, so matching the literal
   * `m=65536,t=3,p=1` never succeeded and every sign-in rehashed forever.
   *
   * Memory and time use `<` rather than `!=`, so a hash produced under stronger settings
   * is left alone instead of being quietly downgraded.
   */
  override needsRehash(hash: string): boolean {
    const parsed = parseArgon2(hash);
    if (parsed === null) return true;
    return (
      parsed.variant !== "argon2id" ||
      parsed.version !== 19 ||
      parsed.memoryCost < ARGON2_OPTIONS.memoryCost ||
      parsed.timeCost < ARGON2_OPTIONS.timeCost ||
      parsed.parallelism !== ARGON2_OPTIONS.parallelism
    );
  }
}

interface Argon2Parameters {
  readonly variant: string;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/** PHC string: `$argon2id$v=19$m=65536,p=1,t=3$salt$digest`. Null when it is not one. */
function parseArgon2(hash: string): Argon2Parameters | null {
  const parts = hash.split("$");
  const [, variant, versionField, parameterField] = parts;
  if (parts.length < 6 || variant === undefined || parameterField === undefined) return null;

  const version = Number(versionField?.replace("v=", ""));
  const parameters = new Map(
    parameterField.split(",").map((pair) => {
      const [key, value] = pair.split("=");
      return [key ?? "", Number(value)] as const;
    }),
  );
  const memoryCost = parameters.get("m");
  const timeCost = parameters.get("t");
  const parallelism = parameters.get("p");
  if (memoryCost === undefined || timeCost === undefined || parallelism === undefined) return null;
  if (!Number.isFinite(version)) return null;

  return { variant, version, memoryCost, timeCost, parallelism };
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
