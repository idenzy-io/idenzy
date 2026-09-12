import { Module } from "@nestjs/common";
import { DnsVerifier } from "./dns-verifier.js";
import { DomainsController } from "./domains.controller.js";
import { DomainsService } from "./domains-service.js";

@Module({
  controllers: [DomainsController],
  providers: [DomainsService, DnsVerifier],
})
export class DomainsModule {}
