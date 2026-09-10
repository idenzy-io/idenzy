/**
 * The origins a project trusts with a credentialed response (`project_origins`, ADR-0006).
 *
 * This is the CORS allowlist and nothing else. The panel holds two other lists of URLs
 * that look like they would do: the redirect targets a magic link or an OAuth return
 * lands on, and the origins a passkey ceremony may run from. Neither is this one, and the
 * ADR is explicit about why: a native app registers `myapp://callback`, which is a fine
 * redirect target and can never appear in an `Origin` header; an SPA on `www.example.com`
 * may call the API while its return route lives on `app.example.com`; and WebAuthn forbids
 * an origin outside the relying party's registrable domain where CORS does not. Deriving
 * one from another would also make a privilege change invisible, because whoever added a
 * redirect URI would be looking at a dialog about OAuth while widening what a browser may
 * read.
 *
 * What the ADR does ask for is suggestion: the dashboard offers the origins those other
 * lists imply and asks somebody to confirm each one. Suggestion in the panel, never
 * derivation in the schema, which is why `suggestionsFrom` returns candidates and adding
 * one is an ordinary write.
 *
 * `parseOrigin` and `normaliseOrigin` come from `./passkeys` on purpose. What a valid
 * origin *is* syntactically is one fact and belongs in one place; what makes one
 * *allowed* is two different rules and those stay apart. Everything here that has a
 * counterpart there carries a longer name for the same reason: Nuxt auto-imports these
 * files into one namespace, and two exports called `validateOrigin` would leave whichever
 * one it picked answering the other's question.
 */

import { normaliseOrigin, parseOrigin } from "./passkeys";

export interface AllowedOrigin {
  /** Scheme, host and port, exactly as it will arrive in the header. */
  origin: string;
  addedAt: string;
  /** Where it came from, for a row that says how it got here. Null for one typed in. */
  source: OriginSource | null;
}

/*
 * Adding one.
 */

/**
 * The loopback hosts a browser treats as a secure context. The list is here to refuse
 * them rather than to allow them: see `origin_loopback` below.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type AllowedOriginIssue =
  | "origin_invalid"
  | "origin_wildcard"
  | "origin_insecure"
  | "origin_loopback"
  | "origin_duplicate";

export const ALLOWED_ORIGIN_ISSUE_LABELS: Record<AllowedOriginIssue, string> = {
  origin_invalid:
    "A scheme, a host and an optional port, and nothing after them: https://app.example.com.",
  origin_wildcard:
    "No wildcards. An Origin header is one exact string and the check is a comparison, so a pattern here would match nothing at all.",
  origin_insecure:
    "Only https. A credentialed response returned to a page served over http is one anybody on the network can read.",
  origin_loopback:
    "Localhost is allowed by the deployment while it is running in development, not by this list. Adding it does nothing in production and is not needed anywhere else.",
  origin_duplicate: "That origin is already on the list.",
};

/**
 * The issue with an origin somebody typed, or null.
 *
 * The wildcard case is checked before parsing, because `https://*.example.com` parses
 * perfectly well as a URL and the refusal has to say what is actually wrong with it.
 */
export function validateAllowedOrigin(
  value: string,
  existing: readonly string[],
): AllowedOriginIssue | null {
  const text = value.trim();
  if (text.includes("*")) return "origin_wildcard";

  const url = parseOrigin(text);
  if (url === null) return "origin_invalid";

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return "origin_loopback";
  if (url.protocol !== "https:") return "origin_insecure";

  const origin = normaliseOrigin(text);
  if (existing.map(normaliseOrigin).includes(origin)) return "origin_duplicate";
  return null;
}

/*
 * Where a suggestion comes from.
 */

export type OriginSource = "magic_link" | "passkey";

export interface OriginSourceInfo {
  id: OriginSource;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Why the origin behind it is worth offering, and why it is still a separate act. */
  note: string;
}

