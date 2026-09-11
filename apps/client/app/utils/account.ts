/**
 * The signed-in person's own account: their address, their password, the factors they
 * hold, and the sessions they hold them in.
 *
 * The first thing this screen has to establish is whose account it is, because every other
 * credential screen in the drawer is about somebody else's. Sign-in methods and multi-factor
 * configure what a customer's *users* must do; this configures what the operator reading it
 * does. Two screens about passwords is confusing exactly once, and the sentence at the top
 * of the page is what stops it being confusing twice.
 *
 * The second thing is why it can be short. The panel signs its own operators in through the
 * product it sells (PROJECT.md 10.3): first-party cookies on this domain, the access token in
 * memory, silent refresh, our own SDK, our own flows. So the rules here are not a second
 * implementation of anything. The Argon2id parameters are the ones on the passwords screen,
 * the challenge is the one `MfaGate` issues, the session model is the one the sessions screen
 * documents. If any of it is unpleasant here it is unpleasant for a customer, and the fix is
 * the SDK rather than a component.
 *
 * What is genuinely this file's own is the small set of rules about changing a credential you
 * are currently holding, which is a situation none of the other screens is in.
 */

import { FACTOR_ROLES, type MfaFactorKind } from "./mfa";

/*
 * Who you are.
 */

export interface AccountProfile {
  /** The public user id, `usr_` and an opaque body, as every API surface names a user. */
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** When the password was last set. Null for an account that has never had one. */
  passwordChangedAt: string | null;
}

export const ACCOUNT_NAME_MAX = 80;

export type AccountNameIssue = "name_empty" | "name_long";

export const ACCOUNT_NAME_ISSUE_LABELS: Record<AccountNameIssue, string> = {
  name_empty: "A name to be shown by, in the member list and the audit trail.",
  name_long: `At most ${ACCOUNT_NAME_MAX} characters.`,
};

export function validateAccountName(value: string): AccountNameIssue | null {
  const text = value.trim();
  if (text.length === 0) return "name_empty";
  if (text.length > ACCOUNT_NAME_MAX) return "name_long";
  return null;
}

/**
 * Why there is no picture to upload.
 *
 * The panel loads nothing from a third-party origin (PROJECT.md 10.3), which rules out
 * Gravatar and every avatar CDN, and storing one ourselves would be an upload path and a
 * bucket for a decoration. Initials are what the drawer already draws.
 */
export const AVATAR_NOTE =
  "Initials, drawn from your address. The panel loads nothing from a third-party origin, so there is no avatar service to fetch one from and no upload path for a decoration.";

/*
 * Changing the address.
 */

/**
 * The rule from PROJECT.md 4.5, which is stricter than people expect and worth the sentence.
 *
 * Both addresses confirm, not just the new one. Confirming only the new address means
 * somebody who reaches an unlocked screen can move the account to an address they own, and
 * the real owner learns about it when they cannot sign in. The old address is the one that
 * can still stop it.
 */
export const EMAIL_CHANGE = {
  needsRecentFactor: true,
  confirmsBoth: true,
  note: "Both addresses have to confirm, and a second factor has to have been proved recently. Confirming only the new one would let anybody at an unlocked screen move the account somewhere you cannot reach, and the old address is what stops that.",
} as const;

/**
 * A change that has been asked for and not finished.
 *
 * Held apart from the profile on purpose. The address on the account is the one that still
 * works, and it keeps working until both sides have answered; writing the new one straight
 * onto the profile and marking it unverified would be the panel claiming a move that has
 * not happened, and the reader would be locked out of a mailbox they still own
 * (notes/account.md P1).
 */
export interface EmailChange {
  /** Where it is going. The address on the profile is still the live one. */
  email: string;
  requestedAt: string;
  expiresAt: string;
  /** Whether each side has answered. Both, and the change lands. */
  currentConfirmed: boolean;
  newConfirmed: boolean;
}

/** How long a confirmation pair stands before the change has to be asked for again. */
export const EMAIL_CHANGE_TTL_HOURS = 24;

export function emailChangeExpiresAt(requestedAt: Date): string {
  return new Date(requestedAt.getTime() + EMAIL_CHANGE_TTL_HOURS * 3_600_000).toISOString();
}

