import { InternalError } from "@idenzy/core/errors/errors";
import { isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { Logger } from "@idenzy/core/logging/logger";
import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Maps the IdenzyError hierarchy onto the public error contract (PROJECT.md 9.3).
 *
 * Because every error carries its own code and status, this is a pure mapping with no
 * per-error knowledge. Anything unrecognized becomes a generic 500: no stack traces, no
 * driver messages, and nothing that could distinguish "no such user" from "wrong
 * password" to someone probing (PROJECT.md 4.5).
 */
@Catch()
export class IdenzyExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = request.id;

    const error = isIdenzyError(exception)
      ? exception
      : new InternalError({ cause: exception, detail: { unhandled: true } });

    if (error.status >= 500) {
      this.logger.error("request failed", {
        requestId,
        errorCode: error.code,
        statusCode: error.status,
      });
    }

    if (error.retryAfterSeconds !== undefined) {
      void reply.header("retry-after", String(error.retryAfterSeconds));
    }

    // Always JSON. An auth endpoint returning text/html is a bug (PROJECT.md 4.3).
    void reply.status(error.status).type("application/json").send(error.toBody(requestId));
  }
}
