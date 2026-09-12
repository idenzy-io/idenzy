import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthController } from "./health.controller.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

/**
 * Dashboard, management API and billing control plane (PROJECT.md 9.1).
 *
 * A separate deployment from auth-api on purpose: a dashboard incident must not be able
 * to degrade sign-in. It costs about $25/mo, which is cheap for that isolation.
 *
 * Global modules first, in dependency order, then feature modules — the same shape
 * auth-api's composition root has. `TenancyModule` registers the guard globally, so a new
 * controller is authenticated by default and a route opts out by saying nothing rather
 * than by remembering to add a decorator.
 */
@Module({
  imports: [ConfigModule, ObservabilityModule, PersistenceModule, TenancyModule, OrgsModule],
  controllers: [HealthController],
})
export class AppModule {}
