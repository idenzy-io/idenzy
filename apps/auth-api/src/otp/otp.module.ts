import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { EmailOtpFlow } from "./email-otp.flow.js";
import { EmailOtpService } from "./email-otp-service.js";
import { OtpController } from "./otp.controller.js";

/** Email one-time codes (PROJECT.md 4.7). SMS and WhatsApp arrive in phase 2. */
@Module({
  imports: [SessionModule],
  controllers: [OtpController],
  providers: [EmailOtpService, EmailOtpFlow],
})
export class OtpModule {}
