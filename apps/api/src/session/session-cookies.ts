import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import { IdenzyCookie } from "@idenzy/protocol/http/headers";
import { Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Cookie values we will emit. Everything we put in a cookie is base64url or a JWT, both of
 * which are already cookie-safe, so nothing is percent-encoded and an SSR helper reading the
 * session cookie gets the token verbatim. A value outside this set is a bug rather than
 * something to escape around, so it fails loudly.
 */
const COOKIE_SAFE = /^[A-Za-z0-9._~+/=-]+$/;

export interface IssuedCookies {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly accessTokenTtlSeconds: number;
}

/**
 * The `__Host-` session cookies (PROJECT.md 4.3).
 *
 * Written by hand rather than with a cookie plugin, and that is a deliberate spend of the
 * dependency budget in reverse. What we need is `serialize` for one fixed shape and `parse`
 * for three names. What a plugin additionally ships is cookie *signing*, which we do not
 * want: the integrity story here is the `__Host-` prefix plus a 256-bit opaque token, and a
 * signing key sitting on the token path is a liability rather than a feature.
 *
 * Two cookies, not one, and the second is what makes server rendering fast. The refresh
 * cookie is the long-lived credential and is opaque. The session cookie carries the access
 * token itself, so an SSR helper verifies it offline against a cached JWKS and renders with
 * no network call at all. The cost is stated where it belongs: an offline verifier cannot see
 * a revocation until the token expires, which is what the revocation set exists to fix and
 * why the default lifetime is five minutes.
 *
 * The attributes are not configurable. `__Host-` makes the browser enforce `Secure`, no
 * `Domain` and `Path=/`, which is the property the whole CSRF design rests on: a sibling
 * subdomain cannot write a cookie this host will read.
 */
@Injectable()
export class SessionCookies {
  constructor(private readonly config: AppConfig) {}

  /** Sets both cookies. The caller has already decided the request is in cookie mode. */
  issue(reply: FastifyReply, issued: IssuedCookies): void {
    this.write(
      reply,
      IdenzyCookie.Refresh,
      issued.refreshToken,
      this.config.get("REFRESH_TOKEN_TTL_SECONDS"),
    );
    this.write(
      reply,
      IdenzyCookie.Session,
      issued.accessToken,
      Math.max(1, issued.accessTokenTtlSeconds),
    );
  }

  /**
   * Expires every session cookie.
   *
   * Called on sign-out and, just as importantly, whenever a refresh fails in a way that means
   * the credential is dead. The cookie is `HttpOnly`, so the client cannot clear it itself:
   * without this a revoked session leaves the browser presenting a corpse on every request
   * until the cookie's own lifetime runs out.
   */
  clear(reply: FastifyReply): void {
    for (const name of [IdenzyCookie.Refresh, IdenzyCookie.Session, IdenzyCookie.Csrf]) {
      this.write(reply, name, "", 0);
    }
  }

  /** One named cookie off the request, or undefined. Never throws on a malformed header. */
  read(request: FastifyRequest, name: string): string | undefined {
    const header = request.headers.cookie;
    if (typeof header !== "string") return undefined;
    for (const pair of header.split(";")) {
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      if (pair.slice(0, separator).trim() !== name) continue;
      const value = pair.slice(separator + 1).trim();
      return value.length === 0 ? undefined : value;
    }
    return undefined;
  }

  /**
   * The CSRF cookie is the one thing here JavaScript is meant to read, because double-submit
   * only works if the client can echo it back in a header.
   */
  writeCsrf(reply: FastifyReply, value: string): void {
    reply.header(
      "set-cookie",
      `${IdenzyCookie.Csrf}=${assertSafe(value)}; Secure; SameSite=Lax; Path=/; Max-Age=${this.config.get("REFRESH_TOKEN_TTL_SECONDS")}`,
    );
  }

  private write(reply: FastifyReply, name: string, value: string, maxAge: number): void {
    reply.header(
      "set-cookie",
      `${name}=${value === "" ? "" : assertSafe(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    );
  }
}

function assertSafe(value: string): string {
  if (!COOKIE_SAFE.test(value)) {
    throw new InternalError({ detail: { reason: "a cookie value needed escaping" } });
  }
  return value;
}
