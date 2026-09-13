import { generateLogAllowlist } from "@idenzy/compliance/generators/log-allowlist";
import type { Logger } from "@idenzy/core/logging/logger";
import { pino } from "pino";
import { AllowlistLogger } from "./allowlist-logger.js";

export interface LoggerOptions {
  readonly level: string;
  /**
   * Which service wrote the line: `auth-api`, `management-api`, `workers`.
   *
   * Its own field rather than `component`, which it used to share and lose. A line passes
   * `component` to say which part of a service it came from — `valkey`, `usage`, `webhooks` — and
   * a per-line field overrides a base one, so binding the service name as `component` meant the
   * service disappeared from precisely the lines that named a subsystem. Two questions, two
   * fields: `service` is where a line was written, `component` is what was doing the writing.
   */
  readonly service: string;
  readonly pretty?: boolean;
  readonly base?: Readonly<Record<string, unknown>>;
  /** Where lines go. Defaults to stdout, which is what both collectors read; tests pass a sink. */
  readonly destination?: NodeJS.WritableStream;
}

/**
 * Cloud Logging's own severity names (LogSeverity).
 *
 * Pino's numeric levels mean nothing to a log viewer, and its string labels are close but not
 * equal: `warn` and `fatal` are not severities Google recognises, so a line logged at either
 * lands as `DEFAULT` and stops being filterable — which is the whole reason for reading logs
 * somewhere other than a terminal.
 */
const SEVERITIES: Readonly<Record<string, string>> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

/**
 * Builds the application logger.
 *
 * The allowlist is read from the schema classification at construction, so adding a
 * loggable column changes what can be logged without touching this file.
 *
 * **Structured JSON on stdout, and deliberately no Cloud Logging client.** On Cloud Run stdout is
 * already collected and a client would be a second path to the same place, carrying gRPC and its
 * dependency tree into a service that needs neither (PROJECT.md 7.6). On a VPS the Ops Agent reads
 * the same stream and ships it, so what the application owes either environment is the *shape*:
 * `severity` rather than a level, `message` rather than `msg`, and a `service` on every line. One
 * format, both places, no credential in the process.
 */
export function createLogger(options: LoggerOptions): Logger {
  const instance = pino(
    {
      level: options.level,
      base: { service: options.service, ...options.base },
      // `message` rather than pino's `msg`, because that is the key Cloud Logging promotes out of
      // the JSON payload into the line a human reads.
      messageKey: "message",
      // Nothing here is derived from a database column, so it is safe by construction.
      formatters: { level: (label) => ({ severity: SEVERITIES[label] ?? "DEFAULT" }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
  return new AllowlistLogger(instance, generateLogAllowlist());
}
