/**
 * The HTTP names Idenzy owns, on the wire.
 *
 * They live in `protocol` because three unrelated readers have to agree on them and two of
 * them ship to customers: the SDK sends these headers, the CORS layer allows them, and the
 * guards read them. A name one side spells differently is not a compile error anywhere, it
 * is a browser silently dropping a request.
 *
 * Values are lowercase because Node lowercases incoming header names, so `request.headers`
 * is keyed that way and a mixed-case constant would never match a lookup.
 */
export const IdenzyHeader = {
  /**
   * The project's publishable key. Read before `Authorization`, which on a signed-in
   * request is already carrying the user's access token and has no room for both.
   */
  PublishableKey: "x-idenzy-publishable-key",
  /** `cookie` or `header`. Absent means header mode, which is the back-compatible default. */
  SessionTransport: "x-idenzy-session-transport",
  /** Echoes the CSRF cookie. Only meaningful in cookie mode (PROJECT.md 4.3). */
  Csrf: "x-idenzy-csrf",
  /**
   * What to call this device in the user's own session list, percent-encoded.
   *
   * A header rather than a body field because every way of signing in creates a session, and
   * a field on each request schema is a field one flow would be added without. Read once,
   * where the rest of the request context is read, and inherited by every flow.
   *
   * Percent-encoded because a header value is bytes and a device name is not: "Hasan'ın
   * MacBook'u" throws in `fetch` before it reaches the network. Display text only. Nothing
   * decides anything from it.
   */
  DeviceName: "x-idenzy-device-name",
} as const;
export type IdenzyHeader = (typeof IdenzyHeader)[keyof typeof IdenzyHeader];

/**
 * Every header above, for the CORS `Access-Control-Allow-Headers` list.
 *
 * Derived rather than written out a second time. A header added to the record and forgotten
 * here would be stripped by the browser before it ever reached us, and the failure would look
 * like a missing publishable key rather than a missing allow-list entry.
 */
export const IDENZY_HEADERS: readonly string[] = Object.freeze(Object.values(IdenzyHeader));

/**
 * How a session is carried.
 *
 * Declared per request rather than per project, because one project serves a web app and a
 * mobile app at once and they cannot want the same thing. It is client-declared and that is
 * safe: asking for `Cookie` gets you strictly less than `Header` does, since the token leaves
 * the response body entirely, so there is nothing to gain by lying about it.
 */
export const SessionTransport = {
  Header: "header",
  Cookie: "cookie",
} as const;
export type SessionTransport = (typeof SessionTransport)[keyof typeof SessionTransport];

/**
 * Cookie names, all `__Host-` prefixed (PROJECT.md 4.3).
 *
 * The prefix is a browser-enforced guarantee, not decoration: it requires `Secure`, forbids
 * `Domain`, and pins `Path=/`. That combination is what stops a sibling subdomain writing a
 * cookie the auth host will read, which is the attack plain double-submit CSRF is otherwise
 * open to.
 */
export const IdenzyCookie = {
  /** The opaque refresh token. Never readable by JavaScript. */
  Refresh: "__Host-idenzy-refresh",
  /** The short-lived access token, so SSR can verify offline without a network call. */
  Session: "__Host-idenzy-session",
  /** The double-submit value. Deliberately readable by JavaScript, unlike the other two. */
  Csrf: "__Host-idenzy-csrf",
} as const;
export type IdenzyCookie = (typeof IdenzyCookie)[keyof typeof IdenzyCookie];
