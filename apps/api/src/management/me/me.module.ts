import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me-service.js";

@Module({ imports: [BillingModule], controllers: [MeController], providers: [MeService] })
export class MeModule {}
