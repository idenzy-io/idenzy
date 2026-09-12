import { ErrorCode } from "@idenzy/protocol/errors/codes";

/**
 * What a refused sign-in says on the screen, keyed on the code the server sent.
 *
 * Built from codes rather than from the server's own message, which is the whole point of
 * the error contract: a customer builds every user-facing string from these, so this file
 * is the panel being its own first customer of that promise (PROJECT.md 3.3).
 *
 * Everything not listed falls back to one sentence rather than to the server's text. An
 * unrecognised code means this panel is older than the API it is talking to, and the raw
 * detail of an auth failure is not something to paste in front of somebody.
 */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.InvalidCredentials]: "That email address and password do not match an account.",
  [ErrorCode.EmailNotVerified]: "Check your inbox and confirm your address before signing in.",
  [ErrorCode.AccountBanned]: "This account has been suspended. Contact support if that is wrong.",
  [ErrorCode.PasswordBreached]:
    "That password appears in a known breach. Pick one you have not used elsewhere.",
  [ErrorCode.ValidationFailed]: "Check the details above and try again.",
  [ErrorCode.RateLimited]: "Too many attempts. Wait a moment and try again.",
  [ErrorCode.ProviderUnavailable]: "We could not reach the sign-in service. Try again shortly.",
};

/** One sentence for anything unrecognised, including a network failure. */
const FALLBACK = "Something went wrong signing you in. Try again.";

/**
 * `unknown` in, a sentence out, and it never throws.
 *
 * A handler that has already failed must not fail again while working out what to say, so
 * every shape is tolerated: an SDK error with a code, something else with a code-like
 * field, or nothing recognisable at all.
 */
export function signInMessage(error: unknown): string {
  const code = codeOf(error);
  if (code === null) return FALLBACK;
  return MESSAGES[code] ?? FALLBACK;
}

function codeOf(error: unknown): ErrorCode | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? (code as ErrorCode) : null;
}

/**
 * The same idea for the management API, which refuses for different reasons.
 *
 * Separate from `signInMessage` because the codes that matter differ: nothing here is
 * about a password, and a 403 means a role too junior rather than an account suspended.
 * One shared map would say "check the details above" on a screen with no form on it.
 */
const MANAGEMENT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.MissingCredentials]: "Your session has expired. Sign in again.",
  [ErrorCode.InsufficientScope]: "Your role on this organisation does not allow that.",
  [ErrorCode.NotFound]: "That is no longer there. Reload and try again.",
  [ErrorCode.Conflict]: "That has already been done.",
  [ErrorCode.ValidationFailed]: "Check the details and try again.",
  [ErrorCode.RateLimited]: "Too many requests. Wait a moment and try again.",
  [ErrorCode.ProviderUnavailable]: "We could not reach the service. Try again shortly.",
};

const MANAGEMENT_FALLBACK = "Something went wrong. Try again.";

export function managementMessage(error: unknown): string {
  const code = codeOf(error);
  if (code === null) return MANAGEMENT_FALLBACK;
  return MANAGEMENT_MESSAGES[code] ?? MANAGEMENT_FALLBACK;
}

/** The code and message a refusal carries, which is what both readers above want. */
export interface Refusal {
  code: string;
  message: string;
}

/**
 * The `{ error: { code, message } }` document a refused request answered with, or null.
 *
 * This is what makes the two functions above worth having. A fetch that failed hands its
 * caller a status line, and a status line has no code — so without reading the body back
 * into its documented shape, every screen would say "something went wrong" about a refusal
 * the server had explained precisely (PROJECT.md 9.3).
 *
 * Both shapes arrive here: a call that asked for JSON has already been parsed, and one that
 * did not — a delete, whose success is an empty 204 — still carries its refusal as text.
 * Anything else is not a refusal of ours, and null leaves the status line as the error.
 */
export function refusalIn(data: unknown): Refusal | null {
  const body = typeof data === "string" ? parsed(data) : data;
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const refusal = (body as { error: unknown }).error;
  if (typeof refusal !== "object" || refusal === null || !("code" in refusal)) return null;
  return typeof (refusal as { code: unknown }).code === "string" ? (refusal as Refusal) : null;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Whether a refusal is a particular one, for a screen with a better sentence for it.
 *
 * The map above is what a screen says when it has nothing specific to say. A dialog that has
 * been refused for a reason its own reader can act on — a hostname somebody else holds, a
 * name already taken — says that instead, and this is how it asks without reaching for the
 * server's own message.
 */
export function isRefusal(error: unknown, code: ErrorCode): boolean {
  return codeOf(error) === code;
}
