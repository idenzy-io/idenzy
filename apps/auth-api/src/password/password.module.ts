import { Logger } from "@idenzy/core/logging/logger";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { HibpRangeChecker } from "./hibp-range-checker.js";
import { PasswordController } from "./password.controller.js";
import { PasswordSignInFlow } from "./password-sign-in.flow.js";
import { PasswordSignUpFlow } from "./password-sign-up.flow.js";

/**
 * Email and password (PROJECT.md 9.2).
 *
 * The breach checker is bound to its HIBP implementation here and nowhere else, so an
 * air-gapped deployment or a self-hosted corpus is a one-line change in this file.
 */
@Module({
  imports: [SessionModule],
  controllers: [PasswordController],
  providers: [
    PasswordSignUpFlow,
    PasswordSignInFlow,
    {
      provide: BreachedPasswordChecker,
      inject: [Logger],
      useFactory: (logger: Logger) => new HibpRangeChecker(logger),
    },
  ],
})
export class PasswordModule {}
