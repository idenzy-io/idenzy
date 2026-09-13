import "reflect-metadata";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AccountController } from "../dist/account/account.controller.js";
import { AnonymousController } from "../dist/anonymous/anonymous.controller.js";
import { MagicLinkController } from "../dist/magic-link/magic-link.controller.js";
import { MfaController } from "../dist/mfa/mfa.controller.js";
import { OAuthController } from "../dist/oauth/oauth.controller.js";
import { OtpController } from "../dist/otp/otp.controller.js";
import { PasskeyController } from "../dist/passkey/passkey.controller.js";
import { PasswordController } from "../dist/password/password.controller.js";
import { REQUIRES_SESSION } from "../dist/session/session.guard.js";
import { RATE_LIMIT } from "../dist/throttling/rate-limit.decorator.js";

/**
 * Every way in, and whether anything bounds how often it may be tried (PROJECT.md 4.9).
 *
 * This is the test whose absence was the bug. `RateLimitStrategy` had been wired into
 * `auth-api` since phase 0 and exactly one caller ever used it, so password sign-in, OTP
 * start, magic links and the passkey ceremonies all shipped with no throttle at all — and
 * nothing failed, because nothing was looking. A limiter is only worth what covers it.
 *
 * The rule is by exposure rather than by route: a route that demands a session is already
 * bounded by having to hold one, and the ones that do not are the whole attack surface.
 * Anything unauthenticated must either declare a spec or appear in EXEMPT with a reason,
 * and the point of EXEMPT is that adding to it is a decision somebody writes down.
 */

const CONTROLLERS = [
  PasswordController,
  OtpController,
  MagicLinkController,
  OAuthController,
  PasskeyController,
  MfaController,
  AccountController,
  AnonymousController,
];

/**
 * Unauthenticated routes that deliberately carry no limit.
 *
 * Empty, and that is the intended state: every way into this API is either behind a session
 * or behind a ceiling. The map exists so that the first exemption has to be written down
 * with a reason next to it, rather than appearing as a missing decorator nobody notices —
 * which is exactly how the whole surface came to be unthrottled in the first place.
 *
 * The two `exchange` routes were the near miss. They looked exempt — a single-use,
 * high-entropy code, two minutes old, minted by a flow that was itself throttled — and the
 * argument is sound right up until the point that a code is also the thing an attacker
 * guesses at. They carry `VERIFY_CODE_LIMITS`, which costs a legitimate SDK nothing: it
 * calls exchange once at the end of a sign-in it has already been allowed to start.
 */
const EXEMPT = new Map<string, string>();

interface Route {
  readonly id: string;
  readonly authenticated: boolean;
  readonly limited: boolean;
}

function routesOf(controller: new (...args: never[]) => object): Route[] {
  const prototype = controller.prototype as object;
  const classAuthenticated = Reflect.getMetadata(REQUIRES_SESSION, controller) === true;

  return (
    Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .map((name) => {
        const handler = (prototype as Record<string, unknown>)[name];
        return { name, handler };
      })
      .filter(({ handler }) => typeof handler === "function")
      // A method with no HTTP verb on it is a helper, not a route.
      .filter(
        ({ handler }) => Reflect.getMetadata(METHOD_METADATA, handler as object) !== undefined,
      )
      .map(({ name, handler }) => ({
        id: `${controller.name}.${name}`,
        authenticated:
          classAuthenticated || Reflect.getMetadata(REQUIRES_SESSION, handler as object) === true,
        limited:
          Reflect.getMetadata(RATE_LIMIT, handler as object) !== undefined ||
          Reflect.getMetadata(RATE_LIMIT, controller) !== undefined,
      }))
  );
}

const ALL = CONTROLLERS.flatMap(routesOf);

describe("rate-limit coverage", () => {
  it("found the routes it claims to be checking", () => {
    // A reflection walk that silently matches nothing reports total coverage, which is
    // the one way this test could pass while proving less than nothing.
    expect(ALL.length).toBeGreaterThan(20);
    expect(ALL.some((route) => route.limited)).toBe(true);
    expect(PATH_METADATA).toBeDefined();
  });

  it("throttles every route that does not require a session", () => {
    const unprotected = ALL.filter(
      (route) => !route.authenticated && !route.limited && !EXEMPT.has(route.id),
    ).map((route) => route.id);

    expect(unprotected).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a route that has since gained a limit, or been renamed away, is a
    // note that has stopped describing anything. Both read as coverage and are not.
    const stale = [...EXEMPT.keys()].filter((id) => {
      const route = ALL.find((candidate) => candidate.id === id);
      return route === undefined || route.limited;
    });

    expect(stale).toEqual([]);
  });
});
