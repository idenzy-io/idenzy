import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { EmailOtpFlow } from "./email-otp.flow.js";
import { EmailOtpService } from "./email-otp-service.js";
import { OtpController } from "./otp.controller.js";
import { OtpVerification } from "./otp-verification.js";
import { SmsOtpFlow } from "./sms-otp.flow.js";
import { SmsOtpService } from "./sms-otp-service.js";

/**
 * One-time codes over email and SMS (PROJECT.md 4.7).
 *
 * Both channels are one flow family with one difference between them, and every fraud
 * and spend control the SMS half needs lives behind `SmsProvider.send` in
 * `DeliveryModule` rather than here. WhatsApp is the third name in the channel enum and
 * is not wired: its Cloud API sends pre-approved templates rather than free text, which
 * is a provider and a template pipeline of its own.
 */
@Module({
  imports: [SessionModule],
  controllers: [OtpController],
  providers: [EmailOtpService, EmailOtpFlow, SmsOtpService, SmsOtpFlow, OtpVerification],
})
export class OtpModule {}
