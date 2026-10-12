import { Module } from "@nestjs/common";
import { RelyingPartyController } from "./relying-party.controller.js";
import { RelyingPartyService } from "./relying-party-service.js";

@Module({
  controllers: [RelyingPartyController],
  providers: [RelyingPartyService],
})
export class RelyingPartyModule {}
