import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { createLogger } from "@idenzy/observability/logger-factory";

/**
 * Standalone consumers: email, sms, webhook, audit, analytics, dsr and retention
 * (PROJECT.md 9.1). No HTTP server.
 *
 * Skeleton for Phase 0. Each consumer arrives with the flow that produces its messages.
 */
async function bootstrap(): Promise<void> {
  const config = AppConfig.fromEnvironment();
  const logger = createLogger({
    level: config.get("LOG_LEVEL"),
    base: { cell: config.get("CELL_CODE"), component: "workers" },
  });
  logger.info("workers started", config.toSafeSummary());
  await Promise.resolve();
}

await bootstrap();
