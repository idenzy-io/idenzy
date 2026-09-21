import { Module } from "@nestjs/common";
import { OriginsController } from "./origins.controller.js";
import { OriginsService } from "./origins-service.js";

@Module({
  controllers: [OriginsController],
  providers: [OriginsService],
})
export class OriginsModule {}
