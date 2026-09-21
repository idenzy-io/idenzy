import { Logger } from "@idenzy/core/logging/logger";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { Module } from "@nestjs/common";
import { HibpRangeChecker } from "../password/hibp-range-checker.js";
import { SessionModule } from "../session/session.module.js";
import { AnonymousController } from "./anonymous.controller.js";
import { AnonymousFlow } from "./anonymous.flow.js";
import { AnonymousUpgradeFlow } from "./anonymous-upgrade.flow.js";

/**
 * Anonymous sessions (PROJECT.md 3.1).
 *
 * The breach checker is bound here as well as in PasswordModule, because the upgrade
 * sets a password and must apply the same rule. Two bindings of one port is the cost of
 * neither module depending on the other; a shared module for a single provider would be
 * an abstraction ahead of a second reason to have it.
 */
@Module({
  imports: [SessionModule],
  controllers: [AnonymousController],
  providers: [
    AnonymousFlow,
    AnonymousUpgradeFlow,
    {
      provide: BreachedPasswordChecker,
      inject: [Logger],
      useFactory: (logger: Logger) => new HibpRangeChecker(logger),
    },
  ],
})
export class AnonymousModule {}
