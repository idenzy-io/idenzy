import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { PasskeyController } from "./passkey.controller.js";
import { PasskeyFlow } from "./passkey.flow.js";
import { PasskeyCeremony } from "./passkey-ceremony.js";
import { PasskeyService } from "./passkey-service.js";
import { PasskeysController } from "./passkeys.controller.js";
import { RelyingPartyResolver } from "./relying-party-resolver.js";

/** WebAuthn registration and authentication ceremonies (PROJECT.md 9.2). */
@Module({
  imports: [SessionModule],
  controllers: [PasskeyController, PasskeysController],
  providers: [PasskeyCeremony, RelyingPartyResolver, PasskeyService, PasskeyFlow],
})
export class PasskeyModule {}
