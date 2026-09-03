import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { IdenzyExceptionFilter } from "./common/exception.filter.js";
import { CorsPolicy } from "./http/cors-policy.js";

/**
 * The public auth API (PROJECT.md 9.1). The only service that mints tokens.
 *
 * Two operational rules from section 9.6 are set up here because they cannot be
 * retrofitted: unhandled rejections are fatal, and shutdown drains rather than drops.
 * A Cloud Run revision must not cut a token rotation in half.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // 64 KB. No auth request needs more, and a cap here is cheaper than a cap later.
      bodyLimit: 64 * 1024,
      genReqId: () => `req_${crypto.randomUUID()}`,
      trustProxy: true,
    }),
    { bufferLogs: true },
  );

  const config = app.get(AppConfig);
  const logger = app.get(Logger);

  app.useGlobalFilters(new IdenzyExceptionFilter(logger));
  // Bound to Fastify rather than to Nest, and before listen: the preflight route has to
  // exist outside the guard chain, and the response hook has to run after the filter.
  app.get(CorsPolicy).bindTo(app.getHttpAdapter().getInstance());
  app.enableShutdownHooks();

  // A process in an unknown state does not keep serving auth traffic (PROJECT.md 9.6).
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection, exiting", { outcome: "fatal" });
    void reason;
    process.exit(1);
  });
  process.on("uncaughtException", () => {
    logger.error("uncaught exception, exiting", { outcome: "fatal" });
    process.exit(1);
  });

  await app.listen({ port: config.get("PORT"), host: "0.0.0.0" });
  logger.info("auth-api listening", config.toSafeSummary());
}

await bootstrap();
