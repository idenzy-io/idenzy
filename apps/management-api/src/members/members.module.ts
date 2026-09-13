import { Module } from "@nestjs/common";
import { DashboardUsers } from "./dashboard-users.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members-service.js";

@Module({
  controllers: [MembersController],
  providers: [MembersService, DashboardUsers],
})
export class MembersModule {}
