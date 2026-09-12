import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { createLogger } from "@idenzy/observability/logger-factory";
import { Global, Module } from "@nestjs/common";

/** The one logger, bound to this process's identity (PROJECT.md 4.13.8). */
@Global()
@Module({
  providers: [
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
  exports: [Logger],
})
export class ObservabilityModule {}
