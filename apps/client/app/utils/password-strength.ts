/**
 * An advisory estimate of how much work a password costs to guess, plus the handful of
 * things that would improve it.
 *
 * The list is worded as guidance rather than as rules, and that wording is the point.
 * PROJECT.md 4.5 sets no composition requirements (NIST 800-63B): a capital letter and a
 * digit are not demanded, and a form that said "must contain" would be announcing a policy
 * the server does not enforce. Length is the one hard rule, so it is the one item marked
 * required.
 *
 * What none of this knows: whether the password has appeared in a breach. That check is
 * the server's, runs against HIBP at sign-up, and can refuse a password this meter called
 * strong. So the bar advises and the server decides.
 */

/**
 * The only hard bounds, mirroring `passwordSchema` in
 * `packages/protocol/src/schemas/common.ts`. Restated rather than imported because this
 * panel takes no first-party dependency yet; it gets one when the SDK is wired, and these
 * two should come from the protocol at that point.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/** Where a password stops gaining much from another character. */
const COMFORTABLE_LENGTH = 12;

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordRequirement {
  id: string;
  label: string;
  met: boolean;
  /** True only for the rule that actually blocks a submit. */
  required: boolean;
}

export interface PasswordStrength {
  score: PasswordScore;
  label: string;
  /** A Vuetify theme colour, for the filled segments and the label. */
  color: string;
  bits: number;
  requirements: readonly PasswordRequirement[];
}

/**
 * How many characters a guesser has to consider per position. Anything outside ASCII falls
 * in the last bucket, which understates a Unicode password and never overstates one, and
 * erring low is the only direction that is safe here.
 */
const CHARACTER_CLASSES = [
  { pattern: /[a-z]/, size: 26 },
  { pattern: /[A-Z]/, size: 26 },
  { pattern: /\d/, size: 10 },
  { pattern: /[^a-z\d]/i, size: 33 },
] as const;

/** Runs a guesser walks before it starts guessing at random. */
const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
] as const;

/**
 * Deliberately tiny. A real corpus is megabytes and belongs behind the breach check that
 * already runs at sign-up; these are here so the handful of passwords people actually reach
 * for first are called what they are rather than scored on their length.
 */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "welcome1",
  "admin123",
  "letmein1",
  "monkey123",
  "abc12345",
  "trustno1",
]);

/** True when `b` follows `a` in a run a guesser would try, in either direction. */
function continuesSequence(a: string, b: string): boolean {
  const lower = `${a}${b}`.toLowerCase();
  const reversed = `${b}${a}`.toLowerCase();
  return SEQUENCES.some((run) => run.includes(lower) || run.includes(reversed));
}

/**
 * Length after discounting the positions a guesser gets cheaply. A character that repeats
 * the one before it, or continues a run with it, is worth half a position rather than a
 * whole one: "aaaaaaaa" and "abcdefgh" are eight characters and nothing like eight choices.
 */
function effectiveLength(value: string): number {
  let total = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    const previous = index > 0 ? (value[index - 1] as string) : null;
    const cheap =
      previous !== null && (previous === character || continuesSequence(previous, character));

    total += cheap ? 0.5 : 1;
  }

  return total;
}

function poolSize(value: string): number {
  return CHARACTER_CLASSES.reduce(
    (size, klass) => (klass.pattern.test(value) ? size + klass.size : size),
    0,
  );
}

function requirementsFor(value: string): readonly PasswordRequirement[] {
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: value.length >= PASSWORD_MIN_LENGTH,
      required: true,
    },
    {
      id: "comfortable",
      label: `${COMFORTABLE_LENGTH} characters or more`,
      met: value.length >= COMFORTABLE_LENGTH,
      required: false,
    },
    {
      id: "mixed-case",
      label: "Upper and lower case",
      met: /[a-z]/.test(value) && /[A-Z]/.test(value),
      required: false,
    },
    {
      id: "varied",
      label: "A number or a symbol",
      met: /[^a-z]/i.test(value),
      required: false,
    },
  ];
}

export function measurePasswordStrength(value: string): PasswordStrength {
  const requirements = requirementsFor(value);

  if (value.length === 0) {
    return { score: 0, label: "", color: "neutral", bits: 0, requirements };
  }

  const pool = poolSize(value);
  const bits = OBVIOUS.has(value.toLowerCase())
    ? 0
    : Math.round(effectiveLength(value) * Math.log2(Math.max(pool, 2)));

  const tooShort = value.length < PASSWORD_MIN_LENGTH;
  const score: PasswordScore = tooShort || bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;

  return {
    score,
    label: (["", "Weak", "Fair", "Good", "Strong"] as const)[score],
    // Three colours across four steps: the number of filled segments carries the
    // difference between good and strong, and a fourth hue would imply a distinction that
    // is not there.
    color: (["neutral", "error", "warning", "success", "success"] as const)[score],
    bits,
    requirements,
  };
}
