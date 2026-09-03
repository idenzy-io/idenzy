import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { AccountController } from "./account.controller.js";
import { EmailChangeService } from "./email-change-service.js";
import { EmailVerificationService } from "./email-verification-service.js";
import { MeController } from "./me.controller.js";
import { ProfileService } from "./profile-service.js";

/** The user's own account: their profile, and the two ways their address changes. */
@Module({
  imports: [SessionModule],
  controllers: [AccountController, MeController],
  providers: [EmailVerificationService, EmailChangeService, ProfileService],
})
export class AccountModule {}
