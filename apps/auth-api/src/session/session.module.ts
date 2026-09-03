import { Module } from "@nestjs/common";
import { RefreshService } from "./refresh-service.js";
import { SessionController } from "./session.controller.js";
import { SessionService } from "./session-service.js";

/**
 * Sessions, refresh rotation and revocation (PROJECT.md 9.2).
 *
 * Exports SessionService because every auth flow needs it as its SessionIssuer, and
 * exports nothing else: rotation is reachable only through the controller.
 */
@Module({
  controllers: [SessionController],
  providers: [SessionService, RefreshService],
  exports: [SessionService],
})
export class SessionModule {}
