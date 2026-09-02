import type { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { ErrorBody } from "@idenzy/protocol/errors/contract";

export interface ErrorOptions {
  /** Developer-facing, safe to return. Must never interpolate user-supplied data. */
  readonly message?: string;
  /** Internal only. Goes to logs and traces, never to a response body. */
  readonly detail?: Record<string, unknown>;
  readonly cause?: unknown;
  /** Seconds, on rate limit and spend cap errors. */
  readonly retryAfterSeconds?: number;
  /** Field-level failures, on validation errors. */
  readonly fields?: readonly { path: string; code: string }[];
}

/**
 * Root of every error Idenzy throws. Carries a stable code and an HTTP status, so
 * the exception filter is a pure mapping with no per-error knowledge.
 *
 * Two payloads, deliberately separated: `message`/`fields` are public, `detail` never
 * leaves the process. That split is what stops an internal string from becoming an
 * account-enumeration oracle (PROJECT.md 4.5).
 */
export abstract class IdenzyError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;

  readonly detail: Readonly<Record<string, unknown>>;
  readonly retryAfterSeconds: number | undefined;
  readonly fields: readonly { path: string; code: string }[] | undefined;

  protected constructor(message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.detail = Object.freeze({ ...options.detail });
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.fields = options.fields === undefined ? undefined : Object.freeze([...options.fields]);
  }

  /** The response body. Everything not named here stays internal. */
  toBody(requestId: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        ...(this.fields === undefined ? {} : { fields: [...this.fields] }),
        ...(this.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: this.retryAfterSeconds }),
      },
    };
  }
}

export function isIdenzyError(value: unknown): value is IdenzyError {
  return value instanceof IdenzyError;
}
