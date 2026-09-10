/**
 * What a project decides about authenticator apps, and what it cannot.
 *
 * The decidable part is two things: whether the method exists on the project, and the
 * name an app files the account under. Everything about the code is fixed by the server
 * on purpose (apps/auth-api/src/mfa, packages/crypto/src/mfa/totp.ts) and is listed
 * here so the screen states it: RFC 6238 at its defaults, because several authenticator
 * apps ignore the parameters in the URI and anything else enrols a factor whose codes we
 * would refuse.
 *
 * Whether an account owes a second factor is the account's and not the project's:
 * holding an authenticator is what puts a challenge in front of every sign-in on it. A
 * project-wide requirement is on the roadmap and not built, and the screen says so
 * rather than offering a switch that does nothing.
 */

/** The code as every authenticator app generates it. Any other value enrols a factor whose codes are refused. */
export const TOTP = {
  algorithm: "SHA-1",
  digits: 6,
  periodSeconds: 30,
  /** RFC 4226's recommendation, and what the URI form assumes. */
  secretBits: 160,
  /** Steps accepted either side of now. Ninety seconds in all, and never more. */
  skewSteps: 1,
  /** Wrong codes on one challenge before it dies. */
  attempts: 5,
  /** The deployment's `MFA_CHALLENGE_TTL_SECONDS`, whose default this is. */
  challengeSeconds: 300,
  /** `STEP_UP_MAX_AGE_SECONDS`: how recent a proof has to be for a sensitive action. */
  stepUpSeconds: 900,
  /** The user's own name for the app, on their security screen. */
  labelMaxLength: 100,
  /** Issued with the first factor an account enrols. */
  recoveryCodes: 10,
} as const;

export interface AuthenticatorSettings {
  /** Users may enrol an app from a session, and are asked for its code afterwards. */
  enabled: boolean;
  /** What the app files the account under. Null falls back to the project's name. */
  issuer: string | null;
}

export const DEFAULT_AUTHENTICATOR_SETTINGS: AuthenticatorSettings = {
  enabled: true,
  issuer: null,
};

/*
 * The issuer.
 *
 * It appears in the app's own list beside the account, so it is the product's name and
 * short: a long one is cut off in every app there is. A colon is allowed because the
 * server percent-encodes the label, which is what stops one from splitting it into a
 * different account.
 */
export const ISSUER_MAX_LENGTH = 64;

export type IssuerIssue = "issuer_empty" | "issuer_long";

export const ISSUER_ISSUE_LABELS: Record<IssuerIssue, string> = {
  issuer_empty: "The app shows this beside the account, so it cannot be blank.",
  issuer_long: `At most ${ISSUER_MAX_LENGTH} characters. Every app cuts a long one off.`,
};

export function validateIssuer(value: string): IssuerIssue | null {
  const text = value.trim();
  if (text === "") return "issuer_empty";
  if (text.length > ISSUER_MAX_LENGTH) return "issuer_long";
  return null;
}

/**
 * The `otpauth://` URI as the server builds it, for the preview.
 *
 * The issuer appears twice on purpose: in the label for apps that only parse the label,
 * and as a parameter for apps that read it properly. Both halves of the label are
 * percent-encoded, because a project name is customer text and a colon in it would
 * otherwise split the label into a different account.
 */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP.digits),
    period: String(TOTP.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** A base32 secret of the right length that is not one. The screen mints nothing. */
export const SAMPLE_SECRET = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U";

/** The address the preview files the sample under. */
export const SAMPLE_ACCOUNT = "user@example.com";

/** Groups of four, as a secret is shown to somebody who cannot scan. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/** "482 913", as an app shows a code: two groups, because six digits read as a number. */
export function groupCode(code: string): string {
  return code.length === TOTP.digits ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/*
 * The factor family, for the card that says what may answer a challenge.
 *
 * Two facts per factor and they are not the same fact. `demands` is whether holding it
 * puts a challenge in front of every sign-in on the account, which only an authenticator
 * does. `answers` is which challenges it may complete: a recovery code answers a sign-in
 * and never a step-up, because it is single use and exists for a lost phone, and spending
 * one to confirm an email change spends the wrong thing.
 */
export type MfaFactorKind = "passkey" | "totp" | "recovery" | "sms";

export interface FactorRole {
  kind: MfaFactorKind;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  demands: boolean;
  answers: { signIn: boolean; stepUp: boolean };
  /** False for a name in the enum with no factor behind it yet. */
  available: boolean;
  note: string;
}

/** In the prompting order, strongest first: a customer's form offers the first and puts the rest behind "try another way". */
export const FACTOR_ROLES: readonly FactorRole[] = [
  {
    kind: "passkey",
    label: "Passkey",
    icon: "material-symbols:passkey",
    demands: false,
    answers: { signIn: true, stepUp: true },
    available: true,
    note: "Offered first, because it is the one factor phishing cannot carry away. Enrolling one never turns two-factor on: a credential somebody added to sign in with must not start demanding itself on top of their password.",
  },
  {
    kind: "totp",
    label: "Authenticator app",
    icon: "material-symbols:timer-outline",
    demands: true,
    answers: { signIn: true, stepUp: true },
    available: true,
    note: "The one factor that demands a challenge. Holding a confirmed authenticator is what puts a code in front of every password and one-time-code sign-in on the account.",
  },
  {
    kind: "recovery",
    label: "Recovery code",
    icon: "material-symbols:key-outline",
    demands: false,
    answers: { signIn: true, stepUp: false },
    available: true,
    note: "Ten single-use codes for a lost phone, issued with the first factor and gone with the last. They answer a sign-in and never a step-up, which already has a session and a cheaper way to ask.",
  },
  {
    kind: "sms",
    label: "SMS code",
    icon: "material-symbols:sms-outline",
    demands: false,
    answers: { signIn: false, stepUp: false },
    available: false,
    note: "A name in the factor enum with nothing behind it yet. It waits on a vendor adapter like the one-time-code channel does, and on the same fraud controls in front of every send.",
  },
];
