import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { createLogger } from "@idenzy/observability/logger-factory";
import { Global, Module } from "@nestjs/common";

/**
 * Logging (PROJECT.md 9.2).
 *
 * The logger is built from the generated field allowlist, so an undeclared key is
 * dropped rather than redacted. Cell and environment are bound once here instead of
 * being repeated at every call site.
 */
@Global()
@Module({
  providers: [
    {
      provide: Logger,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        createLogger({
          level: config.get("LOG_LEVEL"),
          service: "auth-api",
          base: { cell: config.get("CELL_CODE"), env: config.get("IDENZY_ENV") },
        }),
    },
  ],
  exports: [Logger],
})
export class ObservabilityModule {}
