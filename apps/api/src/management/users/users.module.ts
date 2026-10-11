import { Module } from "@nestjs/common";
import { ErasureModule } from "../../erasure/erasure.module.js";
import { SessionModule } from "../../session/session.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users-service.js";

@Module({
  imports: [ErasureModule, SessionModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
