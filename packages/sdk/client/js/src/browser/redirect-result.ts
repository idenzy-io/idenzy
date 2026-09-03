import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { IdenzyRedirectError } from "../errors.js";

const CODES: readonly string[] = Object.values(ErrorCode);

/**
 * Reads what our redirect left on the customer's own route.
 *
 * Every flow that leaves the page comes back the same way: `?code=` with a single-use code,
 * or `?error=` with one of the stable error codes. The code is in the URL rather than a
 * session because a session in a URL is a session in browser history, in a `Referer` header
 * and in the customer's access logs.
 *
 * The error parameter is parsed against the enum rather than trusted. It arrives in a URL
 * that anything can write, and a customer branching on it must never see a value we do not
 * define; anything unrecognised becomes `oauth_provider_error`, which is what an unexplained
 * failure on the way back from a provider actually is.
 */
export function codeFromRedirect(url: string | null): string | null {
  if (url === null) return null;
  const parameters = parse(url);
  if (parameters === null) return null;

  const failure = parameters.get("error");
  if (failure !== null) {
    const code = CODES.includes(failure) ? (failure as ErrorCode) : ErrorCode.OauthProviderError;
    throw new IdenzyRedirectError(code, `The sign-in did not complete: ${code}.`);
  }
  return parameters.get("code");
}

function parse(url: string): URLSearchParams | null {
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}
