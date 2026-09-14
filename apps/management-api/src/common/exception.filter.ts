import { InternalError, ResourceNotFoundError, ValidationFailedError } from "@idenzy/core/errors";
import { type IdenzyError, isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { Logger } from "@idenzy/core/logging/logger";
import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Maps the IdenzyError hierarchy onto the public error contract (PROJECT.md 9.3).
 *
 * The same filter auth-api runs, and it has to be: a customer builds their messages from
 * these codes, and a management endpoint that shaped its errors differently would make
 * the contract a per-service detail rather than a promise.
 */
@Catch()
export class IdenzyExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = request.id;

    const error = isIdenzyError(exception) ? exception : translate(exception);

    if (error.status >= 500) {
      this.logger.error("request failed", {
        requestId,
        errorCode: error.code,
        statusCode: error.status,
        // The class of what actually went wrong, which `internal_error` alone never says.
        // Never the message: that is the one field on an exception that can quote a value
        // (PROJECT.md 4.13.8), and a driver error naming the row it choked on is exactly
        // what the log allowlist exists to keep out.
        errorName: exception instanceof Error ? exception.name : "unknown",
      });
    }

    if (error.retryAfterSeconds !== undefined) {
      void reply.header("retry-after", String(error.retryAfterSeconds));
    }

    // Always JSON. An Idenzy endpoint returning text/html is a bug (PROJECT.md 1.1).
    void reply.status(error.status).type("application/json").send(error.toBody(requestId));
  }
}

/**
 * Anything that is not ours, mapped onto the contract rather than buried as a 500.
 *
 * The framework raises `HttpException` before a handler is reached — an unparseable body,
 * an unmatched route, a method nobody registered — and treating those as internal errors
 * tells a caller the server broke when the request was malformed. That is the worst
 * possible answer: it sends somebody looking at our logs for a fault that is in their
 * request, and it pages whoever watches the 5xx rate for something no deploy will fix.
 *
 * Status is read off the exception rather than guessed, and only 4xx is translated. A 5xx
 * from the framework is a genuine internal fault and keeps the generic answer, because the
 * detail of one is not something to hand to a caller (PROJECT.md 4.5).
 */
function translate(exception: unknown): IdenzyError {
  const status = statusOf(exception);
  if (status === null || status >= 500) {
    return new InternalError({ cause: exception, detail: { unhandled: true } });
  }
  if (status === 404) return new ResourceNotFoundError({ cause: exception });
  return new ValidationFailedError({ cause: exception });
}

/** The status a framework exception carries, or null when it is not one. */
function statusOf(exception: unknown): number | null {
  if (typeof exception !== "object" || exception === null) return null;
  const status = (exception as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
