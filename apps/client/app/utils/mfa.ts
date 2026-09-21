/**
 * What a project decides about authenticator apps, and what it cannot.
 *
 * The decidable part is two things: whether the method exists on the project, and the
 * name an app files the account under. Everything about the code is fixed by the server
 * on purpose (apps/api/src/mfa, packages/crypto/src/mfa/totp.ts) and is listed
 * here so the screen states it: RFC 6238 at its defaults, because several authenticator
 * apps ignore the parameters in the URI and anything else enrols a factor whose codes we
 * would refuse.
 *
 * Whether an account owes a second factor is the account's and not the project's:
 * holding an authenticator is what puts a challenge in front of every sign-in on it. A
 * project-wide requirement is on the roadmap and not built, and the screen says so
 * rather than offering a switch that does nothing.
 *
 * That last paragraph is the reason for most of what follows. Available and required are
 * different states, and the screen has to answer the second question before a reader
 * touches a control, so who is challenged is worked out here as a sentence and as a
 * matrix rather than being left to a badge that only knows the switch.
 */

import { plural } from "./setup-check";

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

/*
 * Coverage.
 *
 * Two numbers, read three times on the screen: as the scope strip's answer to whether a
 * code is required, as the sentence beside the switch that is about to stop demanding
 * one, and as the tiles at the foot. Worked out here so the three cannot disagree, and
 * pure so the disable dialog can state the same count it is about to affect.
 */
export interface AuthenticatorCoverage {
  /** Accounts holding a confirmed authenticator, and therefore challenged at sign-in. */
  enrolled: number;
  accounts: number;
  /** Accounts signing in with one factor, because they hold no authenticator. */
  withoutOne: number;
  /** Percent of accounts holding one, rounded. A project with no accounts is 0, not NaN. */
  share: number;
}

export function coverageOf(enrolled: number, accounts: number): AuthenticatorCoverage {
  /* Clamped, because `withoutOne` is drawn as a count of people and a negative one would
     be rendered rather than caught. */
  const held = Math.max(0, Math.min(enrolled, accounts));
  return {
    enrolled: held,
    accounts,
    withoutOne: accounts - held,
    share: accounts === 0 ? 0 : Math.round((held / accounts) * 100),
  };
}

/**
 * Whether a code is required, in the sentence the badge cannot carry.
 *
 * "Available" is not "required", and the difference is a count: an authenticator is
 * demanded of the accounts that enrolled one and of nobody else. A reader who has just
 * seen a green badge has to be told that in words before they read a control, which is
 * what the strip under the header is for.
 */
export function scopeSummary(enabled: boolean, coverage: AuthenticatorCoverage): string {
  const one = coverage.enrolled === 1;
  const holds = one ? "holds" : "hold";

  if (!enabled) {
    return coverage.enrolled === 0
      ? "Nobody can enrol an authenticator while this is off, and no account holds one."
      : `Nobody can enrol an authenticator while this is off. ${plural(coverage.enrolled, "account", "accounts")} ${holds} one already and ${one ? "is" : "are"} not asked for a code until it is back on.`;
  }

  if (coverage.enrolled === 0) {
    return "Enrolment is optional, and nobody has enrolled yet, so no sign-in here is asked for a code.";
  }

  const rest =
    coverage.withoutOne === 0
      ? "Every account on this project holds one."
      : `The other ${plural(coverage.withoutOne, "account signs", "accounts sign")} in with one factor.`;

  return `Enrolment is optional. ${coverage.enrolled.toLocaleString("en")} of ${plural(coverage.accounts, "account", "accounts")} ${holds} an authenticator and ${one ? "is" : "are"} asked for a code at every sign-in. ${rest}`;
}

/*
 * Who is challenged.
 *
 * The factor model is the thing this screen is hardest to read about, because the words
 * for it are ours: a factor demands a challenge, another answers one, and a sign-in that
 * already proved two factors is asked for nothing. As rows of prose that is four
 * paragraphs nobody finishes. As a matrix it is what somebody came to check, so the
 * cases are the ones a customer asks about and each answer is three words.
 */
export type ChallengeOutcome = "asked" | "none" | "answered";

/**
 * The tag's tone per outcome. A demanded code is the protection working, so it takes the
 * outcome ink; a sign-in with nothing to ask for is neither good nor bad and takes none.
 */
export const OUTCOME_TONES: Record<ChallengeOutcome, string> = {
  asked: "success",
  none: "neutral",
  answered: "chart-1",
};

/**
 * The line under the matrix. It is the one fact none of the rows carries: the answer is
 * one gate's rather than each flow's, which is why a new sign-in method cannot forget to
 * ask and why turning the method off changes every row at once.
 */