export function isEmailChangeExpired(change: EmailChange, now: Date): boolean {
  return Date.parse(change.expiresAt) <= now.getTime();
}

/** Where a pending change has got to, in the words the row uses. */
export function emailChangeWords(change: EmailChange, now: Date): string {
  if (isEmailChangeExpired(change, now)) {
    return "The confirmation links have expired. Nothing moved, so ask for the change again.";
  }
  if (change.currentConfirmed && !change.newConfirmed) {
    return `Confirmed here. Waiting for ${change.email} to confirm.`;
  }
  if (!change.currentConfirmed && change.newConfirmed) {
    return `${change.email} has confirmed. Waiting for the link sent to your current address.`;
  }
  return `Waiting for both addresses to confirm. Nothing changes until they do.`;
}

/*
 * What this panel can actually write.
 */

export interface AccountCapability {
  running: boolean;
  /** Why not, in the reader's words. */
  reason: string;
}

/**
 * Whether a credential change on this account reaches a server.
 *
 * It does not. There is no management client behind this panel yet, so a password change
 * moves a timestamp in memory and a confirmation link is never sent. The screen says so
 * rather than reporting a success it cannot have had: a dialog that closes cleanly is the
 * whole of the evidence a reader gets, and here that evidence would be false
 * (notes/account.md P1, notes/dialogs.md "Saving is not the same as closing").
 */
export const ACCOUNT_WRITES: AccountCapability = {
  running: false,
  reason:
    "Nothing on this screen reaches a server yet. There is no management API behind the panel, so a password change, an address change and a factor removal are held in this tab and gone on a reload, and no confirmation mail is sent.",
};

/*
 * Changing the password.
 */

export const PASSWORD_CHANGE = {
  /** From inside a session, the current password is the proof rather than a challenge. */
  needsCurrent: true,
  note: "The current password is asked for even though you are signed in. A session is proof that somebody signed in once, not that the person at the keyboard now is the same one.",
  /** Offered, not forced: somebody changing a password out of habit does not want it. */
  signOutOthersDefault: true,
  signOutNote:
    "Signing your other sessions out is offered rather than forced. If the reason for the change is that somebody else may know the old password, this is the half that matters; if it is a routine rotation, it is a nuisance.",
} as const;

/*
 * The factors you hold.
 */

/** Only the three a dashboard operator can hold. SMS is a channel our own panel does not use. */
export type AccountFactorKind = Extract<MfaFactorKind, "totp" | "passkey" | "recovery">;

export const ACCOUNT_FACTORS: readonly AccountFactorKind[] = ["totp", "passkey", "recovery"];

export interface AccountFactor {
  kind: AccountFactorKind;
  enrolled: boolean;
  /** Passkeys and recovery codes come in more than one. Null where the idea does not apply. */
  count: number | null;
  addedAt: string | null;
  lastUsedAt: string | null;
}

export function factorRoleOf(kind: AccountFactorKind) {
  return FACTOR_ROLES.find((role) => role.kind === kind) ?? null;
}

/**
 * Which factors turn two-factor on for the account, and which only answer a challenge
 * something else demanded.
 *
 * The distinction is the server's (`demandsChallenge` is separate from `enrolled`) and it is
 * the one people get wrong: enrolling a passkey does not start challenging your password
 * sign-ins, and a recovery sheet on its own is not two-factor at all. Collapsing them would
 * make adding a passkey a change to every sign-in on the account.
 */
export const FACTOR_DEMANDS: Record<AccountFactorKind, boolean> = {
  totp: true,
  passkey: false,
  recovery: false,
};

export const FACTOR_NOTES: Record<AccountFactorKind, string> = {
  totp: "A code from an authenticator app. This is the one that turns two-factor on: once it is enrolled, a password sign-in is answered with a challenge instead of a session.",
  passkey:
    "A key held by your device or your password manager. It is a way to sign in on its own, and it answers a challenge something else demanded; enrolling one does not start challenging your password sign-ins.",
  recovery:
    "Ten single-use codes, shown once when your first factor is confirmed. A fallback and nothing else: on their own they demand no challenge, and they go when the last real factor does.",
};

/** Whether the account holds anything that makes a sign-in ask for a second factor. */
export function twoFactorOn(factors: readonly AccountFactor[]): boolean {
  return factors.some((factor) => factor.enrolled && FACTOR_DEMANDS[factor.kind]);
}

