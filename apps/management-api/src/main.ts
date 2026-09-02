import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1024 * 1024, trustProxy: true }),
    { bufferLogs: true },
  );
  const config = app.get(AppConfig);
  const logger = app.get(Logger);
  app.enableShutdownHooks();
  await app.listen({ port: config.get("PORT"), host: "0.0.0.0" });
  logger.info("management-api listening", config.toSafeSummary());
}

await bootstrap();
