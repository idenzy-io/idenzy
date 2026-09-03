import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RefreshService } from "./refresh-service.js";
import { SessionController } from "./session.controller.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session-service.js";
import { SessionsController } from "./sessions.controller.js";

/**
 * Sessions, refresh rotation and revocation (PROJECT.md 9.2).
 *
 * Exports SessionService because every auth flow needs it as its SessionIssuer, and
 * exports nothing else: rotation is reachable only through the controller.
 */
@Module({
  controllers: [SessionController, SessionsController],
  providers: [
    SessionService,
    RefreshService,
    // Global, but opt-in: it only acts on routes marked @RequireSession, so adding an
    // authenticated endpoint is one decorator rather than a guard registration nobody
    // remembers.
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionService],
})
export class SessionModule {}
