import { isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { SessionTransport } from "@idenzy/protocol/http/headers";
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import { catchError, map, throwError } from "rxjs";
import { SessionCookies } from "./session-cookies.js";

/** Codes that mean the presented credential is dead, so the browser must stop sending it. */
const DEAD_CREDENTIAL: readonly string[] = [
  ErrorCode.RefreshTokenReused,
  ErrorCode.RefreshTokenInvalid,
  ErrorCode.SessionRevoked,
  ErrorCode.SessionExpired,
];

/** The shape every session-issuing route returns. Recognised structurally, not by route. */
interface SessionPayload {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken?: string;
}

/**
 * Moves the refresh token out of the response body and into a `__Host-` cookie
 * (PROJECT.md 4.3).
 *
 * One interceptor rather than ten call sites. Eight routes return a `SessionCreated`, plus
 * refresh and sign-out, and a rule written out ten times is a rule that will be missed once.
 * It recognises the payload by shape rather than by route, so a flow added later is covered
 * the day it ships instead of the day somebody notices.
 *
 * The error branch is not an afterthought. The cookie is `HttpOnly`, so a client cannot clear
 * a dead one itself; without clearing it here, a revoked session leaves the browser
 * presenting a corpse on every request until the cookie's own lifetime runs out, and every
 * one of those requests looks like a replay attempt.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  constructor(private readonly cookies: SessionCookies) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (request.transport !== SessionTransport.Cookie) return next.handle();

    return next.handle().pipe(
      map((payload: unknown) => this.onSuccess(reply, payload)),
      catchError((error: unknown) => {
        if (isIdenzyError(error) && DEAD_CREDENTIAL.includes(error.code)) {
          this.cookies.clear(reply);
        }
        return throwError(() => error);
      }),
    );
  }

  private onSuccess(reply: FastifyReply, payload: unknown): unknown {
    // Sign-out is the only route in cookie mode that succeeds with no body, and it is
    // exactly the one that has to expire the cookies.
    if (payload === undefined || payload === null) {
      this.cookies.clear(reply);
      return payload;
    }
    if (!isSessionPayload(payload)) return payload;

    this.cookies.issue(reply, {
      refreshToken: payload.refreshToken,
      accessToken: payload.accessToken,
      accessTokenTtlSeconds: ttlSeconds(payload.accessTokenExpiresAt),
    });
    // The whole point: in cookie mode the refresh token never appears in a body. The key is
    // deleted rather than set to undefined, so it cannot be serialised back as null.
    const { refreshToken, ...rest } = payload;
    void refreshToken;
    return rest;
  }
}

function isSessionPayload(payload: unknown): payload is SessionPayload & { refreshToken: string } {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<SessionPayload>;
  return typeof candidate.accessToken === "string" && typeof candidate.refreshToken === "string";
}

function ttlSeconds(expiresAt: string): number {
  return Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
}
