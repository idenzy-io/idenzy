import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { MagicLinkController } from "./magic-link.controller.js";
import { MagicLinkFlow } from "./magic-link.flow.js";
import { MagicLinkService } from "./magic-link-service.js";

/** Magic links and the single-use code they redirect with (PROJECT.md 4.7). */
@Module({
  imports: [SessionModule],
  controllers: [MagicLinkController],
  providers: [MagicLinkService, MagicLinkFlow],
})
export class MagicLinkModule {}
