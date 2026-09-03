import { IdenzyError } from "@idenzy/core/errors/idenzy-error";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { errorBodySchema } from "@idenzy/protocol/errors/contract";

/**
 * An error the API returned, carrying the code the customer's UI is built from.
 *
 * There is one class here and not fifty, which is the opposite of the server's hierarchy and
 * for a reason that only holds on this side. The server subclasses per code so the exception
 * filter can map a class to a status without knowing any of them; a client already has the
 * status in the response, so a subclass per code would add nothing but a second list of codes
 * to keep in step with `@idenzy/protocol`. Branch on `code`, never on `message`.
 */
export class IdenzyApiError extends IdenzyError {
  override readonly code: ErrorCode;
  override readonly status: number;
  /** Quote this in a support request. It is the same id our logs are keyed by. */
  readonly requestId: string;

  constructor(error: ErrorPayload, status: number) {
    super(error.message, {
      ...(error.fields === undefined ? {} : { fields: error.fields }),
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    });
    this.code = error.code;
    this.status = status;
    this.requestId = error.requestId;
  }
}

/**
 * The request never got an answer we could read: the network failed, or the body was not the
 * error contract.
 *
 * `status` is 0 when nothing came back. That is deliberate rather than a placeholder: a
 * fabricated 503 would tell a caller our API refused them when in fact their device never
 * reached it, and the two want different handling in a customer's UI.
 */
export class IdenzyTransportError extends IdenzyError {
  override readonly code = ErrorCode.ProviderUnavailable;
  override readonly status: number;

  constructor(message: string, options: TransportErrorOptions = {}) {
    super(message, { ...(options.cause === undefined ? {} : { cause: options.cause }) });
    this.status = options.status ?? 0;
  }
}

interface TransportErrorOptions {
  readonly status?: number;
  readonly cause?: unknown;
}

/**
 * The client was constructed wrong, and it says so before a request is ever made.
 *
 * It carries `validation_failed` because that is what it is, and status 0 because nothing
 * left the process. Failing at construction is the point: every mistake this catches is one
 * that otherwise surfaces as a working request with a consequence nobody sees.
 */
export class IdenzyConfigurationError extends IdenzyError {
  override readonly code = ErrorCode.ValidationFailed;
  override readonly status = 0;

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { ...(options.cause === undefined ? {} : { cause: options.cause }) });
  }
}

/**
 * A failure that came back through a redirect rather than a response.
 *
 * Our callback answers a browser with a 302 to the customer's own route, so when something
 * goes wrong after the destination has been checked, the only channel left is `?error=` on
 * that redirect. There is no status and no request id in a query string, and inventing either
 * would make this look like an answer we gave to a request this browser made.
 */
export class IdenzyRedirectError extends IdenzyError {
  override readonly code: ErrorCode;
  override readonly status = 0;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type ErrorPayload = ReturnType<typeof errorBodySchema.parse>["error"];

/**
 * Turns a failed response into the error a caller sees.
 *
 * The body is parsed rather than trusted, because a 502 from a load balancer or a captive
 * portal's login page arrives on the same path as our own error contract. Anything that is
 * not the contract becomes a transport error carrying the real status, so a caller is never
 * handed an `ErrorCode` we did not send.
 */
export function errorFromResponse(status: number, body: string): IdenzyError {
  const parsed = errorBodySchema.safeParse(readJson(body));
  if (!parsed.success) {
    return new IdenzyTransportError(`The API answered ${status} with an unrecognised body.`, {
      status,
    });
  }
  return new IdenzyApiError(parsed.data.error, status);
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
