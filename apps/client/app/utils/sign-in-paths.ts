/**
 * Which ways in a project actually has switched on, and what that means for one account.
 *
 * A method on an account and a method a project allows are two different facts, and the
 * screens that confuse them mislead in the direction that matters: an operator adding a
 * phone-only user on a project with no SMS policy is told the account will sign in by a
 * code, and it never can. So the panel reads the project's own settings and says which
 * of the three paths is live, with the screen that turns each one on.
 *
 * Pure, and given booleans rather than stores, so both the add dialog and the user's own
 * page ask the same question and get the same answer.
 */

import type { SignInMethod } from "./users";

export type SignInPathId = "password" | "email_otp" | "sms_otp";

/** What the project's settings say, read off the password policy, the OTP channels and
    the SMS policy. `smsPolicyReady` is `canSendSms`: no row and an empty allowlist are
    the same no. */
export interface ProjectSignInSettings {
  passwordEnabled: boolean;
  emailCodeEnabled: boolean;
  smsCodeEnabled: boolean;
  smsPolicyReady: boolean;
}

/** Where a reader goes to change a path, for the line that says it is off. */
export interface PathFix {
  label: string;
  to: string;
}

export interface SignInPath {
  id: SignInPathId;
  label: string;
  available: boolean;
  /** What the path does, or the reason it cannot be used. One sentence either way. */
  note: string;
  fix: PathFix | null;
}

const PASSWORDS: PathFix = { label: "Passwords", to: "/methods/passwords" };
const CODES: PathFix = { label: "One-time codes", to: "/methods/otp" };
const SMS_POLICY: PathFix = { label: "SMS policy", to: "/sms/policy" };

/**
 * The three paths a new account can be given, in the order the add form offers them.
 * Social sign-in and passkeys are left out on purpose: neither can be set up on somebody
 * else's behalf, so neither is a way an operator can create.
 */
export function signInPaths(settings: ProjectSignInSettings): SignInPath[] {
  return [
    {
      id: "password",
      label: "Password",
      available: settings.passwordEnabled,
      note: settings.passwordEnabled
        ? "Set one here and they can sign in with it at once."
        : "Passwords are off for this project, so one set here could not be used.",
      fix: settings.passwordEnabled ? null : PASSWORDS,
    },
    {
      id: "email_otp",
      label: "Email code",
      available: settings.emailCodeEnabled,
      note: settings.emailCodeEnabled
        ? "A six-digit code to their address, valid for one sign-in."
        : "Email codes are off for this project.",
      fix: settings.emailCodeEnabled ? null : CODES,
    },
    {
      id: "sms_otp",
      label: "SMS code",
      available: settings.smsCodeEnabled && settings.smsPolicyReady,
      note: smsNote(settings),
      fix: smsFix(settings),
    },
  ];
}

function smsNote(settings: ProjectSignInSettings): string {
  if (!settings.smsCodeEnabled) return "SMS codes are off for this project.";
  if (!settings.smsPolicyReady) {
    return "SMS codes are on, but no country is allowed yet, so nothing can be sent.";
  }
  return "A six-digit code to their number, valid for one sign-in.";
}

function smsFix(settings: ProjectSignInSettings): PathFix | null {
  if (!settings.smsCodeEnabled) return CODES;
  if (!settings.smsPolicyReady) return SMS_POLICY;
  return null;
}

export function pathById(paths: readonly SignInPath[], id: SignInPathId): SignInPath | null {
  return paths.find((path) => path.id === id) ?? null;
}

/*
 * What an account being created will actually be able to do.
 */

export interface NewAccountDraft {
  email: string | null;
  phone: string | null;
  /** Whether the form is setting one, not the value. */
  password: boolean;
}

export interface NewAccountOutcome {
  /** Whether the account will have a way in the moment it exists. */
  ok: boolean;
  /** The way in, or the reason there is none. */
  text: string;
  fix: PathFix | null;
}

/**
 * The one line the add form owes its reader: how this account signs in, worked out from
 * what the form holds and what the project allows. An account with no live path is still
 * worth creating, and the form says so rather than refusing: the customer's own users can
 * be sent through a reset, and a project turns a channel on later.
 */
export function newAccountOutcome(
  draft: NewAccountDraft,
  paths: readonly SignInPath[],
): NewAccountOutcome {
  if (draft.password) {
    const password = pathById(paths, "password");
    return password?.available
      ? { ok: true, text: "They sign in with the password you set.", fix: null }
      : {
          ok: false,
          text: "Passwords are off for this project, so the one you set cannot be used yet.",
          fix: PASSWORDS,
        };
  }

  if (draft.email !== null) {
    const email = pathById(paths, "email_otp");
    return email?.available
      ? { ok: true, text: `They sign in with a code sent to ${draft.email}.`, fix: null }
      : {
          ok: false,
          text: "Without a password they need email codes, and those are off for this project.",
          fix: CODES,
        };
  }

  if (draft.phone !== null) {
    const sms = pathById(paths, "sms_otp");
    if (sms?.available) {
      return { ok: true, text: `They sign in with a code sent to ${draft.phone}.`, fix: null };
    }
    return {
      ok: false,
      text: `Without a password they need SMS codes. ${sms?.note ?? ""}`.trim(),
      fix: sms?.fix ?? CODES,
    };
  }

  return { ok: false, text: "Give an email address or a phone number.", fix: null };
}

/*
 * What an account already holds, judged against the same settings.
 */

export interface MethodStanding {
  method: SignInMethod;
  /** Whether this method would work for them today. */
  usable: boolean;
  /** Why not, where not. Empty while it works. */
  reason: string;
  fix: PathFix | null;
}

/**
 * Each method on an account, and whether the project still allows it. A method that was
 * enrolled while a channel was on and is now off is the shape of "they cannot sign in and
 * nothing on their account looks wrong", which is the question this page exists to answer.
 *
 * `providers` is the social providers the project has credentials for and has switched on;
 * a passkey is never gated by a project setting, so it always stands.
 */
export function methodStandings(
  methods: readonly SignInMethod[],
  settings: ProjectSignInSettings,
  providers: readonly string[],
): MethodStanding[] {
  const paths = signInPaths(settings);
  return methods.map((method) => {
    const path = paths.find((entry) => entry.id === (method as SignInPathId));
    if (path) {
      return {
        method,
        usable: path.available,
        reason: path.available ? "" : path.note,
        fix: path.fix,
      };
    }
    if (method === "passkey") return { method, usable: true, reason: "", fix: null };
    const on = providers.includes(method);
    return {
      method,
      usable: on,
      reason: on ? "" : "This provider is not set up on the project, so it cannot be used.",
      fix: on ? null : { label: "Social providers", to: "/methods/providers" },
    };
  });
}

/** Whether anything on the account can sign in today, which is the headline answer. */
export function canSignInNow(standings: readonly MethodStanding[]): boolean {
  return standings.some((standing) => standing.usable);
}
