/**
 * What a project can decide about passwords, and what it cannot.
 *
 * The decidable part is small on purpose (PROJECT.md 4.5): the method's on-off, the
 * floor on length, whether a breach corpus is consulted, whether failed attempts lock an
 * account, and how a reset behaves. What it does not offer is composition rules, because
 * NIST 800-63B says they make passwords worse and the protocol's `passwordSchema` is a
 * length bound and nothing more. The screen says so rather than hiding the omission.
 *
 * The fixed facts are listed here too, so the screen and the tests read them from one
 * place: the ceiling on length, the hash and its parameters, the normalisation.
 */

import { HASH_LABELS, type HashKind } from "./import";

/** The protocol's bounds. The floor a project sets can only move up from the first. */
export const LENGTH_FLOOR = 8;
export const LENGTH_CEILING = 256;
/** The most a project may demand: past this a policy stops people, not guessers. */
export const LENGTH_FLOOR_MAX = 64;

export const LOCKOUT_ATTEMPTS_MIN = 3;
export const LOCKOUT_ATTEMPTS_MAX = 50;

export type ResetLifetime = 10 | 15 | 30 | 60;

export const RESET_LIFETIMES: readonly ResetLifetime[] = [10, 15, 30, 60];

export interface PasswordPolicy {
  /** Sign in and sign up with an email and a password at all. */
  enabled: boolean;
  /** New accounts may set one. Off keeps passwords for the accounts that already have one. */
  allowSignUp: boolean;
  minLength: number;
  /** Refuse a password found in a breach corpus, at sign-up and at reset. */
  breachCheck: boolean;
  /** Lock the account after repeated failures. Off by default: see `LOCKOUT_NOTE`. */
  lockout: boolean;
  lockoutAttempts: number;
  /** How long a reset link stays valid. */
  resetLifetime: ResetLifetime;
  /** End every other session when a password is reset. */
  signOutOnReset: boolean;
  /** Send the `password_changed` email when a password changes. */
  notifyOnChange: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  enabled: true,
  allowSignUp: true,
  minLength: LENGTH_FLOOR,
  breachCheck: true,
  lockout: false,
  lockoutAttempts: 10,
  resetLifetime: 15,
  signOutOnReset: true,
  notifyOnChange: true,
};

/**
 * How passwords are stored (PROJECT.md 4.5, `packages/crypto/src/hashing`). Read-only,
 * and shown so nobody has to ask. `phcVersion` is Argon2's own version number, which is
 * written into every hash and is not our `version`.
 */
export const HASHING = {
  algorithm: "Argon2id",
  memoryMiB: 64,
  iterations: 3,
  parallelism: 1,
  version: 1,
  phcVersion: 19,
  pepper: "Cloud KMS",
  normalisation: "NFKC",
} as const;

/**
 * A stored hash exactly as it is written: variant, Argon2's version, the parameters,
 * the salt and the digest.
 *
 * The parameter order is `m,p,t` because that is what the argon2 library emits, not the
 * `m,t,p` everyone writes from memory. Getting it wrong here would put a string on the
 * screen that no hash of ours matches, and it is the same mistake that once made
 * `needsRehash` rehash every password on every sign-in.
 */
export const SAMPLE_HASH = `$argon2id$v=${HASHING.phcVersion}$m=${HASHING.memoryMiB * 1024},p=${HASHING.parallelism},t=${HASHING.iterations}$kQ3rV9pXbN2sLm8dT1yZfA$9tHc6vRk1LdQm4Xy0BsWfE2nJpZgA7uYcT3iOrN5hVQ`;

/** The parameters inside that string, so a reader can match each one to its meaning. */
export const HASH_PARAMETERS: readonly { field: string; value: string; means: string }[] = [
  {
    field: "m",
    value: String(HASHING.memoryMiB * 1024),
    means: `${HASHING.memoryMiB} MB of memory per hash`,
  },
  {
    field: "p",
    value: String(HASHING.parallelism),
    means: "one lane, so the cost cannot be split",
  },
  { field: "t", value: String(HASHING.iterations), means: "three passes over that memory" },
];

/**
 * The formats a stored password can be in. Ours is Argon2id; the rest arrive with an
 * import and are verify-only, so nothing can create a credential in one of them.
 */
export type StoredFormat = Extract<HashKind, "argon2" | "bcrypt" | "scrypt" | "pbkdf2">;

/** Where each format is usually met, which is the part an operator recognises. */
const FORMAT_SOURCES: Record<StoredFormat, string> = {
  bcrypt: "Auth0, Supabase, Clerk, and most Rails and Node applications",
  scrypt: "Firebase, whose export carries the parameters beside the digest",
  argon2: "Cognito, and anything already following current advice",
  pbkdf2: "Django, and the .NET identity stack",
};

/**
 * The formats a password can arrive in and still work. Labels come from the import
 * screen rather than being spelled again here, so there is one answer to what bcrypt is
 * called.
 *
 * Argon2 is on the list as something imported as well as what we write, because a hash
 * in the family is still rehashed unless it is Argon2id at this version and at least
 * these parameters.
 */
export const IMPORTED_FORMATS: readonly { kind: StoredFormat; label: string; source: string }[] = (
  ["bcrypt", "scrypt", "argon2", "pbkdf2"] as const
).map((kind) => ({ kind, label: HASH_LABELS[kind], source: FORMAT_SOURCES[kind] }));

