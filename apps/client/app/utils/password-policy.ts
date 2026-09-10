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

/** How passwords are stored. Read-only, and shown so nobody has to ask. */
export const HASHING = {
  algorithm: "Argon2id",
  memoryMiB: 64,
  iterations: 3,
  parallelism: 1,
  version: 1,
  pepper: "Cloud KMS",
  normalisation: "NFKC",
} as const;

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
