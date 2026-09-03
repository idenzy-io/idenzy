import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { AccountController } from "./account.controller.js";
import { EmailChangeService } from "./email-change-service.js";
import { EmailVerificationService } from "./email-verification-service.js";

/** Email verification and email change, both on the user's own account (PROJECT.md 4.5). */
@Module({
  imports: [SessionModule],
  controllers: [AccountController],
  providers: [EmailVerificationService, EmailChangeService],
})
export class AccountModule {}
