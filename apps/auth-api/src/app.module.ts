import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
import { createLogger } from "@idenzy/observability/logger-factory";
import { createPool } from "@idenzy/persistence/connection/pool";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Module } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { HealthController } from "./health/health.controller.js";
import { ProjectResolver } from "./tenancy/project-resolver.js";
import { WellKnownController } from "./well-known/well-known.controller.js";

/**
 * Wiring only.
 *
 * Everything is a class obtained by constructor injection (PROJECT.md 7.2), so this
 * module is the single place that knows which implementation backs each port. Swapping
 * the local token issuer for the KMS one is a change here and nowhere else.
 */
@Module({
  controllers: [HealthController, WellKnownController],
  providers: [
    { provide: AppConfig, useFactory: () => AppConfig.fromEnvironment() },
    { provide: Clock, useClass: SystemClock },
    {
      provide: Logger,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        createLogger({
          level: config.get("LOG_LEVEL"),
          base: { cell: config.get("CELL_CODE"), env: config.get("IDENZY_ENV") },
        }),
    },
    {
      provide: "DATABASE",
      inject: [AppConfig],
      useFactory: (config: AppConfig): NodePgDatabase =>
        drizzle(
          createPool({
            connectionString: config.get("DATABASE_URL"),
            max: config.get("DATABASE_POOL_MAX"),
            statementTimeoutMillis: config.get("DATABASE_STATEMENT_TIMEOUT_MS"),
          }),
        ),
    },
    {
      provide: UnitOfWork,
      inject: ["DATABASE"],
      useFactory: (db: NodePgDatabase) => new UnitOfWork(db),
    },
    {
      provide: ProjectResolver,
      inject: ["DATABASE"],
      useFactory: (db: NodePgDatabase) => new ProjectResolver(db),
    },
  ],
})
export class AppModule {}
