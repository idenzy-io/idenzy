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
