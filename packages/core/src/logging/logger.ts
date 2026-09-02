/**
 * Structured logging port. Implemented by @idenzy/observability over Pino.
 *
 * `fields` is an allowlist, not free-form: undeclared keys are dropped by the
 * implementation, so a PII column cannot reach a log line (PROJECT.md 4.13.8).
 * Domain code depends on this abstraction so it never imports infrastructure.
 */
export abstract class Logger {
  abstract debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  abstract info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  abstract warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  abstract error(message: string, fields?: Readonly<Record<string, unknown>>): void;

  /** A logger with permanent extra fields, for binding request or tenant context. */
  abstract child(bindings: Readonly<Record<string, unknown>>): Logger;
}
