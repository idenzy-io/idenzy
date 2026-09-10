/**
 * What a project decides about step-up, and what it cannot.
 *
 * Step-up is proving a factor again inside a session that already exists, in front of
 * something sensitive (PROJECT.md 4.5, apps/auth-api/src/mfa/step-up-service.ts). The
 * decidable part is one number: how recent a proof has to be. Everything else is the
 * server's and listed here so the screen states it: what asks, what may answer, how the
 * challenge is pinned, and what the claim a customer's own code reads means.
 *
 * The one thing worth holding on to from the server is that a step-up is worth exactly
 * as much as the second factor behind it. A user with nothing enrolled passes, because a
 * step-up asks for something the caller holds and somebody who holds nothing can never
 * satisfy it; demanding one would lock them out of changing their own address for ever.
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
 * What asks for a step-up. Two are ours and the rest are the customer's, and the screen
 * lists them so an operator knows which refusals the server makes on its own.
 */
export type StepUpAsker = "ours" | "yours";

export interface StepUpAsk {
  id: string;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  who: StepUpAsker;
  /** False for something the design names and the server does not do yet. */
  live: boolean;
  note: string;
}

export const STEP_UP_ASKS: readonly StepUpAsk[] = [
  {
    id: "email-change",
    label: "Changing the address",
    icon: "material-symbols:alternate-email",
    who: "ours",
    live: true,
    note: "Asking to move an account's email needs a proof inside the window as well as a session, and is refused with reauthentication_required without one. It is the case that matters: a stolen session on an account whose owner did set a factor up.",
  },
  {
    id: "factor-removal",
    label: "Removing a second factor",
    icon: "material-symbols:key-off-outline",
    who: "ours",
    live: false,
    note: "Turning two-factor off is the first thing somebody holding a stolen session would do. The SDK documents a step-up in front of it; the route itself takes a session and nothing more today, and the server-side check is to come.",
  },
  {
    id: "your-actions",
    label: "Your own actions",
    icon: "material-symbols:touch-app-outline",
    who: "yours",
    live: true,
    note: "Anything your product treats as sensitive: a payout, a plan change, exporting data. Your server reads the claim off the access token and refuses a stale one; your page asks the SDK for a step-up and the answer swaps the token, so the next call is already allowed.",
  },
  {
    id: "signals",
    label: "A sign-in that looks wrong",
    icon: "material-symbols:gpp-maybe-outline",
    who: "ours",
    live: false,
    note: "Impossible travel and a new device are meant to be able to trigger a step-up or a notification. The signals are recorded on the session today and demand nothing yet.",
  },
];

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
