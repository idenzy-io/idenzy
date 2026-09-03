import { IdenzyCookie } from "@idenzy/protocol/http/headers";

/**
 * The two places a server finds an access token, in the order it should look.
 *
 * `Authorization` first, because a client that sent one meant it. The cookie second, and it
 * exists for exactly one reason: server rendering. In cookie mode the access token is set as
 * `__Host-idenzy-session` alongside the refresh cookie, so a page can be rendered for a
 * signed-in user by verifying a token already in the request, with no call to us at all
 * (PROJECT.md 4.3).
 *
 * Both are candidates and neither is proof. Verify what comes back.
 */
export function accessTokenFrom(headers: RequestHeaders): string | null {
  return bearerToken(header(headers, "authorization")) ?? sessionCookie(header(headers, "cookie"));
}

/**
 * Headers as every Node server spells them: a `Headers`, a plain record, or Node's own
 * `IncomingHttpHeaders` where a repeated name arrives as an array.
 */
export type RequestHeaders =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/** Only `Bearer`, and only one. A second scheme is a caller confusing us with something else. */
function bearerToken(value: string | null): string | null {
  if (value === null) return null;
  const match = /^Bearer (?<token>[\w.~+/=-]+)$/.exec(value.trim());
  return match?.groups?.["token"] ?? null;
}

/**
 * The session cookie, parsed without a dependency.
 *
 * Deliberately narrow: the name is `__Host-` prefixed, which the browser will only set from
 * the exact host over https with no `Domain`, so there is no sibling subdomain that could
 * have written the value being read here.
 */
function sessionCookie(value: string | null): string | null {
  if (value === null) return null;
  for (const pair of value.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== IdenzyCookie.Session) continue;
    const token = pair.slice(separator + 1).trim();
    return token.length === 0 ? null : token;
  }
  return null;
}

function header(headers: RequestHeaders, name: string): string | null {
  if ("get" in headers && typeof headers.get === "function") return headers.get(name);
  const value = (headers as Record<string, string | readonly string[] | undefined>)[name];
  // A repeated header is ambiguous where a credential is concerned, so it is refused rather
  // than resolved by picking one.
  return typeof value === "string" ? value : null;
}
