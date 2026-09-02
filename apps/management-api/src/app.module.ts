import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
import { createLogger } from "@idenzy/observability/logger-factory";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/**
 * Dashboard, management API and billing control plane (PROJECT.md 9.1).
 *
 * A separate deployment from auth-api on purpose: a dashboard incident must not be able
 * to degrade sign-in. It costs about $25/mo, which is cheap for that isolation.
 */
@Module({
  controllers: [HealthController],
  providers: [
    { provide: AppConfig, useFactory: () => AppConfig.fromEnvironment() },
    { provide: Clock, useClass: SystemClock },
    {
      provide: Logger,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        createLogger({
          level: config.get("LOG_LEVEL"),
          base: { cell: config.get("CELL_CODE"), component: "management-api" },
        }),
    },
  ],
})
export class AppModule {}