/**
 * Recovery codes leave with the last factor that demanded a challenge.
 *
 * Ten single-use passwords must not outlive the thing they were the fallback for, on an
 * account whose owner believes they turned two-factor off. Stated here because the screen
 * has to warn before the removal rather than explain after it.
 */
export const RECOVERY_FOLLOWS_NOTE =
  "Removing your last factor takes the recovery codes with it. Ten single-use passwords must not outlive the thing they were the fallback for.";

/*
 * Your own sessions.
 */

export interface AccountSession {
  id: string;
  /** What the client called the device. Free text and never a security decision. */
  deviceName: string;
  browser: string;
  ip: string;
  country: string | null;
  createdAt: string;
  lastActiveAt: string;
  /** The one this page is being read in. It cannot be revoked from here. */
  current: boolean;
}

/**
 * Why the current session is not revocable from this list.
 *
 * Revoking the session you are reading in is signing out, and it already has a menu item that
 * says so. A button that did it from a list of devices would be a button whose effect is to
 * close the page it is on, which reads as a crash.
 */
export const CURRENT_SESSION_NOTE =
  "This one is the session you are reading in. Ending it is signing out, which is what the menu at the foot of the drawer is for.";

export const OWN_SESSIONS_NOTE =
  "Your dashboard sessions, not your users'. Theirs are on the sessions screen, and nothing you do here touches them.";

/*
 * Leaving.
 */

export type LeaveRefusal = "owner_must_transfer" | "last_member";

export const LEAVE_REFUSAL_LABELS: Record<LeaveRefusal, string> = {
  owner_must_transfer:
    "You own this organisation. Ownership moves by transfer rather than by being vacated, so hand it to somebody else first and then leave.",
  last_member:
    "You are the only member. Leaving would put the organisation and its projects beyond anybody's reach, so delete the projects and close the account instead.",
};

/** Whether the signed-in person may leave, and why not when they may not. */
export function leaveRefusalFor(isOwner: boolean, memberCount: number): LeaveRefusal | null {
  if (memberCount <= 1) return "last_member";
  if (isOwner) return "owner_must_transfer";
  return null;
}

export interface LeaveEffect {
  id: string;
  label: string;
  note: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
}

export const LEAVE_EFFECTS: readonly LeaveEffect[] = [
  {
    id: "access",
    label: "Every project in the organisation goes out of reach",
    note: "Your dashboard sessions end and nothing here answers for you again unless somebody invites you back.",
    icon: "material-symbols:door-open-outline",
  },
  {
    id: "keys",
    label: "Nothing you created stops working",
    note: "API keys, webhooks and hooks belong to the project rather than to you. A key you minted keeps working after you leave, which is worth knowing before you go.",
    icon: "material-symbols:vpn-key-outline",
  },
  {
    id: "audit",
    label: "The audit trail keeps your name",
    note: "Entries record who did what, and an audit trail that lost its actors when somebody left would be no trail at all.",
    icon: "material-symbols:history",
  },
];

/*
 * The honest negatives.
 */

export interface AccountNever {
  label: string;
  note: string;
}

export const ACCOUNT_NEVER: readonly AccountNever[] = [
  {
    label: "Change anything about your users",
    note: "Every credential rule on this page applies to you alone. What your users must do is on the sign-in method and multi-factor screens, and the two sets of settings never read each other.",
  },
  {
    label: "Show you a password",
    note: "Yours is an Argon2id hash under a pepper in the key store, exactly as your users' are. There is no reveal here for the same reason there is none there.",
  },
  {
    label: "Let you keep a session you cannot see",
    note: "Every session your account holds is on this page. There is no hidden long-lived credential for the dashboard: it uses the same refresh token rotation, with the same reuse detection, that the product sells.",
  },
  {
    label: "Treat this dashboard as special",
    note: "We are a customer of our own product here. The flows, the hashing and the challenge are the ones your project runs on, which is the most honest test we have of them.",
  },
];

/** The claim the page rests on, said once where somebody can check it. */
export const DOGFOOD_NOTE =
  "This dashboard signs you in through the product it sells: our own SDK, first-party cookies on this domain, the access token in memory and a silent refresh. Nothing on this page is a second implementation of anything on the others.";