export const CHALLENGE_SCENARIOS_NOTE =
  "Decided once, by the gate, after the first factor verifies and before anything creates a session. A flow cannot opt out of it, which is why a sign-in method added later is challenged on the same terms.";

export interface ChallengeScenario {
  id: string;
  /** What the person did, and what their account holds. Short: it is a table cell. */
  scenario: string;
  /** The answer in two or three words. */
  result: string;
  outcome: ChallengeOutcome;
  /** Why, in one line under the result. */
  detail: string;
}

/**
 * The six cases, in the order a reader meets them: the three sign-ins that are
 * challenged, the two that are not, then what may answer the challenge and when it is
 * asked for again.
 *
 * `stepUpWindow` is passed in already written, because the humanising lives with the
 * one-time-code facts and the window is the deployment's rather than this file's.
 */
export function challengeScenarios(stepUpWindow: string): readonly ChallengeScenario[] {
  return [
    {
      id: "password",
      scenario: "Password sign-in, on an account holding an authenticator",
      result: "Code asked for",
      outcome: "asked",
      detail:
        "The password answers, and the sign-in returns a challenge instead of a session until the code does too.",
    },
    {
      id: "otp",
      scenario: "One-time code or social provider, on the same account",
      result: "Code asked for",
      outcome: "asked",
      detail:
        "Every flow is gated the same way. An emailed code and a Google sign-in each prove one factor, whatever it felt like.",
    },
    {
      id: "passkey",
      scenario: "Passkey sign-in, with a face, a fingerprint or a device PIN",
      result: "No extra step",
      outcome: "none",
      detail:
        "The ceremony was already two factors, so following it with a code would ask the same person twice.",
    },
    {
      id: "nothing",
      scenario: "Any sign-in, on an account holding no authenticator",
      result: "No extra step",
      outcome: "none",
      detail:
        "A challenge nobody can answer is a sign-in that cannot be completed rather than one that is refused.",
    },
    {
      id: "lost",
      scenario: "At the challenge, with the phone gone",
      result: "A recovery code answers",
      outcome: "answered",
      detail: `One of the ${TOTP.recoveryCodes} single-use codes, or a passkey if the account holds one. Both are offered; neither turns the challenge off.`,
    },
    {
      id: "step-up",
      scenario: "Changing an address or a password inside a session",
      result: `Asked again after ${stepUpWindow}`,
      outcome: "asked",
      detail:
        "A step-up compares how long ago a factor was proved. A recovery code is never accepted here, because it exists for a lost phone.",
    },
  ];
}

/*
 * The journey.
 *
 * A customer deciding whether to offer this is really asking what their own code has to
 * do, and the answer is two calls and a sheet of codes they have to show once. The steps
 * name the SDK call where there is one, because the step with no call is the step that is
 * theirs to draw.
 */
export interface EnrolmentStep {
  id: string;
  title: string;
  detail: string;
  /** The SDK call this step is. Empty for a step that is the customer's own screen. */
  call: string;
  /** Where the step is settled, when that is another screen here. */
  link?: { label: string; to: string };
}

export const ENROLMENT_JOURNEY: readonly EnrolmentStep[] = [
  {
    id: "start",
    title: "The user asks for an authenticator, from a session",
    detail: `We mint a ${TOTP.secretBits}-bit secret, encrypt it, and return it with the otpauth URI. The factor exists from here and satisfies nothing yet.`,
    call: "mfa.enrollTotp()",
  },
  {
    id: "draw",
    title: "Your page draws the QR code, or shows the secret",
    detail:
      "We return the URI and the secret and never an image, for the same reason we ship no sign-in screen. The secret in groups of four is what somebody types when a camera will not read the code.",
    call: "",
  },
  {
    id: "confirm",
    title: "They type the first code back",
    detail:
      "The factor counts only from here, which is what proves the secret arrived intact. A start that was never confirmed is replaced by the next one rather than standing in its way.",
    call: "mfa.confirmTotp({ factorId, code })",
  },
  {
    id: "recovery",
    title: `${TOTP.recoveryCodes} recovery codes come back with it, once`,
    detail:
      "In that same reply, and only while the account has no unspent code left, so a sheet somebody has already printed is never invalidated. Only digests are kept: nobody here can read them back, which is why your page has to show them.",
    call: "",
    link: { label: "Recovery codes", to: "/mfa/recovery" },
  },
  {
    id: "afterwards",
    title: "Every sign-in on that account asks for a code",
    detail:
      "Authentication answers with a challenge instead of a session, and the code, a passkey or a recovery code completes it. Removing the last factor takes the recovery sheet with it.",
    call: "challenge.submit(proof)",
  },
];
