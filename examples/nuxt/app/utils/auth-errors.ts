import { IdenzyApiError } from "@idenzy/js/errors";

/**
 * Every message your users read, in one file you own.
 *
 * Idenzy ships no UI and therefore no copy. What it promises instead is that these codes are
 * stable: they are part of the API, and renaming one would be a breaking change. So branch on
 * the code and write the sentence yourself, in your product's voice and your user's language.
 */
export function describeAuthError(failure: unknown): string {
  if (!(failure instanceof IdenzyApiError)) {
    return "We could not reach the server. Check your connection and try again.";
  }
  switch (failure.code) {
    case "invalid_credentials":
      return "That email and password do not match.";
    case "challenge_invalid":
      return "That code is not right. Check it and try again.";
    case "challenge_expired":
      return "That code has expired. Send yourself a new one.";
    case "challenge_attempts_exhausted":
      return "Too many attempts on that code. Send a new one.";
    case "rate_limited":
      return "Too many attempts. Wait a moment and try again.";
    case "password_breached":
      return "That password has appeared in a public breach. Please choose another.";
    case "password_too_weak":
      return "Please choose a longer password.";
    case "email_not_verified":
      return "Confirm your email address before signing in.";
    default:
      return "Something went wrong. Please try again.";
  }
}
