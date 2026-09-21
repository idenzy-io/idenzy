/**
 * What a project decides about additional verification, and what it cannot.
 *
 * A step-up is proving a factor again inside a session that already exists, in front of
 * something sensitive (PROJECT.md 4.5, apps/api/src/mfa/step-up-service.ts). The
 * decidable part is one number: how recent a proof has to be. Everything else is the
 * server's, and most of what this file holds exists so the screen can state two things
 * the number alone hides.
 *
 * The first is coverage. `assertRecent` lets a user with nothing enrolled past, because a
 * step-up asks for something the caller holds and somebody who holds nothing can never
 * satisfy it; demanding one would lock them out of changing their own address for ever. So
 * a fifteen-minute window is not enforcement for everybody, and the screen has to say who
 * it is enforcement for before it offers the control (`notes/mfa-step-up.md` P1). Asking
 * for the password instead is the honest fix for those accounts and is not built.
 *
 * The second is who enforces what. Exactly one of our own routes refuses on this today,
 * and the rest of the list is a mixture of SDK guidance, the customer's own server and
 * things that are not available at all. `STEP_UP_ACTIONS` states which is which, because
 * a page that says "protected" over a list of unlike rows overstates every row on it.
 */

/** How recent a proof has to be, in minutes. The server caps the window at an hour. */
export type StepUpWindow = 5 | 15 | 30 | 60;

export const STEP_UP_WINDOWS: readonly StepUpWindow[] = [5, 15, 30, 60];

export interface StepUpSettings {
  /** The deployment's `STEP_UP_MAX_AGE_SECONDS`, whose default is fifteen minutes. */
  maxAgeMinutes: StepUpWindow;
}

export const DEFAULT_STEP_UP_SETTINGS: StepUpSettings = { maxAgeMinutes: 15 };

/** The rest, as the server fixes it. */
export const STEP_UP = {
  /** `STEP_UP_MAX_AGE_SECONDS` may not exceed this. */
  maxAgeCapSeconds: 3600,
  /** `MFA_CHALLENGE_TTL_SECONDS`: how long a started step-up waits for its answer. */
  challengeSeconds: 300,
  attempts: 5,
  /** What start answers when the caller holds nothing to be asked for. */
  nothingToAskStatus: 204,
  /** What a sensitive action answers when the proof is missing or stale. */
  errorCode: "reauthentication_required",
  /** The access-token claim: the age of the last proof in seconds, absent when none. */
  claim: "fva",
  /** What `@idenzy/node` hands the claim on as. */
  verifierField: "factorVerifiedSecondsAgo",
  /** The one route of ours that calls `assertRecent` today. */
  enforcedRoute: "POST v1/auth/account/email",
} as const;

export function isStepUpWindow(value: number): value is StepUpWindow {
  return STEP_UP_WINDOWS.includes(value as StepUpWindow);
}

/**
 * Whether a proof still counts, as `assertRecent` decides it: the age of the proof,
 * measured against now, at or inside the window. A session that never proved a factor
 * fails whatever the window says, because there is no age to compare.
 */
export function isProofFresh(
  factorVerifiedAt: string | null,
  now: Date,
  maxAgeMinutes: StepUpWindow,
): boolean {
  if (factorVerifiedAt === null) return false;
  const age = now.getTime() - new Date(factorVerifiedAt).getTime();
  return age >= 0 && age <= maxAgeMinutes * 60 * 1000;
}

/*
 * Coverage.
 *
 * Who can be asked at all. The step-up registry offers a passkey and an authenticator, in
 * that order, and nothing else: a recovery code is single use and exists for a lost phone,
 * so spending one to confirm an email change spends the wrong thing. An account holding
 * neither of the two passes every check this screen describes.
 */

/** The two fields the answer depends on, so this file needs nothing from the user model. */
export interface FactorHolder {
  /** An authenticator is enrolled. */
  mfaEnabled: boolean;
  methods: readonly string[];
}

export function canBeChallenged(user: FactorHolder): boolean {
  return user.mfaEnabled || user.methods.includes("passkey");
}

export interface StepUpCoverage {
  /** Accounts holding a passkey or an authenticator: the ones a step-up can ask. */
  challengeable: number;
  /** Accounts holding neither, which pass every check on this page. */
  passing: number;
  accounts: number;
  /** Percent challengeable, rounded. A project with no accounts is 0, not NaN. */
  share: number;
}

