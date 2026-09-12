import { Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks-service.js";

@Module({
  imports: [CryptoModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
