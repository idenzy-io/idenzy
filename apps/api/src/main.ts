import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { IdenzyExceptionFilter } from "./common/exception.filter.js";
import { CorsPolicy } from "./http/cors-policy.js";

/**
 * The API (PROJECT.md 9.1). The only service that mints tokens.
 *
 * It serves both surfaces: the public authentication API a customer's end users reach, and
 * the dashboard API our own panel reaches. They were two deployments, `auth-api` and
 * `management-api`, kept apart so that a dashboard incident could not degrade sign-in. One
 * process is the trade that was taken; `http/surface.ts` is what keeps them from becoming
 * one *surface*, which would be a different and worse thing.
 *
 * Two operational rules from section 9.6 are set up here because they cannot be
 * retrofitted: unhandled rejections are fatal, and shutdown drains rather than drops.
 * A Cloud Run revision must not cut a token rotation in half.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      /*
       * A megabyte, which is the dashboard's figure rather than the auth API's 64 KB.
       *
       * Fastify takes one limit per instance, so merging two services means the looser of
       * the two wins. The management surface takes email template bodies and key scopes
       * and genuinely needs the room. **The auth surface has lost its 64 KB cap**, which
       * is a real if small regression: no auth request needs more, and the tighter bound
       * was cheap. Narrowing it again means a per-route limit, which Fastify supports and
       * Nest does not expose — worth doing if the auth surface is ever the front line for
       * a flood, and not worth inventing a decorator for today.
       */
      bodyLimit: 1024 * 1024,
      genReqId: () => `req_${crypto.randomUUID()}`,
      trustProxy: true,
    }),
    /*
     * `rawBody` is on for every route, which is a consequence of the merge worth naming.
     *
     * The payment webhook verifies a signature over the bytes that arrived, and a handler
     * is normally handed the parsed object rather than them; re-serialising produces
     * different bytes and the check fails in a way that looks exactly like a misconfigured
     * secret. Nest keeps the buffer on `request.rawBody` when asked, and it is a factory
     * option rather than a per-route one, so the auth surface now carries the same buffer.
     * The cost is memory proportional to body size on routes capped at 64 KB.
     */
    { bufferLogs: true, rawBody: true },
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
  const port = config.get("API_PORT") ?? config.get("PORT");
  await app.listen({ port, host: "0.0.0.0" });
  logger.info("api listening", { ...config.toSafeSummary(), port });
}

await bootstrap();

/** A stable error code where there is one. Node and Fastify both carry constants here. */
function codeOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "unknown";
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : "unknown";
}