export function stepUpCoverage(users: readonly FactorHolder[]): StepUpCoverage {
  const challengeable = users.filter((user) => canBeChallenged(user)).length;
  return {
    challengeable,
    passing: users.length - challengeable,
    accounts: users.length,
    share: users.length === 0 ? 0 : Math.round((challengeable / users.length) * 100),
  };
}

/**
 * The window in the sentence a reader can check against their own product, which is the
 * copy `notes/mfa-step-up.md` asks for word for word.
 */
export function windowSentence(minutes: StepUpWindow): string {
  return `Ask for another verification when the last successful factor check is older than ${minutes} minutes.`;
}

/*
 * The worked example, as one person's afternoon.
 *
 * A table of ages against the window was four rows saying the same thing twice: a reader
 * checked the arithmetic and still did not know what the person on the other end sees. This
 * is the same fact told as the sequence it happens in, which is what "what a user runs into"
 * has to mean: a proof, an action inside the window, the same action past it, and the answer
 * that puts them back where they started. Every age is derived from the window, so the story
 * moves with the control, and whether a step is fresh is decided by `isProofFresh` rather
 * than asserted here.
 */
export interface WalkthroughStep {
  id: string;
  /** Its own number, so the rule drawn between two steps does not shift the count. */
  number: number;
  /** How old the proof is at this step. Zero where the step is the proof. */
  ageMinutes: number;
  /** What the person does, with the age in it where the age is the point. */
  what: string;
  /** What the check does about it, in words rather than in a colour. */
  outcome: string;
  fresh: boolean;
}

export interface Walkthrough {
  steps: readonly WalkthroughStep[];
  /** The caption on the rule between the last fresh step and the first stale one. */
  boundary: string;
  /** The step the rule is drawn above. */
  boundaryBefore: string;
}

/** `now` is a parameter so a test can pin it; the rule applied is the server's own. */
export function walkthrough(minutes: StepUpWindow, now = new Date()): Walkthrough {
  const fresh = (ageMinutes: number) =>
    isProofFresh(new Date(now.getTime() - ageMinutes * 60_000).toISOString(), now, minutes);

  /* Comfortably inside and comfortably past, whichever of the four windows is chosen. */
  const inside = Math.max(1, Math.ceil(minutes / 3));
  const past = minutes + 9;

  const steps: readonly WalkthroughStep[] = [
    {
      id: "sign-in",
      number: 1,
      ageMinutes: 0,
      what: "Signs in, answering the challenge with their authenticator.",
      outcome: "Proof is fresh",
      fresh: fresh(0),
    },
    {
      id: "inside",
      number: 2,
      ageMinutes: inside,
      what: `Changes their email address ${inside} minutes later.`,
      outcome: "Goes ahead",
      fresh: fresh(inside),
    },
    {
      id: "past",
      number: 3,
      ageMinutes: past,
      what: `Comes back to change it again, ${past} minutes after that proof.`,
      outcome: "Refused, and asked to verify",
      fresh: fresh(past),
    },
    {
      id: "answered",
      number: 4,
      ageMinutes: 0,
      what: "Answers with a passkey or a code, and the change goes through.",
      outcome: `Fresh for another ${minutes} minutes`,
      fresh: fresh(0),
    },
  ];

  return {
    steps,
    boundary: `${minutes} minutes after the proof, the window closes`,
    boundaryBefore: "past",
  };
}

/*
 * The action matrix.
 *
 * Four different answers used to read as one claim of protection. `enforced` is a refusal
 * our own server makes; `sdk` is a refusal the SDK asks for and the server does not make
 * yet; `yours` is a check that is the customer's to write, with our claim to write it
 * against; `unavailable` is a thing this screen does not do at all, named because a reader
 * arrives expecting it.
 */
export type Enforcement = "enforced" | "sdk" | "yours" | "unavailable";

export const ENFORCEMENT_LABELS: Record<Enforcement, string> = {
  enforced: "Enforced today",
  sdk: "SDK guidance",
  yours: "Your application",
  unavailable: "Not available",
};

/** `Tag` tones. An outcome takes an outcome colour; a party takes a nominal one. */
export const ENFORCEMENT_TONES: Record<Enforcement, string> = {
  enforced: "success",
  sdk: "warning",
  yours: "chart-1",
  unavailable: "neutral",
};

