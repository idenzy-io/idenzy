import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { PasskeyController } from "./passkey.controller.js";
import { PasskeyFlow } from "./passkey.flow.js";
import { PasskeyCeremony } from "./passkey-ceremony.js";
import { PasskeyService } from "./passkey-service.js";
import { PasskeysController } from "./passkeys.controller.js";
import { RelyingPartyResolver } from "./relying-party-resolver.js";

/**
 * WebAuthn registration and authentication ceremonies (PROJECT.md 9.2).
 *
 * The ceremony and the relying-party resolver are exported because `MfaModule` builds a
 * second-factor ceremony on the same two. One resolver, so the RP id a factor verifies
 * against is the one a sign-in verifies against: two would be two places to disagree
 * about which credentials an assertion may address.
 */
@Module({
  imports: [SessionModule],
  controllers: [PasskeyController, PasskeysController],
  providers: [PasskeyCeremony, RelyingPartyResolver, PasskeyService, PasskeyFlow],
  exports: [PasskeyCeremony, RelyingPartyResolver],
})
export class PasskeyModule {}