export const ORIGIN_SOURCES: Record<OriginSource, OriginSourceInfo> = {
  magic_link: {
    id: "magic_link",
    label: "Magic link redirect",
    icon: "material-symbols:link",
    note: "A page a magic link already lands on, so a browser there is one you have registered a destination for. It is offered rather than added, because landing on a page and reading a credentialed response are different privileges.",
  },
  passkey: {
    id: "passkey",
    label: "Passkey origin",
    icon: "material-symbols:passkey",
    note: "An origin a passkey ceremony already runs from. WebAuthn confines those to the relying party's own domain and CORS does not, so the two lists are not the same list and one cannot stand in for the other.",
  },
};

export interface OriginSuggestion {
  origin: string;
  source: OriginSource;
  /** The value it was read off, so a row can say where it actually came from. */
  from: string;
}

/**
 * The origins the project's other lists imply, minus the ones already allowed and minus
 * anything this list would refuse anyway.
 *
 * A redirect target is a whole URL and an origin is its first three parts, so the same
 * origin usually arrives several times over; the first mention wins and the rest are
 * dropped, because a list offering `https://app.acme.com` twice reads as two decisions.
 */
export function suggestionsFrom(
  redirectUris: readonly string[],
  passkeyOrigins: readonly string[],
  allowed: readonly string[],
): OriginSuggestion[] {
  const held = new Set(allowed.map(normaliseOrigin));
  const seen = new Set<string>();
  const out: OriginSuggestion[] = [];

  const offer = (value: string, source: OriginSource) => {
    const origin = originOf(value);
    if (origin === null) return;
    if (held.has(origin) || seen.has(origin)) return;
    if (validateAllowedOrigin(origin, []) !== null) return;
    seen.add(origin);
    out.push({ origin, source, from: value });
  };

  for (const uri of redirectUris) offer(uri, "magic_link");
  for (const origin of passkeyOrigins) offer(origin, "passkey");
  return out;
}

/**
 * The origin of any absolute URL, or null where it has none. A custom scheme such as
 * `myapp://callback` is exactly the case the ADR names: a perfectly good redirect target
 * that can never appear in an `Origin` header, so it is dropped here rather than offered
 * and refused later.
 */
export function originOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/*
 * Changing the list.
 */

/** Sorted by host so a list of a dozen is scannable, and stable as entries are added. */
export function sortOrigins(origins: readonly AllowedOrigin[]): AllowedOrigin[] {
  return [...origins].sort((first, next) => first.origin.localeCompare(next.origin, "en"));
}

export function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  const value = normaliseOrigin(origin);
  return allowed.map(normaliseOrigin).includes(value);
}

/*
 * What a refusal looks like from the outside.
 */

/** The header a browser is looking for. Absent, it refuses the response itself. */
export const ALLOW_ORIGIN_HEADER = "Access-Control-Allow-Origin";

/**
 * The response an allowed origin gets and the response an unregistered one gets, which
 * differ by one header and not by a status.
 *
 * A 403 would tell a prober the difference between an origin that was checked and refused
 * and one nothing is configured for, and the refusal is the browser's to make in any case:
 * it is the one party that knows which page asked. The status is the same 200 either way,
 * so a screen that draws this has to draw the headers to show anything at all.
 */
export interface CorsSample {
  status: string;
  headers: { name: string; value: string }[];
  outcome: string;
}

export function corsSample(origin: string, allowed: boolean): CorsSample {
  const headers = [
    { name: "Vary", value: "Origin" },
    ...(allowed
      ? [
          { name: ALLOW_ORIGIN_HEADER, value: origin },
          { name: "Access-Control-Allow-Credentials", value: "true" },
        ]
      : []),
  ];
  return {
    status: "200 OK",
    headers,
    outcome: allowed
      ? "The page reads the response."
      : "The browser discards the response and reports a CORS error. The server answered normally.",
  };
}