export interface StepUpAction {
  id: string;
  /** What somebody is trying to do, in their words. */
  action: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Who refuses it, named as a party rather than as a component. */
  enforcedBy: string;
  enforcement: Enforcement;
  /** What happens today. One or two lines, and never a promise. */
  behaviour: string;
  /** The screen that settles it, where there is one. */
  link?: { label: string; to: string };
}

export const STEP_UP_ACTIONS: readonly StepUpAction[] = [
  {
    id: "email-change",
    action: "Changing the account's email address",
    icon: "material-symbols:alternate-email",
    enforcedBy: "Idenzy",
    enforcement: "enforced",
    behaviour: `${STEP_UP.enforcedRoute} calls assertRecent and answers ${STEP_UP.errorCode} unless the session proved a factor inside the window. It is the only route of ours that does.`,
  },
  {
    id: "factor-removal",
    action: "Removing a second factor",
    icon: "material-symbols:key-off-outline",
    enforcedBy: "Your application, for now",
    enforcement: "sdk",
    behaviour:
      "Turning two-factor off is the first thing somebody holding a stolen session would do, and the SDK asks for a step-up in front of it. The route itself takes a session and nothing more, so until our check lands the one in your code is the only one.",
    link: { label: "Authenticator apps", to: "/mfa/totp" },
  },
  {
    id: "your-actions",
    action: "A payout, a plan change, an export",
    icon: "material-symbols:touch-app-outline",
    enforcedBy: "Your server",
    enforcement: "yours",
    behaviour: `Anything your product treats as sensitive. Your server compares ${STEP_UP.claim} against your own window and refuses a stale one; your page raises the challenge with startStepUp, and the answer swaps the token so the retry is already allowed.`,
    link: { label: "Token claims", to: "/tokens/claims" },
  },
  {
    id: "signals",
    action: "A sign-in that looks wrong",
    icon: "material-symbols:gpp-maybe-outline",
    enforcedBy: "The security centre, at sign-in",
    enforcement: "unavailable",
    behaviour:
      "A detector rule can answer the sign-in itself with a challenge, which is a different thing in a different place: nothing raises a step-up inside a session that already exists. Impossible travel and a new device are recorded on the session and demand nothing here.",
    link: { label: "Security centre", to: "/security" },
  },
  {
    id: "password-proof",
    action: "Asking for the password again",
    icon: "material-symbols:password",
    enforcedBy: "Nobody",
    enforcement: "unavailable",
    behaviour:
      "It would be the honest fix for an account holding no second factor, which is the one gap this screen cannot close. It is on the roadmap and not built, so nothing here asks anybody for a password.",
  },
];

/**
 * The paired example, as one contract.
 *
 * Split across two screens, the client's null and the server's null read as the same
 * "allow", and they are not the same thing: a null challenge means there is nothing this
 * caller could be asked for, while a null claim means no restriction can be satisfied. Both
 * halves live here so neither can drift, and the server half refuses before it allows.
 */
export const CLIENT_EXAMPLE = `// Your page, before it calls your own sensitive endpoint.
const challenge = await idenzy.mfa.startStepUp();

if (challenge !== null) {
  // Offer challenge.factors in order: passkey first, then the authenticator.
  await challenge.submitPasskey();
  // or: await challenge.submit({ factor: "totp", code });
}

// The token in hand now carries a fresh ${STEP_UP.claim}.
await api.post("/payouts", body);`;

/** Written against the project's own window, because the number in it is the decision. */
export function serverExample(minutes: StepUpWindow): string {
  return `// Your endpoint, on every sensitive request.
const token = await verifier.verifyRequest(request.headers);
const age = token.${STEP_UP.verifierField};

// null is "no proof can be given", never "no proof is needed".
if (age === null || age > ${minutes} * 60) {
  throw new HttpError(403, "${STEP_UP.errorCode}");
}

await payouts.create(token.userId, body);`;
}

/**
 * The claims a step-up leaves in the next access token, for the box that shows them.
 * The age is what the token carries: seconds since the proof at the moment it was
 * minted, so a verifier compares a number and never a clock.
 */
export function sampleClaims(ageSeconds: number): string {
  return JSON.stringify(
    {
      sub: "usr_01j9…",
      sid: "ses_01j9…",
      amr: ["pwd", "totp", "mfa"],
      fva: ageSeconds,
    },
    null,
    2,
  );
}
