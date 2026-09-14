import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { IdenzyExceptionFilter } from "./common/exception.filter.js";
import { CorsPolicy } from "./http/cors-policy.js";

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
    // The payment webhook verifies a signature over the bytes that arrived, and a handler
    // is normally handed the parsed object rather than them. Re-serialising an object
    // produces different bytes — key order, spacing, unicode escapes — and the check would
    // fail in a way that looks exactly like a misconfigured secret. Nest keeps the buffer
    // on `request.rawBody` when asked, which is the supported way to have both; adding a
    // content-type parser of our own is not, because the adapter registers its own after
    // ours and Fastify refuses the second with FST_ERR_CTP_ALREADY_PRESENT.
    { bufferLogs: true, rawBody: true },
  );

  const config = app.get(AppConfig);
  const logger = app.get(Logger);

  app.useGlobalFilters(new IdenzyExceptionFilter(logger));

  app.get(CorsPolicy).bindTo(app.getHttpAdapter().getInstance());
  app.enableShutdownHooks();

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection, exiting", {
      outcome: "fatal",
      errorName: reason instanceof Error ? reason.name : "unknown",
      errorCode: codeOf(reason),
    });
    process.exit(1);
  });
  process.on("uncaughtException", (error: Error) => {
    // The class and the code, never the message. A fatal line saying only "exiting" is an
    // outage with no first clue, and this one cost real minutes on a boot failure — but a
    // message can quote a value, which is what the log allowlist exists to keep out
    // (PROJECT.md 4.13.8). A name and a stable code are enough to name the fault.
    logger.error("uncaught exception, exiting", {
      outcome: "fatal",
      errorName: error.name,
      errorCode: codeOf(error),
    });
    process.exit(1);
  });

  // Its own variable first, so `pnpm dev` can run every service off one `.env`;
  // `PORT` is what Cloud Run sets and stays the deployed contract. Resolved once and
  // logged, because a boot line naming a port the process is not on is worse than none.
  const port = config.get("MANAGEMENT_API_PORT") ?? config.get("PORT");
  await app.listen({ port, host: "0.0.0.0" });
  logger.info("management-api listening", { ...config.toSafeSummary(), port });
}

await bootstrap();

/** A stable error code where there is one. Node and Fastify both carry constants here. */
function codeOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "unknown";
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : "unknown";
}
