import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { IdenzyExceptionFilter } from "./common/exception.filter.js";

/**
 * The management API (PROJECT.md 9.1). It mints no tokens and serves no HTML.
 *
 * The two operational rules auth-api sets up apply here for the same reason: an unhandled
 * rejection leaves a process in an unknown state, and a Cloud Run revision must drain
 * rather than drop. A dashboard request is cheaper to lose than a sign-in, but a
 * half-applied billing write is not.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Larger than auth-api's 64 KB: this surface takes template bodies and key scopes,
      // not credentials. Still capped, because an unbounded body is a denial of service.
      bodyLimit: 1024 * 1024,
      genReqId: () => `req_${crypto.randomUUID()}`,
      trustProxy: true,
    }),
    { bufferLogs: true },
  );

  const config = app.get(AppConfig);
  const logger = app.get(Logger);

  app.useGlobalFilters(new IdenzyExceptionFilter(logger));
  app.enableShutdownHooks();

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
  logger.info("management-api listening", config.toSafeSummary());
}

await bootstrap();
