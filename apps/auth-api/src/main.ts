import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { IdenzyExceptionFilter } from "./common/exception.filter.js";
import { CorsPolicy } from "./http/cors-policy.js";
import { LocalCell } from "./tenancy/local-cell.js";

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

  /*
   * Which cell this process serves, resolved before it accepts anything.
   *
   * The cross-cell refusal compares a key's segment against `CELL_CODE` for free, but the Host
   * path has to compare a uuid, and that needs the registry. Warming it here turns a CELL_CODE
   * that names no cell into a startup failure with a line somebody reads, rather than into one
   * refused request at a time once traffic arrives (PROJECT.md 4.13.5).
   */
  const cell = app.get(LocalCell);
  await cell.warm();

  /*
   * And that its mail cannot leave the jurisdiction it serves.
   *
   * This is the residency failure that would never announce itself: an EU cell configured with
   * `AWS_REGION=us-east-1` sends every OTP and every magic link through the United States, the
   * mail arrives, nothing errors, and the recipient's address has crossed a border on each
   * sign-in. Refusing to boot is the only moment anyone would find out.
   */
  const sesRegion = config.get("AWS_REGION");
  const law = await cell.policy();
  if (sesRegion !== undefined && !law.permitsEmailRegion(sesRegion)) {
    throw new InternalError({
      detail: {
        cell: cell.code,
        jurisdiction: law.jurisdiction,
        configured: sesRegion,
        required: law.emailRegion,
        rule: "a cell's transactional email must leave from its own jurisdiction (4.13.5)",
      },
    });
  }

  // Its own variable first, so `pnpm dev` can run every service off one `.env`;
  // `PORT` is what Cloud Run sets and stays the deployed contract. Resolved once and
  // logged, because a boot line naming a port the process is not on is worse than none.
  const port = config.get("AUTH_API_PORT") ?? config.get("PORT");
  await app.listen({ port, host: "0.0.0.0" });
  logger.info("auth-api listening", { ...config.toSafeSummary(), port });
}

await bootstrap();

/** A stable error code where there is one. Node and Fastify both carry constants here. */
function codeOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "unknown";
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : "unknown";
}