/** The digests an import refuses, listed because the reason is not that they are old. */
export const REFUSED_FORMATS: readonly string[] = (["md5", "sha1", "sha256"] as const).map(
  (kind) => HASH_LABELS[kind],
);

/** Accounts by the format their password hash is in. */
export interface StoredCounts {
  /** Argon2id at the parameters above, which is nothing to do. */
  current: number;
  /** Imported hashes still in the format they arrived in, by format. */
  legacy: Record<StoredFormat, number>;
}

/** One row of the standing: a format, how many accounts hold it, and its share. */
export interface StoredMixRow {
  id: "current" | StoredFormat;
  label: string;
  count: number;
  /** Of every account holding a password, as a percentage, for the bar. */
  share: number;
  /** Whether the row needs nothing done to it. */
  current: boolean;
}

/**
 * How a project's stored passwords stand: what is already Argon2id and what is still in
 * the format it was imported in.
 *
 * The current row is always drawn, including at zero, because "none of your passwords
 * are on the current hash yet" is the answer somebody mid-migration is looking for. A
 * legacy format nobody holds is left out rather than drawn as an empty bar.
 */
export function storedMix(counts: StoredCounts): StoredMixRow[] {
  const total =
    counts.current + Object.values(counts.legacy).reduce((sum, count) => sum + count, 0);
  const share = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

  const legacy = IMPORTED_FORMATS.filter(({ kind }) => counts.legacy[kind] > 0)
    .map(({ kind, label }) => ({
      id: kind,
      label,
      count: counts.legacy[kind],
      share: share(counts.legacy[kind]),
      current: false,
    }))
    .sort((left, right) => right.count - left.count);

  return [
    {
      id: "current" as const,
      label: HASHING.algorithm,
      count: counts.current,
      share: share(counts.current),
      current: true,
    },
    ...legacy,
  ];
}

export const LOCKOUT_NOTE =
  "Lockout is off by default because it is a way to lock the victim out: anyone who knows an address can fail at it on purpose. Adaptive rate limiting per account and per address is always on and slows a guesser without that cost.";

export type PolicyIssue = "min_length_range" | "min_length_integer" | "lockout_attempts_range";

export const POLICY_ISSUE_LABELS: Record<PolicyIssue, string> = {
  min_length_range: `Between ${LENGTH_FLOOR} and ${LENGTH_FLOOR_MAX} characters.`,
  min_length_integer: "A whole number of characters.",
  lockout_attempts_range: `Between ${LOCKOUT_ATTEMPTS_MIN} and ${LOCKOUT_ATTEMPTS_MAX} attempts.`,
};

export function validatePolicy(policy: PasswordPolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (!Number.isInteger(policy.minLength)) issues.push("min_length_integer");
  else if (policy.minLength < LENGTH_FLOOR || policy.minLength > LENGTH_FLOOR_MAX) {
    issues.push("min_length_range");
  }
  if (
    policy.lockout &&
    (!Number.isInteger(policy.lockoutAttempts) ||
      policy.lockoutAttempts < LOCKOUT_ATTEMPTS_MIN ||
      policy.lockoutAttempts > LOCKOUT_ATTEMPTS_MAX)
  ) {
    issues.push("lockout_attempts_range");
  }
  return issues;
}

/**
 * The rules a user's form is told, in the words the SDK's error codes map to. What the
 * screen shows under "What users are told", so the policy and the promise agree.
 */
export function requirementsOf(policy: PasswordPolicy): string[] {
  const rules = [
    `At least ${policy.minLength} characters, at most ${LENGTH_CEILING}.`,
    "Any characters at all: letters, digits, spaces, emoji. Nothing has to be mixed in.",
  ];
  if (policy.breachCheck) rules.push("Not one that has appeared in a known breach.");
  return rules;
}

/*
 * What a folded section says in its heading.
 *
 * A card that closes over its own settings makes an operator open all three to answer
 * "what is the policy", so each one carries its saved values in the strip. They are
 * assembled here rather than in the template because the same words belong in a summary
 * an audit reads later, and because a heading that disagreed with the rows inside it
 * would be worse than no heading at all.
 */

/** "12 characters, breach check on". */
export function requirementsSummary(policy: PasswordPolicy): string {
  return `${policy.minLength} characters, breach check ${policy.breachCheck ? "on" : "off"}`;
}

/** "15-minute link, other sessions end". */
export function resetSummary(policy: PasswordPolicy): string {
  const sessions = policy.signOutOnReset ? "other sessions end" : "other sessions stay";
  return `${policy.resetLifetime}-minute link, ${sessions}`;
}

/** "Locks after 5 attempts" or "No lockout". */
export function attemptsSummary(policy: PasswordPolicy): string {
  if (!policy.lockout) return "Rate limited, no lockout";
  return `Locks after ${policy.lockoutAttempts} attempts`;
}

/** Whether a draft differs from what is saved, which is what enables Save. */
export function policyChanged(saved: PasswordPolicy, draft: PasswordPolicy): boolean {
  return (Object.keys(saved) as (keyof PasswordPolicy)[]).some((key) => saved[key] !== draft[key]);
}
