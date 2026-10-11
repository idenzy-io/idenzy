import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { UserErasureController } from "./user-erasure.controller.js";
import { UserErasureService } from "./user-erasure-service.js";

@Module({
  imports: [SessionModule],
  controllers: [UserErasureController],
  providers: [UserErasureService],
  exports: [UserErasureService],
})
export class ErasureModule {}
