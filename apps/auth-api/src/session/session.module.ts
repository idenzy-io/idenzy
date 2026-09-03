import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { RefreshService } from "./refresh-service.js";
import { RevocationPublisher } from "./revocation-publisher.js";
import { SessionController } from "./session.controller.js";
import { SessionGuard } from "./session.guard.js";
import { SessionCookieInterceptor } from "./session-cookie.interceptor.js";
import { SessionCookies } from "./session-cookies.js";
import { SessionService } from "./session-service.js";
import { SessionTransportGuard } from "./session-transport.guard.js";
import { SessionsController } from "./sessions.controller.js";

/**
 * Sessions, refresh rotation and revocation (PROJECT.md 9.2).
 *
 * Exports SessionService because every auth flow needs it as its SessionIssuer, and
 * RevocationPublisher because a password reset ends sessions too. Rotation stays
 * unexported: it is reachable only through the controller.
 */
@Module({
  controllers: [SessionController, SessionsController],
  providers: [
    SessionService,
    RefreshService,
    SessionCookies,
    RevocationPublisher,
    // Ordered before SessionGuard on purpose: it decides how the session is carried, and
    // the wiring test pins that order because a global guard's position is otherwise an
    // implicit consequence of module import order.
    { provide: APP_GUARD, useClass: SessionTransportGuard },
    // Global, but opt-in: it only acts on routes marked @RequireSession, so adding an
    // authenticated endpoint is one decorator rather than a guard registration nobody
    // remembers.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: SessionCookieInterceptor },
  ],
  exports: [SessionService, SessionCookies, RevocationPublisher],
})
export class SessionModule {}
