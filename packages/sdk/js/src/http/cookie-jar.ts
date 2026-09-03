/**
 * Reads a cookie the browser will let script see.
 *
 * Exactly one cookie qualifies. `__Host-idenzy-csrf` is deliberately not `HttpOnly`, because
 * double-submit only works if the client can echo it back in a header; the refresh and
 * session cookies are `HttpOnly` and this will never return them.
 */
export interface CookieJar {
  read(name: string): string | undefined;
}

/** The browser's own jar. Returns nothing where there is no document, such as under SSR. */
export class DocumentCookieJar implements CookieJar {
  read(name: string): string | undefined {
    const jar = globalThis.document?.cookie;
    if (typeof jar !== "string") return undefined;
    for (const pair of jar.split(";")) {
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      if (pair.slice(0, separator).trim() !== name) continue;
      const value = pair.slice(separator + 1).trim();
      return value.length === 0 ? undefined : value;
    }
    return undefined;
  }
}
